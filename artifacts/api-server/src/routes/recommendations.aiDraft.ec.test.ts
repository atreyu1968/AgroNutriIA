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

// Farm: 1000 plants × 80 L/planta/semana = 80.000 L/semana.
// Fertilizer ecContribution = 1.2 → EC abonos = dosis(kg)/80 × 1.2 dS/m.
// maxEcDsM (por defecto) = 2.5 dS/m.
//   dosis 200 kg → 3.0 dS/m de abonos (+ agua) → SUPERA
//   dosis 50 kg  → 0.75 dS/m de abonos (+ agua 1.0) = 1.75 → OK

let openaiStub: Server;
let openaiCalls = 0;
// Cola de dosis que el stub devuelve, una por llamada (la última se repite).
let doseQueue: number[] = [];

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
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
    openaiCalls += 1;
    const dose = doseQueue.length > 1 ? doseQueue.shift()! : doseQueue[0] ?? 50;
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
                  title: "Programa CE test",
                  rationale: "Justificación de prueba",
                  items: [
                    { fertilizerName, weeklyDose: dose, unit: "kg", reason: "prueba" },
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
      email: `ec-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `EC Tester ${randomUUID().slice(0, 8)}`,
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
      name: `Finca CE ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
    })
    .returning();
  farmId = farm.id;

  fertilizerName = `Nitrato CE-test ${randomUUID().slice(0, 8)}`;
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
  await db.delete(recommendationsTable).where(eq(recommendationsTable.farmId, farmId));
  await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
  await db.insert(analysesTable).values({
    farmId,
    type: "water",
    sampleDate: "2026-07-01",
    parameters: [{ name: "Conductividad", value: 1.0, unit: "dS/m" }],
  });
});

after(async () => {
  server?.close();
  openaiStub?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, fertilizerId));
  await pool.end();
});

test("borrador dentro del límite de CE → una sola llamada, sin avisos de CE", async () => {
  doseQueue = [50];
  const callsBefore = openaiCalls;

  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});

  assert.equal(status, 201);
  assert.equal(openaiCalls - callsBefore, 1, "no debe reintentar");
  const rec = await latestDraft();
  assert.ok(rec.estimatedEcDsM != null && rec.estimatedEcDsM <= 2.5);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.doesNotMatch(warnings, /SUPERA LA CE MÁXIMA/);
  assert.doesNotMatch(warnings, /regener/i);
});

test("primer borrador supera la CE → reintento automático y el segundo cumple", async () => {
  doseQueue = [200, 50];
  const callsBefore = openaiCalls;

  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});

  assert.equal(status, 201);
  assert.equal(openaiCalls - callsBefore, 2, "debe reintentar exactamente una vez");
  const rec = await latestDraft();
  // Se guarda el segundo programa (dosis reducida) y cumple el límite.
  assert.equal((rec.items as { weeklyDose: number }[])[0].weeklyDose, 50);
  assert.ok(rec.estimatedEcDsM != null && rec.estimatedEcDsM <= 2.5);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.doesNotMatch(warnings, /SUPERA LA CE MÁXIMA/);
  assert.match(warnings, /se regeneró automáticamente/i);
});

test("ambos intentos superan la CE → borrador marcado como que supera la CE máxima con desglose", async () => {
  doseQueue = [200, 180];
  const callsBefore = openaiCalls;

  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});

  assert.equal(status, 201, "el borrador se entrega igualmente, marcado");
  assert.equal(openaiCalls - callsBefore, 2, "solo un reintento");
  const rec = await latestDraft();
  assert.ok(rec.estimatedEcDsM != null && rec.estimatedEcDsM > 2.5);
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /SUPERA LA CE MÁXIMA/);
  // Desglose agua + abonos y mención del reintento.
  assert.match(warnings, /del agua/);
  assert.match(warnings, /de los abonos/);
  assert.match(warnings, /regeneración/i);
});

test("el agua sola ya agota la CE máxima → no se reintenta y se marca el exceso", async () => {
  await db.delete(analysesTable).where(eq(analysesTable.farmId, farmId));
  await db.insert(analysesTable).values({
    farmId,
    type: "water",
    sampleDate: "2026-07-01",
    parameters: [{ name: "Conductividad", value: 3.0, unit: "dS/m" }],
  });
  doseQueue = [50];
  const callsBefore = openaiCalls;

  const { status } = await api(`/farms/${farmId}/recommendations/ai-draft`, {});

  assert.equal(status, 201);
  assert.equal(openaiCalls - callsBefore, 1, "sin margen no tiene sentido reintentar");
  const rec = await latestDraft();
  const warnings = (rec.warnings ?? []).join(" | ");
  assert.match(warnings, /SUPERA LA CE MÁXIMA/);
});
