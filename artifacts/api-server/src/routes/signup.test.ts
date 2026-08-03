import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  installationsTable,
  provisioningEventsTable,
  billingChargesTable,
} from "@workspace/db";
import { CheckSubdomainResponse, GetSignupStatusResponse } from "@workspace/api-zod";
import app from "../app";

// Contratación online: disponibilidad de subdominio, validaciones del alta,
// webhook de PayPal (activación → aprovisionamiento simulado, impago →
// suspensión, baja → cancelación con exportación) y facturación del variable
// por fincas activas. Sin credenciales de PayPal el alta devuelve 503.

// node --test ejecuta cada fichero en su propio proceso.
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.PAYPAL_WEBHOOK_ID;
delete process.env.PROVISION_SCRIPT;

let server: Server;
let baseUrl: string;
const suffix = randomUUID().slice(0, 8);
const createdIds: number[] = [];

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (createdIds.length) {
    await db.delete(installationsTable).where(inArray(installationsTable.id, createdIds));
  }
  server.close();
  await pool.end();
});

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createInstallation(overrides: Partial<typeof installationsTable.$inferInsert> = {}) {
  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop Test ${suffix}`,
      contactName: "Persona Prueba",
      contactEmail: `coop-${suffix}@example.com`,
      subdomain: `coop-${suffix}${overrides.subdomain ?? ""}`.slice(0, 40),
      publicToken: randomBytes(20).toString("base64url"),
      apiToken: randomBytes(24).toString("base64url"),
      paypalSubscriptionId: `I-TEST${suffix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      termsAcceptedAt: new Date(),
      ...overrides,
      ...(overrides.subdomain ? { subdomain: overrides.subdomain } : {}),
    })
    .returning();
  createdIds.push(inst.id);
  return inst;
}

async function waitForStatus(id: number, expected: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
    if (row?.status === expected) return;
    if (Date.now() - start > timeoutMs) {
      assert.fail(`La instalación ${id} no llegó al estado ${expected} (actual: ${row?.status})`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("subdominio: formato inválido, reservado y disponible", async () => {
  let res = await api("GET", "/signup/subdomain?subdomain=-malo-");
  let body = CheckSubdomainResponse.parse(await res.json());
  assert.equal(body.available, false);

  res = await api("GET", "/signup/subdomain?subdomain=www");
  body = CheckSubdomainResponse.parse(await res.json());
  assert.equal(body.available, false);
  assert.match(body.reason ?? "", /reservado/i);

  res = await api("GET", `/signup/subdomain?subdomain=libre-${suffix}`);
  body = CheckSubdomainResponse.parse(await res.json());
  assert.equal(body.available, true);
});

test("subdominio ya contratado no está disponible", async () => {
  const inst = await createInstallation({ subdomain: `ocupado-${suffix}` });
  const res = await api("GET", `/signup/subdomain?subdomain=${inst.subdomain}`);
  const body = CheckSubdomainResponse.parse(await res.json());
  assert.equal(body.available, false);
  assert.match(body.reason ?? "", /ya está contratado/i);
});

test("alta sin aceptar términos → 400; sin PayPal configurado → 503", async () => {
  const base = {
    name: "Coop Sin PayPal",
    contactName: "Contacto",
    contactEmail: "sinpaypal@example.com",
    subdomain: `sinpaypal-${suffix}`,
    returnUrl: "https://example.com/vuelta",
    cancelUrl: "https://example.com/cancelar",
  };
  let res = await api("POST", "/signup", { ...base, acceptTerms: false });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /términos/i);

  res = await api("POST", "/signup", { ...base, acceptTerms: true });
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /PayPal/i);
  // No debe quedar registro que bloquee el subdominio.
  const rows = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.subdomain, base.subdomain));
  assert.equal(rows.length, 0);
});

test("webhook ACTIVATED aprovisiona (simulado) y crea el cargo del mes", async () => {
  const inst = await createInstallation({ subdomain: `activa-${suffix}` });
  const res = await api("POST", "/paypal/webhook", {
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 200);
  await waitForStatus(inst.id, "active");

  const events = await db
    .select()
    .from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.installationId, inst.id));
  const steps = events.map((e) => e.step);
  for (const s of ["dns", "database", "service", "tls", "admin_account", "done"]) {
    assert.ok(steps.includes(s), `falta el paso ${s}`);
  }

  // Cargo del mes en curso: base 100 € sin fincas todavía.
  const charges = await db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.installationId, inst.id));
  assert.equal(charges.length, 1);
  assert.equal(charges[0].totalCents, 10000);

  // Estado público consultable con el token.
  const statusRes = await api("GET", `/signup/status/${inst.publicToken}`);
  const status = GetSignupStatusResponse.parse(await statusRes.json());
  assert.equal(status.status, "active");
  assert.ok(status.url);
});

test("impago suspende y la baja cancela con exportación registrada", async () => {
  const inst = await createInstallation({ subdomain: `impago-${suffix}`, status: "active" });
  let res = await api("POST", "/paypal/webhook", {
    event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 200);
  await waitForStatus(inst.id, "suspended");

  // Reactivación al volver a activarse la suscripción.
  res = await api("POST", "/paypal/webhook", {
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 200);
  await waitForStatus(inst.id, "active");

  res = await api("POST", "/paypal/webhook", {
    event_type: "BILLING.SUBSCRIPTION.CANCELLED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 200);
  await waitForStatus(inst.id, "cancelled");
  const events = await db
    .select()
    .from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.installationId, inst.id));
  assert.ok(events.some((e) => e.step === "export"), "debe registrarse la exportación de datos");
});

test("reporte de uso: token requerido y cálculo 100 € + 2,50 €/finca", async () => {
  const inst = await createInstallation({ subdomain: `uso-${suffix}`, status: "active" });

  let res = await api("POST", "/billing/usage", { activeFarms: 12 });
  assert.equal(res.status, 401);

  res = await fetch(`${baseUrl}/api/billing/usage`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-install-token": inst.apiToken },
    body: JSON.stringify({ activeFarms: 12 }),
  });
  assert.equal(res.status, 200);

  const [fresh] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, inst.id));
  assert.equal(fresh.activeFarmCount, 12);
  const charges = await db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.installationId, inst.id));
  assert.equal(charges.length, 1);
  assert.equal(charges[0].variableCents, 12 * 250);
  assert.equal(charges[0].totalCents, 10000 + 12 * 250);
});

test("alta con comillas o saltos de línea en los datos → 400", async () => {
  const base = {
    contactName: "Contacto",
    contactEmail: "inyeccion@example.com",
    subdomain: `inyeccion-${suffix}`,
    acceptTerms: true,
    returnUrl: "https://example.com/vuelta",
    cancelUrl: "https://example.com/cancelar",
  };
  for (const name of [
    "Coop'; DROP TABLE users; --",
    'Coop "mala"',
    "Coop\nExecStart=/bin/sh",
    "Coop `id`",
    "Coop $HOME",
  ]) {
    const res = await api("POST", "/signup", { ...base, name });
    assert.equal(res.status, 400, `debería rechazar: ${JSON.stringify(name)}`);
    assert.match(((await res.json()) as { error: string }).error, /no permitidos/i);
  }
});

test("si el script de aprovisionamiento falla, la instalación queda en error", async () => {
  const { writeFileSync, rmSync } = await import("node:fs");
  const scriptPath = `/tmp/provision-fail-${suffix}.sh`;
  writeFileSync(scriptPath, "#!/usr/bin/env bash\necho 'fallo simulado' >&2\nexit 1\n");
  process.env.PROVISION_SCRIPT = scriptPath;
  try {
    const inst = await createInstallation({ subdomain: `fallo-${suffix}` });
    const res = await api("POST", "/paypal/webhook", {
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: { id: inst.paypalSubscriptionId },
    });
    assert.equal(res.status, 200);
    await waitForStatus(inst.id, "error");
    const events = await db
      .select()
      .from(provisioningEventsTable)
      .where(eq(provisioningEventsTable.installationId, inst.id));
    assert.ok(events.some((e) => e.status === "error"), "debe registrarse el evento de error");
    // Sin cargo: una instalación fallida no se marca activa ni factura.
    const charges = await db
      .select()
      .from(billingChargesTable)
      .where(eq(billingChargesTable.installationId, inst.id));
    assert.equal(charges.length, 0);
  } finally {
    delete process.env.PROVISION_SCRIPT;
    rmSync(scriptPath, { force: true });
  }
});

test("webhook de suscripción desconocida responde 200 sin efectos", async () => {
  const res = await api("POST", "/paypal/webhook", {
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: { id: "I-NOEXISTE" },
  });
  assert.equal(res.status, 200);
});
