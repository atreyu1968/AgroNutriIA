import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable, farmsTable, auditLogTable } from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;

async function apiPatch(body: unknown) {
  const res = await fetch(`${baseUrl}/api/farms/${farmId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, raw: (await res.json()) as Record<string, unknown> };
}

async function storedRanges() {
  const [farm] = await db.select().from(farmsTable).where(eq(farmsTable.id, farmId));
  return farm.stageNutrientRanges;
}

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `stage-ranges-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Técnico rangos",
      role: "owner",
    })
    .returning();
  userId = user.id;

  token = randomUUID();
  await db.insert(sessionsTable).values({
    id: token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const [farm] = await db
    .insert(farmsTable)
    .values({
      ownerId: userId,
      name: `Finca rangos ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2,
    })
    .returning();
  farmId = farm.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("PATCH acepta rangos válidos y los persiste en la finca", async () => {
  const ranges = {
    engorde: { n: [8, 16] as [number, number], k2o: [25, 45] as [number, number] },
    paron: { n: [2, 6] as [number, number], k2o: [4, 12] as [number, number] },
  };
  const { status, raw } = await apiPatch({ stageNutrientRanges: ranges });
  assert.equal(status, 200);
  assert.deepEqual(raw.stageNutrientRanges, ranges, "la respuesta devuelve los rangos guardados");
  assert.deepEqual(await storedRanges(), ranges, "los rangos quedan persistidos en la BD");
});

test("PATCH rechaza con 422 un rango con mínimo mayor que máximo", async () => {
  const previo = await storedRanges();
  const { status, raw } = await apiPatch({
    stageNutrientRanges: { engorde: { n: [18, 10], k2o: [25, 45] } },
  });
  assert.equal(status, 422);
  assert.match(String(raw.error), /Rangos por fase no válidos/);
  assert.match(String(raw.error), /engorde/);
  assert.deepEqual(await storedRanges(), previo, "los rangos previos no cambian");
});

test("PATCH rechaza con 422 una clave de fase desconocida", async () => {
  const previo = await storedRanges();
  const { status, raw } = await apiPatch({
    stageNutrientRanges: { floracion_lunar: { n: [5, 10], k2o: [10, 20] } },
  });
  assert.equal(status, 422);
  assert.match(String(raw.error), /floracion_lunar/);
  assert.match(
    String(raw.error),
    /prefloracion.*engorde.*paron.*postcosecha/,
    "el mensaje enumera las fases permitidas",
  );
  assert.deepEqual(await storedRanges(), previo);
});

test("PATCH rechaza valores no finitos o no numéricos en los rangos", async () => {
  const previo = await storedRanges();
  // JSON no puede transportar Infinity/NaN: llegan como null o como cadena,
  // y ambos deben rechazarse (400 del esquema o 422 de la validación semántica).
  for (const bad of [
    { engorde: { n: [null, 10], k2o: [25, 45] } },
    { engorde: { n: ["Infinity", 10], k2o: [25, 45] } },
    { engorde: { n: [5, "NaN"], k2o: [25, 45] } },
  ]) {
    const { status } = await apiPatch({ stageNutrientRanges: bad });
    assert.ok(
      status === 400 || status === 422,
      `debe rechazar ${JSON.stringify(bad)} (status ${status})`,
    );
  }
  assert.deepEqual(await storedRanges(), previo);
});

test("PATCH rechaza rangos con valores negativos", async () => {
  const { status } = await apiPatch({
    stageNutrientRanges: { paron: { n: [-1, 5], k2o: [4, 12] } },
  });
  assert.ok(status === 400 || status === 422, `status inesperado: ${status}`);
});

test("PATCH con stageNutrientRanges null borra la modulación del técnico", async () => {
  const { status } = await apiPatch({ stageNutrientRanges: null });
  assert.equal(status, 200);
  assert.equal(await storedRanges(), null);
});
