import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable, appSettingsTable } from "@workspace/db";
import { AdminGetEmailSettingsResponse } from "@workspace/api-zod";
import app from "../app";

// Configuración de email (Resend) en Administración: solo admins, la clave se
// guarda cifrada en app_settings y nunca sale del servidor sin enmascarar, la
// semántica de campos del PUT (omitido = no tocar, null/vacío = borrar) y el
// fallback a variables de entorno cuando la BD está vacía.

// node --test ejecuta cada fichero en su propio proceso, así que manipular
// process.env aquí no afecta a otros tests.
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

const KEY_API = "resend_api_key";
const KEY_FROM = "email_from";

let server: Server;
let baseUrl: string;
let adminToken: string;
let userToken: string;
const suffix = randomUUID();
const createdEmails: string[] = [];
// Guardamos lo que hubiera en app_settings para restaurarlo al final.
let savedRows: { key: string; value: string }[] = [];

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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

async function clearSettings() {
  await db.delete(appSettingsTable).where(inArray(appSettingsTable.key, [KEY_API, KEY_FROM]));
}

async function storedValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

async function makeUser(isAdmin: boolean): Promise<string> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `adm-email-${isAdmin ? "admin" : "user"}-${suffix}@test.local`,
      passwordHash: "x",
      name: isAdmin ? "Admin email" : "Usuario normal",
      isAdmin,
    })
    .returning();
  createdEmails.push(u.email);
  const token = randomUUID();
  await db.insert(sessionsTable).values({
    id: token,
    userId: u.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

before(async () => {
  savedRows = (
    await db
      .select()
      .from(appSettingsTable)
      .where(inArray(appSettingsTable.key, [KEY_API, KEY_FROM]))
  )
    .filter((r) => r.value != null)
    .map((r) => ({ key: r.key, value: r.value as string }));
  await clearSettings();

  adminToken = await makeUser(true);
  userToken = await makeUser(false);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await clearSettings();
  for (const row of savedRows) {
    await db.insert(appSettingsTable).values({ ...row, updatedAt: new Date() });
  }
  await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  await pool.end();
});

test("GET y PUT /admin/settings/email devuelven 403 a un usuario no admin y 401 sin sesión", async () => {
  assert.equal((await api("GET", "/admin/settings/email", { token: userToken })).status, 403);
  assert.equal(
    (
      await api("PUT", "/admin/settings/email", {
        token: userToken,
        body: { resendApiKey: "re_hack" },
      })
    ).status,
    403,
  );
  assert.equal((await api("GET", "/admin/settings/email")).status, 401);
  // El intento del no-admin no ha escrito nada.
  assert.equal(await storedValue(KEY_API), null);
});

test("sin nada en BD ni en el entorno: configured=false y source='none'", async () => {
  const { status, raw } = await api("GET", "/admin/settings/email", { token: adminToken });
  assert.equal(status, 200);
  const body = AdminGetEmailSettingsResponse.parse(raw);
  assert.equal(body.configured, false);
  assert.equal(body.source, "none");
  assert.equal(body.apiKeyMasked, null);
  assert.equal(body.emailFrom, null);
});

test("con RESEND_API_KEY en el entorno y BD vacía: source='env' y la clave del entorno no se expone", async (t) => {
  process.env.RESEND_API_KEY = "re_env_secret_key_123456";
  t.after(() => {
    delete process.env.RESEND_API_KEY;
  });
  const { status, raw } = await api("GET", "/admin/settings/email", { token: adminToken });
  assert.equal(status, 200);
  const body = AdminGetEmailSettingsResponse.parse(raw);
  assert.equal(body.configured, true);
  assert.equal(body.source, "env");
  // La clave del entorno nunca viaja al cliente, ni siquiera enmascarada.
  assert.equal(body.apiKeyMasked, null);
  assert.ok(!JSON.stringify(raw).includes("re_env_secret_key"));
});

test("PUT con clave: respuesta solo enmascarada y valor cifrado en app_settings", async () => {
  const plainKey = `re_${suffix.replaceAll("-", "")}`;
  const { status, raw } = await api("PUT", "/admin/settings/email", {
    token: adminToken,
    body: { resendApiKey: plainKey, emailFrom: "AgroNutri <no-reply@test.local>" },
  });
  assert.equal(status, 200);
  const body = AdminGetEmailSettingsResponse.parse(raw);
  assert.equal(body.configured, true);
  assert.equal(body.source, "db");
  assert.equal(body.emailFrom, "AgroNutri <no-reply@test.local>");
  // La respuesta nunca contiene la clave completa, solo la versión enmascarada.
  assert.ok(body.apiKeyMasked);
  assert.notEqual(body.apiKeyMasked, plainKey);
  assert.ok(body.apiKeyMasked!.includes("••••"));
  assert.ok(!JSON.stringify(raw).includes(plainKey));

  // En la tabla, el valor está cifrado: no empieza por "re_" ni contiene la clave.
  const stored = await storedValue(KEY_API);
  assert.ok(stored);
  assert.ok(!stored!.startsWith("re_"));
  assert.ok(!stored!.includes(plainKey));
  // El remitente no es secreto y se guarda en claro.
  assert.equal(await storedValue(KEY_FROM), "AgroNutri <no-reply@test.local>");
});

test("PUT con un campo omitido no toca el otro; null o vacío lo borra", async () => {
  const storedBefore = await storedValue(KEY_API);
  assert.ok(storedBefore, "el test anterior deja una clave guardada");

  // Omitir resendApiKey: solo cambia emailFrom, la clave queda intacta.
  const r1 = await api("PUT", "/admin/settings/email", {
    token: adminToken,
    body: { emailFrom: "Otro <otro@test.local>" },
  });
  assert.equal(r1.status, 200);
  const b1 = AdminGetEmailSettingsResponse.parse(r1.raw);
  assert.equal(b1.source, "db");
  assert.equal(b1.emailFrom, "Otro <otro@test.local>");
  assert.equal(await storedValue(KEY_API), storedBefore);

  // emailFrom vacío lo borra; resendApiKey omitido sigue intacto.
  const r2 = await api("PUT", "/admin/settings/email", {
    token: adminToken,
    body: { emailFrom: "" },
  });
  assert.equal(r2.status, 200);
  assert.equal(AdminGetEmailSettingsResponse.parse(r2.raw).emailFrom, null);
  assert.equal(await storedValue(KEY_FROM), null);
  assert.equal(await storedValue(KEY_API), storedBefore);

  // resendApiKey null borra la clave y vuelve a source 'none' (sin entorno).
  const r3 = await api("PUT", "/admin/settings/email", {
    token: adminToken,
    body: { resendApiKey: null },
  });
  assert.equal(r3.status, 200);
  const b3 = AdminGetEmailSettingsResponse.parse(r3.raw);
  assert.equal(b3.configured, false);
  assert.equal(b3.source, "none");
  assert.equal(b3.apiKeyMasked, null);
  assert.equal(await storedValue(KEY_API), null);
});

test("borrada la clave de BD, vuelve el fallback al entorno (source='env')", async (t) => {
  process.env.RESEND_API_KEY = "re_env_fallback_9876";
  t.after(() => {
    delete process.env.RESEND_API_KEY;
  });
  const { status, raw } = await api("GET", "/admin/settings/email", { token: adminToken });
  assert.equal(status, 200);
  const body = AdminGetEmailSettingsResponse.parse(raw);
  assert.equal(body.configured, true);
  assert.equal(body.source, "env");
  assert.equal(body.apiKeyMasked, null);
});
