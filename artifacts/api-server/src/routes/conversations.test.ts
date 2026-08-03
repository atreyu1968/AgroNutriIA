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
  farmMembersTable,
  conversationsTable,
  messagesTable,
  auditLogTable,
} from "@workspace/db";
import {
  GetConversationResponse,
  PreviewReportNotesResponse,
} from "@workspace/api-zod";
import app from "../app";

let server: Server;
let baseUrl: string;
let token: string;
let userId: number;
let farmId: number;
let otherUserId: number;
let otherFarmId: number;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = res.status === 204 ? null : ((await res.json()) as unknown);
  return { status: res.status, raw };
}

async function createConversation(title: string) {
  const [conv] = await db
    .insert(conversationsTable)
    .values({ farmId, userId, title })
    .returning();
  return conv;
}

before(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `conv-test-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Conv Tester",
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
      name: `Finca conv test ${randomUUID().slice(0, 8)}`,
      plantCount: 1000,
      weeklyLitresPerPlant: 80,
      maxEcDsM: 2,
    })
    .returning();
  farmId = farm.id;

  // A second user/farm to verify cross-farm access is rejected.
  const [otherUser] = await db
    .insert(usersTable)
    .values({
      email: `conv-test-other-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Otro",
      role: "owner",
    })
    .returning();
  otherUserId = otherUser.id;
  const [otherFarm] = await db
    .insert(farmsTable)
    .values({
      ownerId: otherUserId,
      name: `Finca ajena ${randomUUID().slice(0, 8)}`,
      plantCount: 500,
      weeklyLitresPerPlant: 60,
      maxEcDsM: 2,
    })
    .returning();
  otherFarmId = otherFarm.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, userId));
  await db.delete(auditLogTable).where(eq(auditLogTable.userId, otherUserId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(usersTable).where(eq(usersTable.id, otherUserId));
  await pool.end();
});

test("un usuario con rol viewer no puede crear, chatear ni eliminar conversaciones", async () => {
  // Invite a viewer to the farm.
  const [viewer] = await db
    .insert(usersTable)
    .values({
      email: `conv-viewer-${randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Solo Consulta",
      role: "viewer",
    })
    .returning();
  const viewerToken = randomUUID();
  await db.insert(sessionsTable).values({
    id: viewerToken,
    userId: viewer.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await db.insert(farmMembersTable).values({ farmId, userId: viewer.id, role: "viewer" });

  const conv = await createConversation("Conversación protegida");

  const asViewer = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${viewerToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.status;
  };

  assert.equal(await asViewer("POST", `/farms/${farmId}/conversations`, { title: "x" }), 403);
  assert.equal(
    await asViewer("POST", `/farms/${farmId}/conversations/${conv.id}/messages`, {
      content: "hola",
    }),
    403,
  );
  assert.equal(await asViewer("DELETE", `/farms/${farmId}/conversations/${conv.id}`), 403);
  // Viewers can neither preview technician notes nor generate reports (AI cost).
  assert.equal(
    await asViewer("POST", `/farms/${farmId}/reports/notes-preview`, { conversationId: conv.id }),
    403,
  );
  assert.equal(await asViewer("POST", `/farms/${farmId}/reports`, { format: "pdf" }), 403);
  // The conversation is still there.
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conv.id));
  assert.ok(row);

  await db.delete(usersTable).where(eq(usersTable.id, viewer.id));
});

test("GET /conversations/:id devuelve la conversación con sus mensajes", async () => {
  const conv = await createConversation("Conversación GET");
  await db.insert(messagesTable).values([
    { conversationId: conv.id, role: "user", content: "Hola" },
    { conversationId: conv.id, role: "assistant", content: "Buenas, ¿en qué ayudo?" },
  ]);

  const { status, raw } = await api("GET", `/farms/${farmId}/conversations/${conv.id}`);
  assert.equal(status, 200);
  const parsed = GetConversationResponse.parse(raw);
  assert.equal(parsed.conversation.id, conv.id);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[1].content, "Buenas, ¿en qué ayudo?");
});

test("GET /conversations/:id de otra finca responde 404", async () => {
  const [foreign] = await db
    .insert(conversationsTable)
    .values({ farmId: otherFarmId, userId: otherUserId, title: "Ajena" })
    .returning();
  const { status } = await api("GET", `/farms/${farmId}/conversations/${foreign.id}`);
  assert.equal(status, 404);
});

test("DELETE /conversations/:id elimina la conversación de verdad", async () => {
  const conv = await createConversation("Conversación DELETE");
  const { status } = await api("DELETE", `/farms/${farmId}/conversations/${conv.id}`);
  assert.equal(status, 204);
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conv.id));
  assert.equal(row, undefined);
  // Second delete now 404s.
  const again = await api("DELETE", `/farms/${farmId}/conversations/${conv.id}`);
  assert.equal(again.status, 404);
});

test("POST /reports/notes-preview devuelve las observaciones (fallback sin IA)", async () => {
  const conv = await createConversation("Conversación preview");
  const assistantReply =
    "El suelo presenta sodio elevado; recomiendo enmienda cálcica y vigilar la CE del agua de riego.";
  await db.insert(messagesTable).values([
    { conversationId: conv.id, role: "user", content: "¿Qué opinas de la analítica?" },
    { conversationId: conv.id, role: "assistant", content: assistantReply },
  ]);

  const { status, raw } = await api("POST", `/farms/${farmId}/reports/notes-preview`, {
    conversationId: conv.id,
  });
  assert.equal(status, 200);
  const parsed = PreviewReportNotesResponse.parse(raw);
  // Sin credencial de OpenAI configurada, el fallback usa la última respuesta del asistente.
  assert.equal(parsed.notes, assistantReply);
});

test("POST /reports/notes-preview con conversación vacía responde 422", async () => {
  const conv = await createConversation("Conversación vacía");
  const { status } = await api("POST", `/farms/${farmId}/reports/notes-preview`, {
    conversationId: conv.id,
  });
  assert.equal(status, 422);
});

test("POST /reports/notes-preview con conversación de otra finca responde 404", async () => {
  const [foreign] = await db
    .insert(conversationsTable)
    .values({ farmId: otherFarmId, userId: otherUserId, title: "Ajena preview" })
    .returning();
  const { status } = await api("POST", `/farms/${farmId}/reports/notes-preview`, {
    conversationId: foreign.id,
  });
  assert.equal(status, 404);
});
