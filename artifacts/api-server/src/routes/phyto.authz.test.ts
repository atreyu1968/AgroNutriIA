import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  farmMembersTable,
  phytoProductsTable,
} from "@workspace/db";
import { CreatePhytoProductResponse } from "@workspace/api-zod";
import app from "../app";

// Autorización del catálogo compartido de fitosanitarios:
// - Solo propietarios/técnicos de alguna finca (o admin) pueden crear productos.
// - Sobrescribir un producto existente solo puede hacerlo su creador o el admin.

let server: Server;
let baseUrl: string;
let adminToken: string;
let ownerToken: string;
let otherOwnerToken: string;
let viewerToken: string;
let noFarmToken: string;
const createdUserIds: number[] = [];
const createdFarmIds: number[] = [];
const suffix = randomUUID().slice(0, 8);
const productName = `Producto AuthZ ${suffix}`;

async function postProduct(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/phyto/products`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, raw: (await res.json()) as unknown };
}

before(async () => {
  const mkUser = async (name: string, isAdmin = false) => {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: `phyto-${name}-${randomUUID()}@test.local`,
        passwordHash: "x",
        name,
        isAdmin,
      })
      .returning();
    createdUserIds.push(u.id);
    return u;
  };
  const admin = await mkUser("admin", true);
  const owner = await mkUser("owner");
  const otherOwner = await mkUser("other-owner");
  const viewer = await mkUser("viewer");
  const noFarm = await mkUser("no-farm");

  const [farm] = await db
    .insert(farmsTable)
    .values({ name: `Finca AuthZ ${suffix}`, ownerId: owner.id })
    .returning();
  const [farm2] = await db
    .insert(farmsTable)
    .values({ name: `Finca AuthZ 2 ${suffix}`, ownerId: otherOwner.id })
    .returning();
  createdFarmIds.push(farm.id, farm2.id);
  await db
    .insert(farmMembersTable)
    .values({ farmId: farm.id, userId: viewer.id, role: "viewer" });

  adminToken = randomUUID();
  ownerToken = randomUUID();
  otherOwnerToken = randomUUID();
  viewerToken = randomUUID();
  noFarmToken = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(sessionsTable).values([
    { id: adminToken, userId: admin.id, expiresAt },
    { id: ownerToken, userId: owner.id, expiresAt },
    { id: otherOwnerToken, userId: otherOwner.id, expiresAt },
    { id: viewerToken, userId: viewer.id, expiresAt },
    { id: noFarmToken, userId: noFarm.id, expiresAt },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(phytoProductsTable).where(eq(phytoProductsTable.productName, productName));
  await db.delete(farmsTable).where(inArray(farmsTable.id, createdFarmIds));
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await pool.end();
});

test("un usuario sin ninguna finca no puede crear productos en el catálogo", async () => {
  const { status } = await postProduct(noFarmToken, { productName });
  assert.equal(status, 403);
});

test("un miembro de solo lectura no puede crear productos en el catálogo", async () => {
  const { status } = await postProduct(viewerToken, { productName });
  assert.equal(status, 403);
});

test("un propietario puede crear un producto en el catálogo", async () => {
  const { status, raw } = await postProduct(ownerToken, {
    productName,
    pests: "cochinilla",
  });
  assert.equal(status, 201);
  const product = CreatePhytoProductResponse.parse(raw);
  assert.equal(product.productName, productName);
});

test("otro propietario no puede sobrescribir un producto ajeno", async () => {
  const { status } = await postProduct(otherOwnerToken, {
    productName,
    pests: "mosca blanca",
  });
  assert.equal(status, 403);
});

test("el creador sí puede actualizar su producto", async () => {
  const { status, raw } = await postProduct(ownerToken, {
    productName,
    pests: "cochinilla, trips",
  });
  assert.equal(status, 201);
  const product = CreatePhytoProductResponse.parse(raw);
  assert.equal(product.pests, "cochinilla, trips");
});

test("el administrador puede actualizar cualquier producto", async () => {
  const { status } = await postProduct(adminToken, {
    productName,
    notes: "Revisado por administración",
  });
  assert.equal(status, 201);
});
