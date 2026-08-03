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
  farmMembersTable,
  phytoProductsTable,
} from "@workspace/db";
import app from "../app";

// Catálogo global de fitosanitarios: upsert sin duplicados (por nº de registro
// o nombre sin mayúsculas), borrado limitado a admin/creador, validación de
// entrada, y cuaderno de tratamientos con 403 para el rol viewer.

let server: Server;
let baseUrl: string;
let adminToken: string;
let creatorToken: string;
let otherToken: string;
let viewerToken: string;
let ownerToken: string;
let farmId: number;
const extraFarmIds: number[] = [];
const createdUserIds: number[] = [];
const suffix = randomUUID().slice(0, 8);

type ApiResult = { status: number; raw: any };

async function api(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = res.status === 204 ? null : ((await res.json()) as unknown);
  return { status: res.status, raw };
}

async function productRowsByName(pattern: string) {
  return db
    .select()
    .from(phytoProductsTable)
    .where(eq(phytoProductsTable.productName, pattern));
}

before(async () => {
  const mkUser = async (name: string, isAdmin: boolean) => {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: `phyto-${name}-${suffix}@test.local`,
        passwordHash: "x",
        name: `Phyto ${name}`,
        isAdmin,
      })
      .returning();
    createdUserIds.push(u.id);
    return u;
  };
  const admin = await mkUser("admin", true);
  const creator = await mkUser("creator", false);
  const other = await mkUser("other", false);
  const viewer = await mkUser("viewer", false);
  const owner = await mkUser("owner", false);

  adminToken = randomUUID();
  creatorToken = randomUUID();
  otherToken = randomUUID();
  viewerToken = randomUUID();
  ownerToken = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(sessionsTable).values([
    { id: adminToken, userId: admin.id, expiresAt },
    { id: creatorToken, userId: creator.id, expiresAt },
    { id: otherToken, userId: other.id, expiresAt },
    { id: viewerToken, userId: viewer.id, expiresAt },
    { id: ownerToken, userId: owner.id, expiresAt },
  ]);

  const [farm] = await db
    .insert(farmsTable)
    .values({ ownerId: owner.id, name: `Finca phyto ${suffix}` })
    .returning();
  farmId = farm.id;
  // El catálogo global solo lo editan admin, propietarios o técnicos: da una
  // finca propia a creator y other para que puedan crear productos.
  const [farmCreator] = await db
    .insert(farmsTable)
    .values({ ownerId: creator.id, name: `Finca creator ${suffix}` })
    .returning();
  const [farmOther] = await db
    .insert(farmsTable)
    .values({ ownerId: other.id, name: `Finca other ${suffix}` })
    .returning();
  extraFarmIds.push(farmCreator.id, farmOther.id);
  await db.insert(farmMembersTable).values({
    farmId,
    userId: viewer.id,
    role: "viewer",
  });

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
  await db.delete(farmsTable).where(inArray(farmsTable.id, [farmId, ...extraFarmIds]));
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await pool.end();
});

// --- Catálogo: creación y upsert ---

test("crear un producto nuevo devuelve 201 con sus datos", async () => {
  const { status, raw } = await api("POST", "/phyto/products", creatorToken, {
    productName: `Fungicida Alfa ${suffix}`,
    registryNumber: `ES-${suffix}-1`,
    activeIngredient: "azoxistrobina",
    safetyDays: 3,
  });
  assert.equal(status, 201);
  assert.equal(raw.productName, `Fungicida Alfa ${suffix}`);
  assert.equal(raw.registryNumber, `ES-${suffix}-1`);
});

test("repetir el mismo nº de registro actualiza en vez de duplicar", async () => {
  const { status, raw } = await api("POST", "/phyto/products", creatorToken, {
    productName: `Fungicida Alfa renombrado ${suffix}`,
    registryNumber: `ES-${suffix}-1`,
    safetyDays: 7,
  });
  assert.equal(status, 201);
  assert.equal(raw.safetyDays, 7);
  const rows = await db
    .select()
    .from(phytoProductsTable)
    .where(eq(phytoProductsTable.registryNumber, `ES-${suffix}-1`));
  assert.equal(rows.length, 1);
});

test("mismo nombre con distinta capitalización no crea duplicado", async () => {
  const name = `Insecticida Beta ${suffix}`;
  const first = await api("POST", "/phyto/products", creatorToken, {
    productName: name,
  });
  assert.equal(first.status, 201);
  const second = await api("POST", "/phyto/products", creatorToken, {
    productName: name.toUpperCase(),
    notes: "actualizado",
  });
  assert.equal(second.status, 201);
  assert.equal(second.raw.id, first.raw.id);
  assert.equal(second.raw.notes, "actualizado");
});

test("un nombre con comodines % y _ no machaca otros productos", async () => {
  const victim = await api("POST", "/phyto/products", creatorToken, {
    productName: `Acaricida Gamma ${suffix}`,
    notes: "intacto",
  });
  assert.equal(victim.status, 201);
  const wildcard = await api("POST", "/phyto/products", otherToken, {
    productName: `%${suffix}`,
  });
  assert.equal(wildcard.status, 201);
  assert.notEqual(wildcard.raw.id, victim.raw.id);
  const underscore = await api("POST", "/phyto/products", otherToken, {
    productName: `Acaricida Gamma ________`,
  });
  assert.equal(underscore.status, 201);
  assert.notEqual(underscore.raw.id, victim.raw.id);
  const [intact] = await productRowsByName(`Acaricida Gamma ${suffix}`);
  assert.equal(intact.notes, "intacto");
});

// --- Catálogo: validación ---

test("fecha de caducidad mal formada devuelve 400", async () => {
  const { status } = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto fecha mala ${suffix}`,
    expiryDate: "31/12/2026",
  });
  assert.equal(status, 400);
});

test("números negativos devuelven 400", async () => {
  const { status } = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto negativo ${suffix}`,
    safetyDays: -1,
  });
  assert.equal(status, 400);
  const res2 = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto negativo ${suffix}`,
    maxApplicationsYear: -3,
  });
  assert.equal(res2.status, 400);
});

// --- Catálogo: borrado ---

test("quien no es creador ni admin no puede borrar (403); el creador sí (204)", async () => {
  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto borrable ${suffix}`,
  });
  assert.equal(created.status, 201);
  const id = created.raw.id as number;

  const forbidden = await api("DELETE", `/phyto/products/${id}`, otherToken);
  assert.equal(forbidden.status, 403);

  const ok = await api("DELETE", `/phyto/products/${id}`, creatorToken);
  assert.equal(ok.status, 204);
  const gone = await api("DELETE", `/phyto/products/${id}`, creatorToken);
  assert.equal(gone.status, 404);
});

test("un administrador puede borrar un producto ajeno", async () => {
  const created = await api("POST", "/phyto/products", creatorToken, {
    productName: `Producto para admin ${suffix}`,
  });
  assert.equal(created.status, 201);
  const del = await api("DELETE", `/phyto/products/${created.raw.id}`, adminToken);
  assert.equal(del.status, 204);
});

// --- Cuaderno de tratamientos ---

test("el propietario registra, lista y borra un tratamiento", async () => {
  const created = await api(
    "POST",
    `/farms/${farmId}/phyto/treatments`,
    ownerToken,
    {
      applicationDate: "2026-07-15",
      productName: `Tratamiento ${suffix}`,
      doseAmount: 150,
      doseUnit: "ml/hl",
    },
  );
  assert.equal(created.status, 201);
  const id = created.raw.id as number;

  const list = await api("GET", `/farms/${farmId}/phyto/treatments`, ownerToken);
  assert.equal(list.status, 200);
  assert.ok(list.raw.some((t: { id: number }) => t.id === id));

  const del = await api(
    "DELETE",
    `/farms/${farmId}/phyto/treatments/${id}`,
    ownerToken,
  );
  assert.equal(del.status, 204);
});

test("un viewer puede listar pero no crear ni borrar tratamientos", async () => {
  const created = await api(
    "POST",
    `/farms/${farmId}/phyto/treatments`,
    ownerToken,
    { applicationDate: "2026-07-20", productName: `Tratamiento viewer ${suffix}` },
  );
  assert.equal(created.status, 201);

  const list = await api("GET", `/farms/${farmId}/phyto/treatments`, viewerToken);
  assert.equal(list.status, 200);

  const post = await api(
    "POST",
    `/farms/${farmId}/phyto/treatments`,
    viewerToken,
    { applicationDate: "2026-07-21", productName: "Intento viewer" },
  );
  assert.equal(post.status, 403);

  const del = await api(
    "DELETE",
    `/farms/${farmId}/phyto/treatments/${created.raw.id}`,
    viewerToken,
  );
  assert.equal(del.status, 403);
});

test("una fecha de aplicación mal formada devuelve 400", async () => {
  const { status } = await api(
    "POST",
    `/farms/${farmId}/phyto/treatments`,
    ownerToken,
    { applicationDate: "15-07-2026", productName: "Fecha mala" },
  );
  assert.equal(status, 400);
});

test("una dosis negativa devuelve 400", async () => {
  const { status } = await api(
    "POST",
    `/farms/${farmId}/phyto/treatments`,
    ownerToken,
    {
      applicationDate: "2026-07-15",
      productName: "Dosis negativa",
      doseAmount: -5,
    },
  );
  assert.equal(status, 400);
});

test("quien no tiene acceso a la finca recibe 404", async () => {
  const { status } = await api(
    "GET",
    `/farms/${farmId}/phyto/treatments`,
    otherToken,
  );
  assert.equal(status, 404);
});
