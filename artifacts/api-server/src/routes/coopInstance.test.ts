import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable } from "@workspace/db";
import app from "../app";

// Instancia de cooperativa (COOP_INSTANCE=true): las rutas de Instalaciones y
// Facturación de la central quedan deshabilitadas (404) y /auth/config expone
// coopInstance para que la web oculte sus pestañas.

// node --test ejecuta cada fichero en su propio proceso, así que manipular
// process.env aquí no afecta a otros tests.
process.env.COOP_INSTANCE = "true";

let server: Server;
let baseUrl: string;
let adminToken: string;
const suffix = randomUUID();
const createdEmails: string[] = [];

async function api(method: string, path: string, token?: string) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = text;
  }
  return { status: res.status, raw };
}

before(async () => {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `coop-admin-${suffix}@test.local`,
      passwordHash: "x",
      name: "Admin coop",
      isAdmin: true,
    })
    .returning();
  createdEmails.push(u.email);
  adminToken = randomUUID();
  await db.insert(sessionsTable).values({
    id: adminToken,
    userId: u.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  await pool.end();
});

test("GET /auth/config expone coopInstance=true", async () => {
  const res = await api("GET", "/auth/config");
  assert.equal(res.status, 200);
  assert.equal((res.raw as { coopInstance: boolean }).coopInstance, true);
});

test("las rutas de Instalaciones devuelven 404 incluso para un admin", async () => {
  for (const path of ["/admin/installations", "/admin/settings/paypal"]) {
    const res = await api("GET", path, adminToken);
    assert.equal(res.status, 404, `${path} debería ser 404`);
  }
  assert.equal(
    (await api("POST", "/admin/installations/1/provision", adminToken)).status,
    404,
  );
});

test("las rutas de Facturación devuelven 404 incluso para un admin", async () => {
  for (const path of ["/admin/settings/billing", "/admin/invoices"]) {
    const res = await api("GET", path, adminToken);
    assert.equal(res.status, 404, `${path} debería ser 404`);
  }
});

test("las rutas de administración generales siguen funcionando", async () => {
  assert.equal((await api("GET", "/admin/users", adminToken)).status, 200);
  assert.equal((await api("GET", "/admin/settings/email", adminToken)).status, 200);
});
