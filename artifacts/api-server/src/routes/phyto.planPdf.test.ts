import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
  reportsTable,
} from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `plan-pdf-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: `Plan PDF ${randomUUID().slice(0, 8)}`,
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
      name: `Finca plan PDF ${randomUUID().slice(0, 8)}`,
      plantCount: 500,
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
  const reports = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.farmId, farmId));
  for (const r of reports) {
    if (r.filePath) fs.rmSync(r.filePath, { force: true });
  }
  await db.delete(reportsTable).where(eq(reportsTable.farmId, farmId));
  await db.delete(farmsTable).where(eq(farmsTable.id, farmId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  server.close();
  await pool.end();
});

test("descargar el plan lo archiva como informe listo y re-descargable", async () => {
  const res = await fetch(`${baseUrl}/api/farms/${farmId}/phyto/plan-pdf`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      answer: "# Plan\n- Aplicar producto X a 150 ml/hl",
      question: "¿Qué aplico contra cochinilla?",
      pests: ["cochinilla"],
      sources: ["https://www.mapa.gob.es"],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.subarray(0, 4).toString() === "%PDF");

  // Queda archivado como informe "plan_fitosanitario" listo, con fichero en disco.
  const reports = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.farmId, farmId));
  assert.equal(reports.length, 1);
  const report = reports[0];
  assert.equal(report.reportType, "plan_fitosanitario");
  assert.equal(report.status, "ready");
  assert.match(report.title, /^Plan fitosanitario \(cochinilla\)/);
  assert.ok(report.filePath && fs.existsSync(report.filePath));

  // Aparece en el listado de informes con URL de descarga.
  const listRes = await fetch(`${baseUrl}/api/farms/${farmId}/reports`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as Array<{
    id: number;
    reportType: string;
    downloadUrl: string | null;
  }>;
  const listed = list.find((r) => r.id === report.id);
  assert.ok(listed);
  assert.equal(listed.reportType, "plan_fitosanitario");
  assert.ok(listed.downloadUrl);

  // Y puede volver a descargarse desde el endpoint de informes.
  const dlRes = await fetch(
    `${baseUrl}/api/farms/${farmId}/reports/${report.id}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(dlRes.status, 200);
  const dl = Buffer.from(await dlRes.arrayBuffer());
  assert.ok(dl.subarray(0, 4).toString() === "%PDF");
});

test("sin acceso a la finca no se archiva ningún plan", async () => {
  const [other] = await db
    .insert(usersTable)
    .values({
      email: `plan-pdf-outsider-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Outsider",
      role: "owner",
    })
    .returning();
  const otherToken = randomUUID();
  await db.insert(sessionsTable).values({
    id: otherToken,
    userId: other.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  try {
    const res = await fetch(`${baseUrl}/api/farms/${farmId}/phyto/plan-pdf`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${otherToken}`,
      },
      body: JSON.stringify({ answer: "Plan ajeno" }),
    });
    assert.equal(res.status, 404);
    const reports = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.farmId, farmId));
    assert.equal(
      reports.filter((r) => r.title.includes("ajeno")).length,
      0,
    );
  } finally {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, other.id));
    await db.delete(usersTable).where(eq(usersTable.id, other.id));
  }
});
