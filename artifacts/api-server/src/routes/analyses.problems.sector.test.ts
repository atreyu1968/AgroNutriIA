import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  sectorsTable,
  analysesTable,
  auditLogTable,
} from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
let sectorAId: number;
let sectorBId: number;
let otherFarmId: number;
let otherSectorId: number;

async function getProblems(query = "") {
  const res = await fetch(`${baseUrl}/api/farms/${farmId}/analyses/problems${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, raw: (await res.json()) as Record<string, unknown> };
}

// Water analyses per scope. The farm has maxEcDsM=2.5:
// - sector A: EC 2.8 dS/m  → critical "water_salinity_limit"
// - sector B: EC 0.4 dS/m  → no salinity problem
// - farm-global: EC 2.0 dS/m → warning "water_salinity_tight" (>= 70% of max)
function waterAnalysis(ec: number, sectorId: number | null, sampleDate: string) {
  return {
    farmId,
    sectorId,
    type: "water" as const,
    sampleDate,
    parameters: [{ name: "Conductividad eléctrica", value: ec, unit: "dS/m" }],
  };
}

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `problems-sector-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Técnico sectores",
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
      name: `Finca sectores ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2.5,
    })
    .returning();
  farmId = farm.id;

  const [sa] = await db
    .insert(sectorsTable)
    .values({ farmId, name: "Sector A" })
    .returning();
  sectorAId = sa.id;
  const [sb] = await db
    .insert(sectorsTable)
    .values({ farmId, name: "Sector B" })
    .returning();
  sectorBId = sb.id;

  // Another farm of the same user, with its own sector (to test cross-farm sectorId).
  const [other] = await db
    .insert(farmsTable)
    .values({
      ownerId: userId,
      name: `Otra finca ${randomUUID().slice(0, 8)}`,
      plantCount: 500,
      weeklyLitresPerPlant: 60,
      maxEcDsM: 2.5,
    })
    .returning();
  otherFarmId = other.id;
  const [os] = await db
    .insert(sectorsTable)
    .values({ farmId: otherFarmId, name: "Sector ajeno" })
    .returning();
  otherSectorId = os.id;

  await db.insert(analysesTable).values([
    // Sector A saline water is NEWER than the others: without sector scoping it
    // would win as "latest of the farm" and pollute the global diagnosis.
    waterAnalysis(2.8, sectorAId, "2026-08-01"),
    waterAnalysis(0.4, sectorBId, "2026-07-15"),
    waterAnalysis(2.0, null, "2026-07-01"),
  ]);

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

function problemIds(raw: Record<string, unknown>): string[] {
  return (raw.problems as { id: string }[]).map((p) => p.id);
}

test("con sectorId usa la analítica del sector: el agua salina del sector A da problema crítico", async () => {
  const { status, raw } = await getProblems(`?sectorId=${sectorAId}`);
  assert.equal(status, 200);
  assert.ok(problemIds(raw).includes("water_salinity_limit"), "el sector A debe marcar salinidad crítica");
});

test("el sector B no hereda la analítica salina del sector A (no se mezclan sectores)", async () => {
  const { status, raw } = await getProblems(`?sectorId=${sectorBId}`);
  assert.equal(status, 200);
  const ids = problemIds(raw);
  assert.ok(!ids.includes("water_salinity_limit"), "el agua del sector B (0,4 dS/m) no supera el límite");
  assert.ok(!ids.includes("water_salinity_tight"), "tampoco debe usar la analítica global ni la del sector A");
});

test("sin sectorId opera a nivel finca: usa la analítica global aunque haya una sectorial más reciente", async () => {
  const { status, raw } = await getProblems();
  assert.equal(status, 200);
  const ids = problemIds(raw);
  assert.ok(ids.includes("water_salinity_tight"), "la global (2,0 dS/m) da margen ajustado");
  assert.ok(!ids.includes("water_salinity_limit"), "no debe colarse la analítica del sector A (2,8 dS/m)");
});

test("un sector sin analítica propia cae a la global de la finca", async () => {
  // Sector B pierde su analítica temporalmente.
  const [sbAnalysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.sectorId, sectorBId));
  await db.delete(analysesTable).where(eq(analysesTable.id, sbAnalysis.id));
  try {
    const { status, raw } = await getProblems(`?sectorId=${sectorBId}`);
    assert.equal(status, 200);
    assert.ok(
      problemIds(raw).includes("water_salinity_tight"),
      "sin analítica sectorial se usa la global (2,0 dS/m), no la de otro sector",
    );
  } finally {
    await db.insert(analysesTable).values(waterAnalysis(0.4, sectorBId, "2026-07-15"));
  }
});

test("sin globales, el nivel finca no combina analíticas de sectores distintos", async () => {
  // Finca sin analíticas globales: suelo con sodio alto en el sector B (más
  // reciente) y agua salina en el sector A. El diagnóstico global debe usar
  // solo UN sector (B, el de la analítica más reciente) y no colar el agua de A.
  const [globalWater] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.farmId, farmId));
  await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
  void globalWater;
  await db.insert(analysesTable).values([
    waterAnalysis(2.8, sectorAId, "2026-08-01"),
    {
      farmId,
      sectorId: sectorBId,
      type: "soil" as const,
      sampleDate: "2026-08-02",
      parameters: [
        { name: "Calcio de cambio", value: 21.9, unit: "meq/100g", status: "normal" },
        { name: "Magnesio de cambio", value: 10.0, unit: "meq/100g", status: "normal" },
        { name: "Potasio de cambio", value: 5.0, unit: "meq/100g", status: "normal" },
        { name: "Sodio de cambio", value: 8.6, unit: "meq/100g", status: "muy_alto" },
      ],
    },
  ]);
  try {
    const { status, raw } = await getProblems();
    assert.equal(status, 200);
    const ids = problemIds(raw);
    assert.ok(ids.includes("soil_sodium"), "usa el suelo del sector B (el más reciente)");
    assert.ok(
      !ids.includes("water_salinity_limit") && !ids.includes("water_salinity_tight"),
      "no debe combinar el agua del sector A con el suelo del sector B",
    );
  } finally {
    await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
    await db.insert(analysesTable).values([
      waterAnalysis(2.8, sectorAId, "2026-08-01"),
      waterAnalysis(0.4, sectorBId, "2026-07-15"),
      waterAnalysis(2.0, null, "2026-07-01"),
    ]);
  }
});

test("rechaza un sectorId de otra finca con 400", async () => {
  const { status, raw } = await getProblems(`?sectorId=${otherSectorId}`);
  assert.equal(status, 400);
  assert.match(String(raw.error), /sector/i);
});

test("rechaza un sectorId no numérico con 400", async () => {
  const { status } = await getProblems(`?sectorId=abc`);
  assert.equal(status, 400);
});
