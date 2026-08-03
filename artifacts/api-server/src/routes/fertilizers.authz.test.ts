import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  fertilizersTable,
} from "@workspace/db";
import { UpdateFertilizerResponse } from "@workspace/api-zod";
import app from "../app";

// Autorización del catálogo de fertilizantes: solo un administrador puede
// modificar (PATCH) o borrar productos; un usuario normal recibe 403.

let server: Server;
let baseUrl: string;
let adminToken: string;
let userToken: string;
let fertilizerId: number;
const createdUserIds: number[] = [];

async function apiPatch(token: string, id: number, body: unknown) {
  const res = await fetch(`${baseUrl}/api/fertilizers/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, raw: (await res.json()) as unknown };
}

before(async () => {
  const suffix = randomUUID();
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `fert-admin-${suffix}@test.local`,
      passwordHash: "x",
      name: "Admin catálogo",
      isAdmin: true,
    })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `fert-user-${suffix}@test.local`,
      passwordHash: "x",
      name: "Usuario normal",
      isAdmin: false,
    })
    .returning();
  createdUserIds.push(admin.id, user.id);

  adminToken = randomUUID();
  userToken = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(sessionsTable).values([
    { id: adminToken, userId: admin.id, expiresAt },
    { id: userToken, userId: user.id, expiresAt },
  ]);

  const [fert] = await db
    .insert(fertilizersTable)
    .values({
      name: `Producto sin riqueza ${suffix.slice(0, 8)}`,
      formulaType: "solid",
      nPct: 0,
      p2o5Pct: 0,
      k2oPct: 0,
    })
    .returning();
  fertilizerId = fert.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(fertilizersTable).where(inArray(fertilizersTable.id, [fertilizerId]));
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await pool.end();
});

test("un usuario normal no puede modificar la composición del catálogo", async () => {
  const { status } = await apiPatch(userToken, fertilizerId, { nPct: 15 });
  assert.equal(status, 403);
});

test("un usuario normal no puede renombrar un producto del catálogo", async () => {
  const { status } = await apiPatch(userToken, fertilizerId, { name: "Renombrado" });
  assert.equal(status, 403);
});

test("un usuario normal no puede borrar un producto del catálogo", async () => {
  const res = await fetch(`${baseUrl}/api/fertilizers/${fertilizerId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${userToken}` },
  });
  assert.equal(res.status, 403);
});

test("un administrador puede corregir la composición y el tipo", async () => {
  const { status, raw } = await apiPatch(adminToken, fertilizerId, {
    formulaType: "liquid",
    nPct: 3,
    p2o5Pct: 0,
    k2oPct: 8,
    caoPct: 0,
    mgoPct: 1.5,
    so3Pct: 0,
    boronPct: 0.2,
  });
  assert.equal(status, 200);
  const fert = UpdateFertilizerResponse.parse(raw);
  assert.equal(fert.formulaType, "liquid");
  assert.equal(fert.nPct, 3);
  assert.equal(fert.k2oPct, 8);
  assert.equal(fert.boronPct, 0.2);
});

test("un administrador no puede guardar una composición inválida", async () => {
  const { status } = await apiPatch(adminToken, fertilizerId, { nPct: "no-numero" });
  assert.equal(status, 400);
});
