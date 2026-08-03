import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  farmsTable,
  conversationsTable,
  messagesTable,
} from "@workspace/db";
import { serializeMessage } from "../lib/serializers";

// Integration test against the real (development) database schema: verifies
// that the `messages.attachments` column exists, round-trips values, and is
// exposed by the conversation serializer used in the GET endpoints.

let userId: number | null = null;

after(async () => {
  if (userId != null) {
    await db.delete(usersTable).where(eq(usersTable.id, userId)); // cascades farm/conversation/messages
  }
});

test("un mensaje con adjunto se guarda y se recupera con la lista de adjuntos", async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `test-attach-${Date.now()}@example.com`,
      passwordHash: "x",
      name: "Test Adjuntos",
    })
    .returning();
  userId = user.id;

  const [farm] = await db
    .insert(farmsTable)
    .values({ ownerId: user.id, name: "Finca test adjuntos" })
    .returning();

  const [conv] = await db
    .insert(conversationsTable)
    .values({ farmId: farm.id, userId: user.id, title: "Adjunto: foto.jpg" })
    .returning();

  const [msg] = await db
    .insert(messagesTable)
    .values({
      conversationId: conv.id,
      role: "user",
      content: "He adjuntado una foto de la hoja con clorosis.",
      attachments: ["foto.jpg"],
    })
    .returning();

  // Read back the way the GET conversation endpoint does.
  const stored = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id));

  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].attachments, ["foto.jpg"]);

  const serialized = serializeMessage(stored[0]);
  assert.equal(serialized.id, msg.id);
  assert.deepEqual(serialized.attachments, ["foto.jpg"]);
  assert.equal(serialized.role, "user");
});

test("un mensaje sin adjuntos serializa attachments como lista vacía", () => {
  const out = serializeMessage({
    id: 1,
    conversationId: 1,
    role: "assistant",
    content: "Respuesta",
    attachments: null,
    toolsUsed: null,
    sources: null,
    estimatedCostEur: null,
    createdAt: new Date("2026-08-03T10:00:00Z"),
  });
  assert.deepEqual(out.attachments, []);
});
