import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  phytoProductsTable,
} from "@workspace/db";
import app from "../app";
import { splitProductNames } from "./phyto";

// División de fichas del catálogo que agrupan varios nombres comerciales
// ("Agroaceite, Agroil, Luqsol Premium Blue") en una ficha por marca.

let server: Server;
let baseUrl: string;
let creatorToken: string;
let otherToken: string;
const extraFarmIds: number[] = [];
const createdUserIds: number[] = [];
const suffix = randomUUID().slice(0, 8);

type ApiResult = { status: number; raw: any };

async function api(method: string, path: string, token: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = res.status === 204 ? null : ((await res.json()) as unknown);
  return { status: res.status, raw };
}

before(async () => {
  const mkUser = async (name: string) => {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: `phyto-split-${name}-${suffix}@test.local`,
        passwordHash: "x",
        name: `Split ${name}`,
        isAdmin: false,
      })
      .returning();
    createdUserIds.push(u.id);
    return u;
  };
  const creator = await mkUser("creator");
  const other = await mkUser("other");
  creatorToken = randomUUID();
  otherToken = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(sessionsTable).values([
    { id: creatorToken, userId: creator.id, expiresAt },
    { id: otherToken, userId: other.id, expiresAt },
  ]);
  // Fincas propias para poder editar el catálogo global.
  const [f1] = await db
    .insert(farmsTable)
    .values({ ownerId: creator.id, name: `Finca split c ${suffix}` })
    .returning();
  const [f2] = await db
    .insert(farmsTable)
    .values({ ownerId: other.id, name: `Finca split o ${suffix}` })
    .returning();
  extraFarmIds.push(f1.id, f2.id);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db
    .delete(phytoProductsTable)
    .where(inArray(phytoProductsTable.createdBy, createdUserIds));
  await db.delete(farmsTable).where(inArray(farmsTable.id, extraFarmIds));
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await pool.end();
});

test("splitProductNames separa por comas, punto y coma y barras, sin duplicados", () => {
  assert.deepEqual(splitProductNames("Agroaceite, Agroil; Luqsol Premium Blue / agroil"), [
    "Agroaceite",
    "Agroil",
    "Luqsol Premium Blue",
  ]);
  assert.deepEqual(splitProductNames("Producto único"), ["Producto único"]);
});

test("dividir una ficha agrupada crea una ficha por marca conservando los campos comunes", async () => {
  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Agroaceite ${suffix}, Agroil ${suffix}, Luqsol ${suffix}`,
    registryNumber: `ES-SPLIT-${suffix}`,
    activeIngredient: "aceite de parafina 79%",
    pests: "cochinilla, ácaros",
    doseInfo: "1,5 l/hl",
    safetyDays: 5,
    notes: "Notas comunes",
  });
  assert.equal(created.status, 201);
  const id = created.raw.id as number;

  const split = await api("POST", `/phyto/products/${id}/split`, creatorToken);
  assert.equal(split.status, 200);
  assert.equal(split.raw.products.length, 3);
  assert.deepEqual(split.raw.skippedNames, []);

  const names = split.raw.products.map((p: any) => p.productName);
  assert.deepEqual(names, [`Agroaceite ${suffix}`, `Agroil ${suffix}`, `Luqsol ${suffix}`]);

  // La original conserva id y nº de registro; las nuevas heredan los campos
  // comunes pero no el nº de registro ni la fecha (propios de cada marca).
  const original = split.raw.products[0];
  assert.equal(original.id, id);
  assert.equal(original.registryNumber, `ES-SPLIT-${suffix}`);
  for (const p of split.raw.products.slice(1)) {
    assert.equal(p.registryNumber, null);
    assert.equal(p.expiryDate, null);
    assert.equal(p.activeIngredient, "aceite de parafina 79%");
    assert.equal(p.pests, "cochinilla, ácaros");
    assert.equal(p.doseInfo, "1,5 l/hl");
    assert.equal(p.safetyDays, 5);
    assert.equal(p.notes, "Notas comunes");
  }

  // No queda ninguna ficha con el nombre agrupado.
  const grouped = await db
    .select()
    .from(phytoProductsTable)
    .where(eq(phytoProductsTable.productName, `Agroaceite ${suffix}, Agroil ${suffix}, Luqsol ${suffix}`));
  assert.equal(grouped.length, 0);
});

test("los nombres que ya existen en el catálogo no se duplican", async () => {
  const existing = await api("POST", "/phyto/products", creatorToken, {
    productName: `Marca B ${suffix}`,
    notes: "ficha previa intacta",
  });
  assert.equal(existing.status, 201);

  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Marca A ${suffix}, marca b ${suffix}, Marca C ${suffix}`,
  });
  assert.equal(created.status, 201);

  const split = await api("POST", `/phyto/products/${created.raw.id}/split`, creatorToken);
  assert.equal(split.status, 200);
  assert.deepEqual(split.raw.skippedNames, [`marca b ${suffix}`]);
  assert.deepEqual(
    split.raw.products.map((p: any) => p.productName),
    [`Marca A ${suffix}`, `Marca C ${suffix}`],
  );
  // La ficha previa no se ha tocado.
  const [prev] = await db
    .select()
    .from(phytoProductsTable)
    .where(eq(phytoProductsTable.id, existing.raw.id));
  assert.equal(prev.notes, "ficha previa intacta");
});

test("una ficha con un solo nombre devuelve 400", async () => {
  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto simple ${suffix}`,
  });
  assert.equal(created.status, 201);
  const split = await api("POST", `/phyto/products/${created.raw.id}/split`, creatorToken);
  assert.equal(split.status, 400);
});

test("quien no es admin ni creador no puede dividir una ficha ajena (403)", async () => {
  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Ajeno Uno ${suffix}, Ajeno Dos ${suffix}`,
  });
  assert.equal(created.status, 201);
  const split = await api("POST", `/phyto/products/${created.raw.id}/split`, otherToken);
  assert.equal(split.status, 403);
});

test("un producto inexistente devuelve 404", async () => {
  const split = await api("POST", "/phyto/products/999999/split", creatorToken);
  assert.equal(split.status, 404);
});

// Otros tests corren en paralelo sobre la misma BD, así que las aserciones
// usan "incluye" en vez de igualdad exacta sobre los totales del lote.
test("dividir todas divide las fichas propias, omite nombres existentes y respeta las ajenas", async () => {
  const pre = await api("POST", "/phyto/products", creatorToken, {
    productName: `Lote Pre ${suffix}`,
  });
  assert.equal(pre.status, 201);
  const groupedA = `Lote Uno ${suffix}, Lote Dos ${suffix}`;
  const groupedB = `Lote Pre ${suffix}, Lote Tres ${suffix}`;
  const groupedAjena = `Lote Ajena Uno ${suffix}, Lote Ajena Dos ${suffix}`;
  const a = await api("POST", "/phyto/products", creatorToken, { productName: groupedA });
  const b = await api("POST", "/phyto/products", creatorToken, { productName: groupedB });
  const ajena = await api("POST", "/phyto/products", otherToken, { productName: groupedAjena });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(ajena.status, 201);

  const r = await api("POST", "/phyto/products/split-all", creatorToken);
  assert.equal(r.status, 200);
  assert.ok(r.raw.totalGrouped >= 3);
  assert.ok(r.raw.splitProducts.includes(groupedA));
  assert.ok(r.raw.splitProducts.includes(groupedB));
  // El nombre que ya existía no se duplica.
  assert.ok(r.raw.skippedNames.includes(`Lote Pre ${suffix}`));
  // La ficha ajena se salta sin abortar el lote y queda intacta.
  assert.ok(r.raw.notOwned.includes(groupedAjena));
  const [ajenaRow] = await db
    .select()
    .from(phytoProductsTable)
    .where(eq(phytoProductsTable.id, ajena.raw.id));
  assert.equal(ajenaRow.productName, groupedAjena);

  // Las marcas propias existen ahora como fichas sueltas.
  const list = await api("GET", "/phyto/products", creatorToken);
  const names = list.raw.map((p: any) => p.productName);
  for (const n of [`Lote Uno ${suffix}`, `Lote Dos ${suffix}`, `Lote Tres ${suffix}`]) {
    assert.ok(names.includes(n), `falta ${n}`);
  }
  assert.ok(!names.includes(groupedA));
  assert.ok(!names.includes(groupedB));
});

test("sin permisos de catálogo, dividir todas devuelve 403", async () => {
  const [noFarm] = await db
    .insert(usersTable)
    .values({
      email: `phyto-splitall-nofarm-${suffix}@test.local`,
      passwordHash: "x",
      name: "Sin finca",
      isAdmin: false,
    })
    .returning();
  createdUserIds.push(noFarm.id);
  const token = randomUUID();
  await db.insert(sessionsTable).values({
    id: token,
    userId: noFarm.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const r = await api("POST", "/phyto/products/split-all", token);
  assert.equal(r.status, 403);
});
