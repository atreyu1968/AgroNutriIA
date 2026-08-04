import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { desc, eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  sectorsTable,
  fertilizersTable,
  recommendationsTable,
  analysesTable,
  credentialsTable,
  auditLogTable,
} from "@workspace/db";
import { encryptSecret } from "../lib/crypto";

// Topes de dosis del borrador IA para programas POR SECTOR:
// cuando se pide un borrador con sectorId, los topes deben calcularse con los
// datos del SECTOR (plantas × L/planta/semana, superficie), con fallback a los
// de la finca cuando el sector no los tiene.
//
// Finca: 1000 plantas × 80 L = 80.000 L/semana → tope finca = 240 kg.
// Sector: 100 plantas × 20 L = 2.000 L/semana → tope sector = 6 kg.

let openaiStub: Server;
let stubItems: { fertilizerName: string; weeklyDose: number; unit: string; reason: string }[] = [];

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
let sectorId: number;
let solidId: number;
let solidName: string;

async function api(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function latestDraft() {
  const [row] = await db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.farmId, farmId))
    .orderBy(desc(recommendationsTable.id))
    .limit(1);
  return row;
}

before(async () => {
  openaiStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  title: "Programa tope de dosis por sector",
                  rationale: "Justificación de prueba",
                  items: stubItems,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    });
  });
  openaiStub.listen(0);
  await new Promise<void>((resolve) => openaiStub.once("listening", resolve));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(openaiStub.address() as AddressInfo).port}/v1`;

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `dosecap-sector-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `DoseCap Sector Tester ${randomUUID().slice(0, 8)}`,
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

  await db.insert(credentialsTable).values({
    userId,
    provider: "openai",
    name: "clave de test",
    encryptedKey: encryptSecret("sk-test-not-a-real-key"),
    maskedKey: "sk-...key",
    selectedModel: "gpt-4o-mini",
    isDefault: true,
    isActive: true,
  });

  const [farm] = await db
    .insert(farmsTable)
    .values({
      ownerId: userId,
      name: `Finca DoseCap Sector ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
    })
    .returning();
  farmId = farm.id;

  const [sector] = await db
    .insert(sectorsTable)
    .values({
      farmId,
      name: `Sector DoseCap ${randomUUID().slice(0, 8)}`,
      plantCount: 100,
      weeklyLitresPerPlant: 20,
    })
    .returning();
  sectorId = sector.id;

  // Sin aporte de CE para que la validación de CE no interfiera en estos tests.
  solidName = `Solido DoseCapSector ${randomUUID().slice(0, 8)}`;
  const [solid] = await db
    .insert(fertilizersTable)
    .values({ name: solidName, nPct: 13, ecContribution: 0 })
    .returning();
  solidId = solid.id;

  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  // Estado base: finca con riego (1000 × 80 L) y sector con riego propio (100 × 20 L).
  await db
    .update(farmsTable)
    .set({ plantCount: 1000, weeklyLitresPerPlant: 80, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
  await db
    .update(sectorsTable)
    .set({ plantCount: 100, weeklyLitresPerPlant: 20, surfaceHa: null })
    .where(eq(sectorsTable.id, sectorId));
  await db.delete(recommendationsTable).where(eq(recommendationsTable.farmId, farmId));
  await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
  await db.insert(analysesTable).values({
    farmId,
    type: "water",
    sampleDate: "2026-07-01",
    parameters: [{ name: "Conductividad", value: 0.5, unit: "dS/m" }],
  });
});

after(async () => {
  server?.close();
  openaiStub?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, solidId));
  await pool.end();
});

test("sector con riego propio: dosis dentro del tope del sector → borrador creado con el sector asignado", async () => {
  // Tope del sector: 2.000 L × 3 g/L = 6 kg. 5 kg pasa.
  stubItems = [{ fertilizerName: solidName, weeklyDose: 5, unit: "kg", reason: "aporte de N" }];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 201);
  const rec = await latestDraft();
  assert.equal(rec.sectorId, sectorId);
  assert.equal((rec.items as unknown[]).length, 1);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.doesNotMatch(warnings, /descartados/i);
});

test("el tope se calcula con el volumen del SECTOR, no el de la finca", async () => {
  // 100 kg pasaría de sobra el tope de la finca (240 kg) pero supera con creces
  // el del sector (6 kg): si la resolución usara los datos de la finca, colaría.
  stubItems = [{ fertilizerName: solidName, weeklyDose: 100, unit: "kg", reason: "disparate" }];
  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 422);
  assert.match(String(json.error), /descartado la propuesta/i);
  assert.equal(await latestDraft(), undefined);
});

test("total en masa por encima del tope del sector → 422 aunque cabría en el de la finca", async () => {
  // Dos dosis de 4 kg: cada una ≤ 6 kg (tope por producto del sector), pero el
  // total (8 kg) supera el techo total del sector (6 kg) y quedaría lejísimos
  // del de la finca (240 kg).
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 4, unit: "kg", reason: "aporte de N" },
    { fertilizerName: solidName, weeklyDose: 4, unit: "kg", reason: "refuerzo" },
  ];
  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 422);
  assert.match(String(json.error), /fuera de todo rango plausible/i);
  assert.match(String(json.error), /8 kg\/semana/);
  assert.match(String(json.error), /6 kg/);
  assert.equal(await latestDraft(), undefined);
});

test("sector sin riego propio: se usa el volumen de la finca como fallback", async () => {
  // Sector sin plantas ni litros → plausiblePlants/Lpp caen a los de la finca
  // (1000 × 80 = 80.000 L → tope 240 kg). 100 kg pasa sin avisos de acotación.
  await db
    .update(sectorsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null })
    .where(eq(sectorsTable.id, sectorId));
  stubItems = [{ fertilizerName: solidName, weeklyDose: 100, unit: "kg", reason: "aporte de N" }];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 201);
  const rec = await latestDraft();
  assert.equal(rec.sectorId, sectorId);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.doesNotMatch(warnings, /acotado/i);
  assert.doesNotMatch(warnings, /descartados/i);
});

test("sin riego en sector ni finca, con superficie del sector → tope por hectárea del sector y aviso", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
  // Sector: 2 ha → tope por producto 200 kg; 150 kg pasa, 250 kg no.
  await db
    .update(sectorsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: 2 })
    .where(eq(sectorsTable.id, sectorId));
  stubItems = [{ fertilizerName: solidName, weeklyDose: 150, unit: "kg", reason: "aporte de N" }];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 201);
  const rec = await latestDraft();
  assert.equal(rec.sectorId, sectorId);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /acotado por superficie/i);
});

test("sin riego, con superficie del sector: una dosis por encima del tope por hectárea se descarta", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
  await db
    .update(sectorsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: 2 })
    .where(eq(sectorsTable.id, sectorId));
  stubItems = [{ fertilizerName: solidName, weeklyDose: 250, unit: "kg", reason: "disparate" }];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, { sectorId });
  assert.equal(status, 422, "sin ningún producto válido no hay borrador");
  assert.equal(await latestDraft(), undefined);
});
