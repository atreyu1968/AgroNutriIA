import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable } from "@workspace/db";
import { AdminCreateUserResponse, AdminUpdateUserResponse } from "@workspace/api-zod";
import app from "../app";

// Gestión de usuarios del administrador: alta de cuentas, desactivación
// (mata sesiones y bloquea login), protecciones contra auto-desactivación /
// auto-quitarse admin, y registro público desactivable con PUBLIC_REGISTRATION.

// node --test ejecuta cada fichero en su propio proceso, así que manipular
// process.env.PUBLIC_REGISTRATION aquí no afecta a otros tests.
delete process.env.PUBLIC_REGISTRATION;

let server: Server;
let baseUrl: string;
let adminId: number;
let adminToken: string;
const suffix = randomUUID();
const createdEmails: string[] = [];

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

before(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `adm-users-admin-${suffix}@test.local`,
      passwordHash: "x",
      name: "Admin gestión",
      isAdmin: true,
    })
    .returning();
  adminId = admin.id;
  createdEmails.push(admin.email);

  adminToken = randomUUID();
  await db.insert(sessionsTable).values({
    id: adminToken,
    userId: adminId,
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

test("el administrador crea un usuario (201) y el correo duplicado da 409", async () => {
  const email = `adm-users-nuevo-${suffix}@test.local`;
  createdEmails.push(email);
  const body = { email, password: "secreta123", name: "Usuario nuevo" };
  const { status, raw } = await api("POST", "/admin/users", { token: adminToken, body });
  assert.equal(status, 201);
  const user = AdminCreateUserResponse.parse(raw);
  assert.equal(user.email, email);
  assert.equal(user.active, true);
  assert.equal(user.isAdmin, false);

  const dup = await api("POST", "/admin/users", { token: adminToken, body });
  assert.equal(dup.status, 409);
});

test("desactivar una cuenta mata la sesión (401), bloquea el login (403) y reactivar lo restaura", async () => {
  const email = `adm-users-victima-${suffix}@test.local`;
  createdEmails.push(email);
  const created = await api("POST", "/admin/users", {
    token: adminToken,
    body: { email, password: "secreta123", name: "Víctima" },
  });
  assert.equal(created.status, 201);
  const victim = AdminCreateUserResponse.parse(created.raw);

  // Inicia sesión y comprueba que funciona.
  const login = await api("POST", "/auth/login", {
    body: { email, password: "secreta123" },
  });
  assert.equal(login.status, 200);
  const token = (login.raw as { token: string }).token;
  const meOk = await api("GET", "/auth/me", { token });
  assert.equal(meOk.status, 200);

  // Desactiva la cuenta.
  const deact = await api("PATCH", `/admin/users/${victim.id}`, {
    token: adminToken,
    body: { active: false },
  });
  assert.equal(deact.status, 200);
  assert.equal(AdminUpdateUserResponse.parse(deact.raw).active, false);

  // La sesión existente deja de valer y el login queda bloqueado.
  const meDead = await api("GET", "/auth/me", { token });
  assert.equal(meDead.status, 401);
  const loginBlocked = await api("POST", "/auth/login", {
    body: { email, password: "secreta123" },
  });
  assert.equal(loginBlocked.status, 403);

  // Reactivar restaura el acceso, pero el token antiguo sigue muerto:
  // desactivar borra las sesiones, no solo las oculta.
  const react = await api("PATCH", `/admin/users/${victim.id}`, {
    token: adminToken,
    body: { active: true },
  });
  assert.equal(react.status, 200);
  const meStillDead = await api("GET", "/auth/me", { token });
  assert.equal(meStillDead.status, 401);
  const loginAgain = await api("POST", "/auth/login", {
    body: { email, password: "secreta123" },
  });
  assert.equal(loginAgain.status, 200);
  const newToken = (loginAgain.raw as { token: string }).token;
  const meNew = await api("GET", "/auth/me", { token: newToken });
  assert.equal(meNew.status, 200);
});

test("un administrador no puede desactivar su propia cuenta (400)", async () => {
  const { status } = await api("PATCH", `/admin/users/${adminId}`, {
    token: adminToken,
    body: { active: false },
  });
  assert.equal(status, 400);
  const [self] = await db.select().from(usersTable).where(eq(usersTable.id, adminId));
  assert.equal(self.active, true);
});

test("un administrador no puede quitarse a sí mismo los permisos de admin (400)", async () => {
  const { status } = await api("PATCH", `/admin/users/${adminId}`, {
    token: adminToken,
    body: { isAdmin: false },
  });
  assert.equal(status, 400);
  const [self] = await db.select().from(usersTable).where(eq(usersTable.id, adminId));
  assert.equal(self.isAdmin, true);
});

async function assertRegistrationBlocked(emailTag: string) {
  const cfg = await api("GET", "/auth/config");
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.raw, { registrationEnabled: false });

  const email = `adm-users-registro-${emailTag}-${suffix}@test.local`;
  const reg = await api("POST", "/auth/register", {
    body: { email, password: "secreta123", name: "No debería entrar" },
  });
  assert.equal(reg.status, 403);
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, email));
  assert.equal(rows.length, 0);
}

test("sin PUBLIC_REGISTRATION el registro está bloqueado por defecto (403) y /auth/config lo expone", async () => {
  delete process.env.PUBLIC_REGISTRATION;
  await assertRegistrationBlocked("default");
});

test("con PUBLIC_REGISTRATION=false el registro devuelve 403 y /auth/config lo expone", async (t) => {
  process.env.PUBLIC_REGISTRATION = "false";
  t.after(() => {
    delete process.env.PUBLIC_REGISTRATION;
  });
  await assertRegistrationBlocked("false");
});

test("con PUBLIC_REGISTRATION=true el registro público funciona", async (t) => {
  process.env.PUBLIC_REGISTRATION = "true";
  t.after(() => {
    delete process.env.PUBLIC_REGISTRATION;
  });

  const cfg = await api("GET", "/auth/config");
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.raw, { registrationEnabled: true });

  const email = `adm-users-registro-abierto-${suffix}@test.local`;
  createdEmails.push(email);
  const reg = await api("POST", "/auth/register", {
    body: { email, password: "secreta123", name: "Registro abierto" },
  });
  assert.equal(reg.status, 201);
});
