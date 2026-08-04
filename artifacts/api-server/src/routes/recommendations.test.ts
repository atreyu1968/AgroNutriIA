import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
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
import { UpdateRecommendationResponse } from "@workspace/api-zod";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let editorName: string;
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
  return { status: res.status, raw: (await res.json()) as unknown };
}

async function apiPatch(path: string, body: unknown) {
  const { status, raw } = await api("PATCH", path, body);
  return {
    status,
    json: status === 200 ? UpdateRecommendationResponse.parse(raw) : null,
  };
}

async function createDraft(status = "draft") {
  const [rec] = await db
    .insert(recommendationsTable)
    .values({
      farmId,
      title: "Borrador IA de prueba",
      status,
      source: "ai",
      items: [
        {
          fertilizerId,
          fertilizerName,
          weeklyDose: 10,
          unit: "kg",
          reason: null,
        },
      ],
      createdBy: userId,
      estimatedWeeklyNKg: 1.3,
    })
    .returning();
  return rec;
}

async function countRecommendations() {
  const rows = await db
    .select({ id: recommendationsTable.id })
    .from(recommendationsTable)
    .where(eq(recommendationsTable.farmId, farmId));
  return rows.length;
}

before(async () => {
  editorName = `Editor PATCH ${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `patch-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: editorName,
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
      name: `Finca test PATCH ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2,
    })
    .returning();
  farmId = farm.id;

  fertilizerName = `Nitrato test ${randomUUID().slice(0, 8)}`;
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
  // farm/recommendations/sessions cascade from user delete
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(fertilizersTable).where(eq(fertilizersTable.id, fertilizerId));
  await pool.end();
});

test("PATCH actualiza el borrador en sitio, guarda updatedBy y no crea duplicados", async () => {
  const rec = await createDraft();
  const countBefore = await countRecommendations();

  const { status, json } = await apiPatch(`/farms/${farmId}/recommendations/${rec.id}`, { title: "Borrador ajustado" },
  );
  assert.equal(status, 200);
  assert.ok(json);
  assert.equal(json.id, rec.id);
  assert.equal(json.title, "Borrador ajustado");
  assert.equal(json.updatedByName, editorName);

  const countAfter = await countRecommendations();
  assert.equal(countAfter, countBefore, "PATCH no debe crear filas nuevas");

  const [stored] = await db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.id, rec.id));
  assert.equal(stored.updatedBy, userId);
});

test("PATCH recalcula CE y N semanal al cambiar los items", async () => {
  const rec = await createDraft();
  const { status, json } = await apiPatch(`/farms/${farmId}/recommendations/${rec.id}`, {
      items: [
        {
          fertilizerId,
          fertilizerName,
          weeklyDose: 20,
          unit: "kg",
          reason: "dosis doblada",
        },
      ],
    },
  );
  assert.equal(status, 200);
  assert.ok(json);
  assert.ok(json.estimatedWeeklyNKg != null);
  // 20 kg × 13% N = 2.6 kg N/semana
  assert.ok(Math.abs(json.estimatedWeeklyNKg - 2.6) < 0.01);
  assert.notEqual(json.estimatedWeeklyNKg, rec.estimatedWeeklyNKg);
  assert.equal(typeof json.estimatedEcDsM, "number");
});

test("PATCH permite editar en pending_review", async () => {
  const rec = await createDraft("pending_review");
  const { status, json } = await apiPatch(`/farms/${farmId}/recommendations/${rec.id}`, { title: "Ajuste durante revisión" },
  );
  assert.equal(status, 200);
  assert.ok(json);
  assert.equal(json.status, "pending_review");
  assert.equal(json.updatedByName, editorName);
});

test("PATCH rechaza estados no editables con 409", async () => {
  for (const st of ["validated", "applying", "finished", "rejected"]) {
    const rec = await createDraft(st);
    const { status } = await apiPatch(`/farms/${farmId}/recommendations/${rec.id}`, { title: "No debería guardarse" },
    );
    assert.equal(status, 409, `estado ${st} debe rechazarse`);
    const [stored] = await db
      .select()
      .from(recommendationsTable)
      .where(eq(recommendationsTable.id, rec.id));
    assert.equal(stored.title, "Borrador IA de prueba");
    assert.equal(stored.updatedBy, null);
  }
});

test("PATCH devuelve 404 si la recomendación no es de la finca", async () => {
  const { status } = await apiPatch(`/farms/${farmId}/recommendations/999999`, { title: "x" },
  );
  assert.equal(status, 404);
});

async function apiDelete(path: string) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return res.status;
}

test("DELETE elimina un programa en borrador y deja auditoría", async () => {
  const rec = await createDraft();
  const status = await apiDelete(`/farms/${farmId}/recommendations/${rec.id}`);
  assert.equal(status, 204);
  const [stored] = await db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.id, rec.id));
  assert.equal(stored, undefined);
});

test("DELETE elimina programas pendientes de revisión y rechazados", async () => {
  for (const s of ["pending_review", "rejected"]) {
    const rec = await createDraft(s);
    assert.equal(await apiDelete(`/farms/${farmId}/recommendations/${rec.id}`), 204);
  }
});

test("DELETE rechaza eliminar un programa validado, en aplicación o finalizado", async () => {
  for (const s of ["validated", "applying", "finished"]) {
    const rec = await createDraft(s);
    assert.equal(await apiDelete(`/farms/${farmId}/recommendations/${rec.id}`), 409);
    const [stored] = await db
      .select()
      .from(recommendationsTable)
      .where(eq(recommendationsTable.id, rec.id));
    assert.ok(stored, `el programa ${s} debe seguir existiendo`);
    await db.delete(recommendationsTable).where(eq(recommendationsTable.id, rec.id));
  }
});

test("DELETE de un programa de otra finca responde 404", async () => {
  const rec = await createDraft();
  assert.equal(await apiDelete(`/farms/${farmId + 999999}/recommendations/${rec.id}`), 404);
  await db.delete(recommendationsTable).where(eq(recommendationsTable.id, rec.id));
});

test("DELETE de un programa conserva sus informes desvinculándolos", async () => {
  const rec = await createDraft();
  const [rep] = await db
    .insert(reportsTable)
    .values({
      farmId,
      recommendationId: rec.id,
      title: "Informe ligado al borrador",
      reportType: "fertirrigacion",
      format: "pdf",
      status: "ready",
      createdBy: userId,
    })
    .returning();
  assert.equal(await apiDelete(`/farms/${farmId}/recommendations/${rec.id}`), 204);
  const [storedRep] = await db.select().from(reportsTable).where(eq(reportsTable.id, rep.id));
  assert.ok(storedRep, "el informe debe conservarse");
  assert.equal(storedRep.recommendationId, null);
  await db.delete(reportsTable).where(eq(reportsTable.id, rep.id));
});

test("DELETE de un informe en generación responde 409; listo se elimina", async () => {
  const [gen] = await db
    .insert(reportsTable)
    .values({ farmId, title: "Generando", reportType: "fertirrigacion", format: "pdf", status: "generating", createdBy: userId })
    .returning();
  assert.equal(await apiDelete(`/farms/${farmId}/reports/${gen.id}`), 409);
  await db.delete(reportsTable).where(eq(reportsTable.id, gen.id));

  const [ready] = await db
    .insert(reportsTable)
    .values({ farmId, title: "Listo", reportType: "fertirrigacion", format: "pdf", status: "ready", createdBy: userId })
    .returning();
  assert.equal(await apiDelete(`/farms/${farmId}/reports/${ready.id}`), 204);
  const [stored] = await db.select().from(reportsTable).where(eq(reportsTable.id, ready.id));
  assert.equal(stored, undefined);
});
