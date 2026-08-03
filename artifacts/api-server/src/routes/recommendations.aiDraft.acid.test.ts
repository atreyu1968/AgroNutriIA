import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
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
  aiUsageTable,
  auditLogTable,
} from "@workspace/db";
import { encryptSecret } from "../lib/crypto";

// The happy-path test needs the OpenAI SDK to hit a local stub instead of the
// real API. The SDK reads OPENAI_BASE_URL at client construction time, so it
// must be set before the app (and its routes) create any client.
let openaiStub: Server;
let openaiCalls = 0;

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number; // farm WITH irrigation data
let dryFarmId: number; // farm WITHOUT irrigation data
let fertilizerId: number;
let fertilizerName: string;

async function api(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { error?: string; id?: number } };
}

async function insertAnalysis(
  targetFarmId: number,
  type: string,
  parameters: { name: string; value: number; unit: string }[],
) {
  const [row] = await db
    .insert(analysesTable)
    .values({ farmId: targetFarmId, type, sampleDate: "2026-07-01", parameters })
    .returning();
  return row;
}

async function draftCount(targetFarmId: number) {
  const rows = await db
    .select({ id: recommendationsTable.id })
    .from(recommendationsTable)
    .where(eq(recommendationsTable.farmId, targetFarmId));
  return rows.length;
}

async function usageCount() {
  const rows = await db
    .select({ id: aiUsageTable.id })
    .from(aiUsageTable)
    .where(eq(aiUsageTable.userId, userId));
  return rows.length;
}

before(async () => {
  // Stub OpenAI server: returns a valid chat completion whose JSON content
  // matches the ai-draft program schema.
  openaiStub = http.createServer((req, res) => {
    openaiCalls += 1;
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
                  title: "Programa de prueba con ácido",
                  rationale: "Justificación de prueba",
                  items: [
                    {
                      fertilizerName,
                      weeklyDose: 12,
                      unit: "kg",
                      reason: "prueba",
                    },
                  ],
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
      email: `acid-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `Acid Tester ${randomUUID().slice(0, 8)}`,
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
      name: `Finca ácido ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
    })
    .returning();
  farmId = farm.id;

  const [dryFarm] = await db
    .insert(farmsTable)
    .values({
      ownerId: userId,
      name: `Finca sin riego ${randomUUID().slice(0, 8)}`,
      // plantCount / weeklyLitresPerPlant intentionally left null
    })
    .returning();
  dryFarmId = dryFarm.id;

  fertilizerName = `Nitrato ácido-test ${randomUUID().slice(0, 8)}`;
  const [fert] = await db
    .insert(fertilizersTable)
    .values({ name: fertilizerName, nPct: 13, ecContribution: 1.2 })
    .returning();
  fertilizerId = fert.id;

  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  // Each test seeds its own analyses.
  await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
  await db.delete(analysesTable).where(eq(analysesTable.farmId, dryFarmId));
});

after(async () => {
  server?.close();
  openaiStub?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, fertilizerId));
  await pool.end();
});

test("useAcid sin analítica de agua → 422 claro, sin llamada al modelo ni borrador", async () => {
  await insertAnalysis(farmId, "soil", [{ name: "pH", value: 6.5, unit: "" }]);
  const callsBefore = openaiCalls;
  const usageBefore = await usageCount();
  const draftsBefore = await draftCount(farmId);

  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {
    useAcid: true,
  });

  assert.equal(status, 422);
  assert.match(json.error ?? "", /analítica de agua/i);
  assert.match(json.error ?? "", /ácido/i);
  assert.equal(openaiCalls, callsBefore, "no debe llamar al modelo");
  assert.equal(await usageCount(), usageBefore, "no debe registrar uso de IA");
  assert.equal(await draftCount(farmId), draftsBefore, "no debe crear borrador");
});

test("useAcid con analítica de agua sin pH → 422 que menciona el pH", async () => {
  await insertAnalysis(farmId, "water", [
    { name: "Bicarbonatos", value: 250, unit: "mg/L" },
  ]);
  const callsBefore = openaiCalls;
  const draftsBefore = await draftCount(farmId);

  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {
    useAcid: true,
  });

  assert.equal(status, 422);
  assert.match(json.error ?? "", /pH/);
  assert.equal(openaiCalls, callsBefore);
  assert.equal(await draftCount(farmId), draftsBefore);
});

test("useAcid con agua sin bicarbonatos/alcalinidad → 422 que los menciona", async () => {
  await insertAnalysis(farmId, "water", [{ name: "pH", value: 7.8, unit: "" }]);
  const callsBefore = openaiCalls;
  const draftsBefore = await draftCount(farmId);

  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {
    useAcid: true,
  });

  assert.equal(status, 422);
  assert.match(json.error ?? "", /bicarbonatos|alcalinidad/i);
  assert.equal(openaiCalls, callsBefore);
  assert.equal(await draftCount(farmId), draftsBefore);
});

test("useAcid sin riego semanal configurado → 422 que menciona el riego", async () => {
  await insertAnalysis(dryFarmId, "water", [
    { name: "pH", value: 7.8, unit: "" },
    { name: "Bicarbonatos", value: 250, unit: "mg/L" },
  ]);
  const callsBefore = openaiCalls;
  const draftsBefore = await draftCount(dryFarmId);

  const { status, json } = await api(`/farms/${dryFarmId}/recommendations/ai-draft`, {
    useAcid: true,
  });

  assert.equal(status, 422);
  assert.match(json.error ?? "", /riego semanal/i);
  assert.match(json.error ?? "", /litros por planta/i);
  assert.equal(openaiCalls, callsBefore);
  assert.equal(await draftCount(dryFarmId), draftsBefore);
});

test("useAcid con datos completos supera la validación y crea el borrador", async () => {
  await insertAnalysis(farmId, "water", [
    { name: "pH", value: 7.8, unit: "" },
    { name: "Bicarbonatos", value: 250, unit: "mg/L" },
  ]);
  const callsBefore = openaiCalls;
  const draftsBefore = await draftCount(farmId);

  const { status, json } = await api(`/farms/${farmId}/recommendations/ai-draft`, {
    useAcid: true,
  });

  assert.equal(status, 201, `esperaba 201, recibí ${status}: ${JSON.stringify(json)}`);
  assert.ok(openaiCalls > callsBefore, "debe llamar al modelo");
  assert.equal(await draftCount(farmId), draftsBefore + 1, "debe crear el borrador");
});
