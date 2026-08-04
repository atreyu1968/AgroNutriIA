import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  farmsTable,
  analysesTable,
  waterSourcesTable,
} from "@workspace/db";
import { blendedWaterAnalysis } from "./farmContext";
import { buildFarmContext } from "./contextBlock";

let userId: number;
let farmId: number;
let pozoId: number;
let desalId: number;

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({ email: `blend-${randomUUID()}@test.local`, passwordHash: "x", name: "Blend", role: "owner" })
    .returning();
  userId = user.id;
  const [farm] = await db
    .insert(farmsTable)
    .values({ ownerId: userId, name: `Finca blend ${randomUUID().slice(0, 6)}`, plantCount: 1000, weeklyLitresPerPlant: 80 })
    .returning();
  farmId = farm.id;
  const [pozo] = await db.insert(waterSourcesTable).values({ farmId, name: "Pozo", sharePct: 60 }).returning();
  const [desal] = await db.insert(waterSourcesTable).values({ farmId, name: "Desaladora", sharePct: 40 }).returning();
  pozoId = pozo.id;
  desalId = desal.id;
  await db.insert(analysesTable).values([
    {
      farmId,
      type: "water",
      waterSourceId: pozoId,
      sampleDate: "2026-06-01",
      parameters: [
        { name: "Conductividad", value: 2, unit: "dS/m" },
        { name: "Nitratos", value: 100, unit: "mg/L" },
        { name: "Sodio", value: 50, unit: "mg/L" },
      ],
    },
    {
      farmId,
      type: "water",
      waterSourceId: desalId,
      sampleDate: "2026-06-10",
      parameters: [
        { name: "conductividad", value: 0.5, unit: "dS/m" },
        { name: "Nitratos", value: 0, unit: "meq/L" },
      ],
    },
  ]);
});

after(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("mezcla ponderada 60/40 con unidades coherentes; unidades dispares se omiten", async () => {
  const { analysis, mix, notes } = await blendedWaterAnalysis(farmId);
  assert.ok(analysis);
  const ce = analysis!.parameters.find((p) => p.name.toLowerCase() === "conductividad");
  assert.equal(ce?.value, 1.4); // 2*0.6 + 0.5*0.4
  // Sodio solo está en el pozo: valor de la mezcla desconocido => se omite con nota
  assert.equal(analysis!.parameters.find((p) => p.name === "Sodio"), undefined);
  assert.ok(notes.some((n) => n.includes("Sodio")));
  // Nitratos con unidades distintas => omitido con nota
  assert.equal(analysis!.parameters.find((p) => p.name === "Nitratos"), undefined);
  assert.ok(notes.some((n) => n.includes("Nitratos")));
  assert.deepEqual(mix?.map((m) => m.sharePct), [60, 40]);
});

test("overrides del reparto cambian la mezcla", async () => {
  const { analysis } = await blendedWaterAnalysis(farmId, {
    overrides: [
      { waterSourceId: pozoId, sharePct: 0 },
      { waterSourceId: desalId, sharePct: 100 },
    ],
  });
  const ce = analysis!.parameters.find((p) => p.name.toLowerCase() === "conductividad");
  assert.equal(ce?.value, 0.5);
});

test("una fuente activa sin analítica marca la mezcla como incompleta", async () => {
  const [balsa] = await db
    .insert(waterSourcesTable)
    .values({ farmId, name: "Balsa", sharePct: 20 })
    .returning();
  try {
    const { analysis, notes } = await blendedWaterAnalysis(farmId, {
      overrides: [
        { waterSourceId: pozoId, sharePct: 50 },
        { waterSourceId: desalId, sharePct: 30 },
        { waterSourceId: balsa.id, sharePct: 20 },
      ],
    });
    assert.ok(analysis);
    assert.ok(notes.some((n) => n.includes("Balsa") && n.includes("incompleta")));
    // Las fuentes con analítica se ponderan sobre su reparto conocido (50/30 => 62.5/37.5)
    const ce = analysis!.parameters.find((p) => p.name.toLowerCase() === "conductividad");
    assert.equal(ce?.value, 1.438); // 2*0.625 + 0.5*0.375
    // El aviso llega al contexto de la IA (conversaciones y borradores)
    const [farm] = await db.select().from(farmsTable).where(eq(farmsTable.id, farmId));
    const ctx = buildFarmContext({
      farm,
      sectors: [],
      soil: null,
      leaf: null,
      water: analysis,
      waterNotes: notes,
      active: null,
    });
    assert.ok(ctx.includes("AVISOS DE LA MEZCLA DE AGUA"));
    assert.ok(ctx.includes("mezcla es incompleta"));
  } finally {
    await db.delete(waterSourcesTable).where(eq(waterSourcesTable.id, balsa.id));
  }
});

test("sin fuentes activas cae a la analítica más reciente", async () => {
  await db.update(waterSourcesTable).set({ sharePct: 0 }).where(eq(waterSourcesTable.farmId, farmId));
  const { analysis, mix } = await blendedWaterAnalysis(farmId);
  assert.ok(analysis);
  assert.equal(mix, null);
  assert.ok(analysis!.id !== 0);
  await db.update(waterSourcesTable).set({ sharePct: 50 }).where(eq(waterSourcesTable.farmId, farmId));
});
