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
  fertilizersTable,
  recommendationsTable,
  analysesTable,
  credentialsTable,
  auditLogTable,
} from "@workspace/db";
import { encryptSecret } from "../lib/crypto";

// Tope de dosis plausibles del borrador IA (en MASA, con densidad para litros):
// Finca: 1000 plantas × 80 L/planta/semana = 80.000 L/semana de riego.
//   → maxItemKg = maxTotalKg = 80.000 × 3 g/L / 1000 = 240 kg/semana.
// Sin volumen de riego: fallback por superficie (kg/ha) o por plantas, con aviso.

let openaiStub: Server;
// Items que el stub devuelve en la siguiente llamada.
let stubItems: { fertilizerName: string; weeklyDose: number; unit: string; reason: string }[] = [];

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
let solidId: number;
let solidName: string;
let liquidId: number;
let liquidName: string;

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
                  title: "Programa tope de dosis",
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
      email: `dosecap-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `DoseCap Tester ${randomUUID().slice(0, 8)}`,
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
      name: `Finca DoseCap ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
    })
    .returning();
  farmId = farm.id;

  // Sin aporte de CE para que la validación de CE no interfiera en estos tests.
  solidName = `Solido DoseCap ${randomUUID().slice(0, 8)}`;
  const [solid] = await db
    .insert(fertilizersTable)
    .values({ name: solidName, nPct: 13, ecContribution: 0 })
    .returning();
  solidId = solid.id;

  liquidName = `Liquido DoseCap ${randomUUID().slice(0, 8)}`;
  const [liquid] = await db
    .insert(fertilizersTable)
    .values({ name: liquidName, nPct: 8, ecContribution: 0, densityKgL: 1.5 })
    .returning();
  liquidId = liquid.id;

  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  // Estado base de la finca: con volumen de riego (1000 plantas × 80 L).
  await db
    .update(farmsTable)
    .set({ plantCount: 1000, weeklyLitresPerPlant: 80, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
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
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, liquidId));
  await pool.end();
});

test("dosis dentro del tope (3 g/L de agua) → borrador creado sin descartes", async () => {
  // Tope por producto: 240 kg. 200 kg de sólido y 100 L × 1,5 kg/L = 150 kg... ambos ≤ 240
  // pero la suma superaría el total; usamos dosis holgadas.
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 100, unit: "kg", reason: "aporte de N" },
    { fertilizerName: liquidName, weeklyDose: 50, unit: "L", reason: "aporte de N líquido" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 201);
  const rec = await latestDraft();
  assert.equal((rec.items as unknown[]).length, 2);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.doesNotMatch(warnings, /descartados/i);
});

test("producto líquido cuya masa (dosis × densidad) supera el tope se descarta con aviso", async () => {
  // 200 L × 1,5 kg/L = 300 kg > 240 kg de tope por producto → se descarta.
  // En litros "a secas" (200 < 240) colaría: la conversión con densidad es la clave.
  stubItems = [
    { fertilizerName: liquidName, weeklyDose: 200, unit: "L", reason: "aporte líquido" },
    { fertilizerName: solidName, weeklyDose: 50, unit: "kg", reason: "aporte de N" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 201);
  const rec = await latestDraft();
  const items = rec.items as { fertilizerName: string }[];
  assert.equal(items.length, 1);
  assert.equal(items[0].fertilizerName, solidName);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /descartados/i);
  assert.ok(warnings.includes(liquidName), "el aviso debe citar el producto descartado");
});

test("todos los productos superan el tope por dosis → 422 y no se guarda borrador", async () => {
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 500, unit: "kg", reason: "disparate" },
  ];
  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 422);
  assert.match(String(json.error), /descartado la propuesta/i);
  assert.equal(await latestDraft(), undefined);
});

test("dosis individuales válidas pero total en masa > tope → 422 con el total y el máximo", async () => {
  // 150 kg + 100 L × 1,5 = 150 kg → total 300 kg > 240 kg de tope total.
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 150, unit: "kg", reason: "aporte de N" },
    { fertilizerName: liquidName, weeklyDose: 100, unit: "L", reason: "aporte líquido" },
  ];
  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 422);
  assert.match(String(json.error), /fuera de todo rango plausible/i);
  assert.match(String(json.error), /300 kg\/semana/);
  assert.match(String(json.error), /240 kg/);
  assert.equal(await latestDraft(), undefined);
});

test("sin volumen de riego, con superficie → tope por hectárea y aviso en warnings", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: 2 })
    .where(eq(farmsTable.id, farmId));
  // Tope por producto: 2 ha × 100 = 200 kg. 150 kg pasa; 250 kg se descartaría.
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 150, unit: "kg", reason: "aporte de N" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 201);
  const rec = await latestDraft();
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /acotado por superficie/i);
});

test("sin volumen de riego, con superficie: una dosis por encima del tope por hectárea se descarta", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: 2 })
    .where(eq(farmsTable.id, farmId));
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 250, unit: "kg", reason: "disparate" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 422, "sin ningún producto válido no hay borrador");
});

test("sin volumen ni superficie, con plantas → tope por planta y aviso en warnings", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: 500, weeklyLitresPerPlant: null, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
  // Tope por producto: 500 × 0,1 = 50 kg.
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 40, unit: "kg", reason: "aporte de N" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 201);
  const rec = await latestDraft();
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /acotado por número de plantas/i);
});

test("sin plantas, superficie ni riego → topes genéricos con aviso", async () => {
  await db
    .update(farmsTable)
    .set({ plantCount: null, weeklyLitresPerPlant: null, surfaceHa: null })
    .where(eq(farmsTable.id, farmId));
  stubItems = [
    { fertilizerName: solidName, weeklyDose: 50, unit: "kg", reason: "aporte de N" },
  ];
  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});
  assert.equal(status, 201);
  const rec = await latestDraft();
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /topes de dosis genéricos/i);
});
