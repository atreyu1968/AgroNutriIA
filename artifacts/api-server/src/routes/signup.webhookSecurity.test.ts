import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool, installationsTable } from "@workspace/db";
import app from "../app";

// Seguridad del webhook de PayPal: con webhook_id configurado, la firma se
// verifica contra /v1/notifications/verify-webhook-signature y un evento con
// firma inválida (FAILURE o error HTTP) se rechaza con 400 sin tocar el
// estado de la instalación. En producción (NODE_ENV=production) sin
// webhook_id no se acepta ningún evento.

// node --test ejecuta cada fichero en su propio proceso, así que manipular
// process.env aquí no afecta a otros tests. Se configura PayPal solo por
// entorno para no tocar app_settings (compartida con otros ficheros).
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
process.env.PAYPAL_WEBHOOK_ID = "WH-TEST-123";
delete process.env.PROVISION_SCRIPT;

// Mock de la API de PayPal: token OAuth siempre válido y respuesta de
// verificación configurable. El resto de peticiones pasan sin cambios.
const realFetch = globalThis.fetch;
let verifyCalls = 0;
let lastVerifyBody: Record<string, unknown> | null = null;
let verifyResponder: () => Response = () =>
  new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("paypal.com")) {
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
    }
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      verifyCalls++;
      lastVerifyBody = JSON.parse(String(init?.body ?? "null"));
      return verifyResponder();
    }
    throw new Error(`Petición inesperada a PayPal en tests: ${url}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

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

async function postWebhook(body: unknown) {
  return fetch(`${baseUrl}/api/paypal/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
      "paypal-transmission-id": "trans-id",
      "paypal-transmission-sig": "firma-falsa",
      "paypal-transmission-time": "2026-08-03T00:00:00Z",
    },
    body: JSON.stringify(body),
  });
}

async function createInstallation(status: string) {
  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop Firma ${suffix}`,
      contactName: "Persona Prueba",
      contactEmail: `firma-${suffix}@example.com`,
      subdomain: `firma-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
      publicToken: randomBytes(20).toString("base64url"),
      apiToken: randomBytes(24).toString("base64url"),
      paypalSubscriptionId: `I-SEC${suffix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      termsAcceptedAt: new Date(),
      status,
    })
    .returning();
  createdIds.push(inst.id);
  return inst;
}

async function statusOf(id: number): Promise<string> {
  const [row] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
  return row.status;
}

test("firma inválida (FAILURE) → 400 y la instalación no cambia de estado", async () => {
  const inst = await createInstallation("active");
  verifyResponder = () =>
    new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 });

  // Intento de suspensión falsificado.
  let res = await postWebhook({
    event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /firma/i);
  assert.equal(await statusOf(inst.id), "active");

  // Intento de activación falsificado sobre una instalación pendiente.
  const pending = await createInstallation("pending_payment");
  res = await postWebhook({
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: { id: pending.paypalSubscriptionId },
  });
  assert.equal(res.status, 400);
  assert.equal(await statusOf(pending.id), "pending_payment");
  assert.ok(verifyCalls >= 2, "debe llamarse a verify-webhook-signature");
});

test("error HTTP de la verificación también rechaza el evento", async () => {
  const inst = await createInstallation("active");
  verifyResponder = () => new Response("boom", { status: 500 });
  const res = await postWebhook({
    event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 400);
  assert.equal(await statusOf(inst.id), "active");
});

test("firma válida (SUCCESS) → 200 y el evento se procesa", async () => {
  const inst = await createInstallation("active");
  verifyResponder = () =>
    new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
  const res = await postWebhook({
    event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
    resource: { id: inst.paypalSubscriptionId },
  });
  assert.equal(res.status, 200);
  assert.equal(await statusOf(inst.id), "suspended");
  // La petición de verificación incluye el webhook_id configurado y la firma.
  assert.equal(lastVerifyBody?.webhook_id, "WH-TEST-123");
  assert.equal(lastVerifyBody?.transmission_sig, "firma-falsa");
});

test("producción sin webhook_id configurado → 400 siempre", async () => {
  const inst = await createInstallation("active");
  const prevWebhookId = process.env.PAYPAL_WEBHOOK_ID;
  const prevNodeEnv = process.env.NODE_ENV;
  delete process.env.PAYPAL_WEBHOOK_ID;
  process.env.NODE_ENV = "production";
  const callsBefore = verifyCalls;
  try {
    const res = await postWebhook({
      event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
      resource: { id: inst.paypalSubscriptionId },
    });
    assert.equal(res.status, 400);
    assert.equal(await statusOf(inst.id), "active");
    // Se rechaza sin llegar a llamar a PayPal.
    assert.equal(verifyCalls, callsBefore);
  } finally {
    process.env.PAYPAL_WEBHOOK_ID = prevWebhookId;
    process.env.NODE_ENV = prevNodeEnv;
  }
});
