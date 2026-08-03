/**
 * Límites del modo demostración (DEMO_MODE).
 *
 * El modo demo se activa por variable de entorno y es por proceso, por eso
 * estas pruebas viven en su propio fichero: node --test ejecuta cada fichero
 * en un proceso aparte, así que DEMO_MODE=true no afecta al resto de tests.
 */
process.env.DEMO_MODE = "true";

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  farmsTable,
  reportsTable,
  auditLogTable,
} from "@workspace/db";
import { demoMode, DEMO_FARM_LIMIT_MESSAGE, DEMO_REPORT_LIMIT_MESSAGE } from "../lib/demo";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
// Informes preexistentes (datos de desarrollo) neutralizados durante estas
// pruebas: el límite de la demo cuenta informes de forma global, así que los
// marcamos como "error" y restauramos su estado original al terminar.
let preexisting: { id: number; status: string }[] = [];

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { error?: string } };
}

async function insertReport(status: string, reportType = "fertirrigacion") {
  const [report] = await db
    .insert(reportsTable)
    .values({
      farmId,
      title: `Informe demo test (${status})`,
      reportType,
      format: "pdf",
      status,
      createdBy: userId,
    })
    .returning();
  return report;
}

before(async () => {
  assert.ok(demoMode(), "DEMO_MODE debe estar activo en este proceso de test");

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `demo-limits-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `Demo Limits ${randomUUID().slice(0, 8)}`,
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

  // La única finca permitida en la demo (insertada directamente en BD).
  const [farm] = await db
    .insert(farmsTable)
    .values({
      ownerId: userId,
      name: `Finca demo test ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2,
    })
    .returning();
  farmId = farm.id;

  preexisting = await db
    .select({ id: reportsTable.id, status: reportsTable.status })
    .from(reportsTable)
    .where(and(eq(reportsTable.reportType, "fertirrigacion"), ne(reportsTable.status, "error")));
  if (preexisting.length) {
    await db
      .update(reportsTable)
      .set({ status: "error" })
      .where(
        inArray(
          reportsTable.id,
          preexisting.map((r) => r.id),
        ),
      );
  }

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  // Cada test parte sin informes de esta finca.
  await db.delete(reportsTable).where(eq(reportsTable.farmId, farmId));
});

after(async () => {
  server?.close();
  await db.delete(reportsTable).where(eq(reportsTable.farmId, farmId));
  for (const r of preexisting) {
    await db.update(reportsTable).set({ status: r.status }).where(eq(reportsTable.id, r.id));
  }
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  // finca y sesión caen en cascada al borrar el usuario
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("la segunda finca se rechaza con 403 y el mensaje de la demo", async () => {
  const { status, json } = await api("POST", "/farms", {
    name: "Segunda finca prohibida",
    plantCount: 500,
    weeklyLitresPerPlant: 60,
    maxEcDsM: 2,
  });
  assert.equal(status, 403);
  assert.equal(json.error, DEMO_FARM_LIMIT_MESSAGE);

  const farms = await db.select().from(farmsTable).where(eq(farmsTable.ownerId, userId));
  assert.equal(farms.length, 1, "no debe haberse creado ninguna finca nueva");
});

test("el segundo informe del mismo tipo se rechaza con 403", async () => {
  await insertReport("completed");

  const { status, json } = await api("POST", `/farms/${farmId}/reports`, {
    reportType: "fertirrigacion",
    format: "pdf",
  });
  assert.equal(status, 403);
  assert.equal(json.error, DEMO_REPORT_LIMIT_MESSAGE);

  const reports = await db.select().from(reportsTable).where(eq(reportsTable.farmId, farmId));
  assert.equal(reports.length, 1, "no debe haberse creado ningún informe nuevo");
});

test("un informe en estado error no cuenta para el límite", async () => {
  await insertReport("error");

  const { status } = await api("POST", `/farms/${farmId}/reports`, {
    reportType: "fertirrigacion",
    format: "pdf",
  });
  assert.equal(status, 201, "el informe fallido no debe bloquear el reintento");
});
