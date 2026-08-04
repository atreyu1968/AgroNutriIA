import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  fertilizersTable,
  recommendationsTable,
  reportsTable,
  auditLogTable,
} from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
let fertilizerId: number;
let fertilizerName: string;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, raw: (await res.json()) as { id?: number; status?: string } };
}

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `report-stage-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Técnico Informes",
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
      name: `Finca informe rangos ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2,
      phenologicalStage: "Engorde del racimo",
      stageNutrientRanges: { engorde: { n: [1, 2], k2o: [3, 4] } },
    })
    .returning();
  farmId = farm.id;

  fertilizerName = `Nitrato informe ${randomUUID().slice(0, 8)}`;
  const [fert] = await db
    .insert(fertilizersTable)
    .values({
      name: fertilizerName,
      nPct: 13,
      k2oPct: 46,
      ecContribution: 1.2,
    })
    .returning();
  fertilizerId = fert.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, fertilizerId));
  await pool.end();
});

test("el informe conserva el snapshot de rangos aunque el técnico cambie la finca después", async () => {
  // 1. Programa creado con la finca en "engorde" y rangos modulados 1–2 / 3–4.
  const { status: createStatus, raw: rec } = await api(`POST`, `/farms/${farmId}/recommendations`, {
    title: "Programa con rangos modulados",
    rationale: "Justificación técnica de prueba para el informe de rangos.",
    items: [{ fertilizerId, fertilizerName, weeklyDose: 20, unit: "kg", reason: null }],
  });
  assert.equal(createStatus, 201);
  const [row] = await db
    .select({ stageComparison: recommendationsTable.stageComparison })
    .from(recommendationsTable)
    .where(eq(recommendationsTable.id, rec.id!));
  assert.ok(row.stageComparison, "el programa guarda el snapshot al crearse");
  assert.equal(row.stageComparison!.rangeSource, "tecnico");

  // 2. El técnico cambia después la fase y elimina los rangos modulados.
  await db
    .update(farmsTable)
    .set({ phenologicalStage: "Parón invernal", stageNutrientRanges: null })
    .where(eq(farmsTable.id, farmId));

  // 3. El informe del programa debe usar el snapshot persistido, no el estado actual.
  const { status: repStatus, raw: report } = await api(`POST`, `/farms/${farmId}/reports`, {
    recommendationId: rec.id,
    format: "pdf",
  });
  assert.equal(repStatus, 201);

  let readyStatus = report.status;
  for (let i = 0; i < 60 && readyStatus === "generating"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const [reportRow] = await db
      .select({ status: reportsTable.status })
      .from(reportsTable)
      .where(eq(reportsTable.id, report.id!));
    readyStatus = reportRow?.status;
  }
  assert.equal(readyStatus, "ready", "el informe termina de generarse");

  const dl = await fetch(`${baseUrl}/api/farms/${farmId}/reports/${report.id}/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(dl.status, 200);
  const parser = new PDFParse({ data: Buffer.from(await dl.arrayBuffer()) });
  const { text } = await parser.getText();
  await parser.destroy();

  assert.ok(
    text.includes("modulados por el técnico responsable"),
    "el informe mantiene la procedencia 'modulados por el técnico' del snapshot",
  );
  assert.ok(
    text.includes("engorde / llenado del racimo"),
    "el informe mantiene la fase del snapshot, no la fase actual de la finca",
  );
  assert.match(text, /1\s*[–-]\s*2/, "conserva el rango de N modulado (1–2)");
  assert.match(text, /3\s*[–-]\s*4/, "conserva el rango de K2O modulado (3–4)");
  assert.ok(
    !text.includes("parón invernal"),
    "no recalcula con la fase actual de la finca",
  );
});
