import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  sectorsTable,
} from "@workspace/db";
import {
  ListConversationsResponse,
  CreateConversationBody,
  CreateConversationResponse,
  GetConversationResponse,
  SendMessageBody,
  SendMessageResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, parseIntParam } from "../middlewares/auth";
import { serializeConversation, serializeMessage } from "../lib/serializers";
import {
  latestAnalysis,
  activeRecommendation,
  resolveCredential,
} from "../lib/farmContext";
import { buildFarmContext, contextSources } from "../lib/contextBlock";
import {
  clientFor,
  agronomistSystemPrompt,
  estimateCostEur,
  recordUsage,
  checkMonthlyLimit,
} from "../lib/openai";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

async function messageCount(conversationId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId));
  return row?.count ?? 0;
}

router.get("/farms/:farmId/conversations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.farmId, farmId))
    .orderBy(desc(conversationsTable.updatedAt));
  const result = [];
  for (const c of rows) result.push(serializeConversation(c, await messageCount(c.id)));
  res.json(ListConversationsResponse.parse(result));
});

router.post("/farms/:farmId/conversations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [conv] = await db
    .insert(conversationsTable)
    .values({
      farmId,
      sectorId: parsed.data.sectorId,
      userId: req.user!.id,
      title: parsed.data.title ?? "Nueva conversación",
    })
    .returning();
  res.status(201).json(CreateConversationResponse.parse(serializeConversation(conv, 0)));
});

router.get("/farms/:farmId/conversations/:conversationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const convId = parseIntParam(req.params.conversationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.farmId, farmId)));
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convId))
    .orderBy(messagesTable.id);
  res.json(
    GetConversationResponse.parse({
      conversation: serializeConversation(conv, msgs.length),
      messages: msgs.map(serializeMessage),
    }),
  );
});

router.delete("/farms/:farmId/conversations/:conversationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const convId = parseIntParam(req.params.conversationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [conv] = await db
    .delete(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.farmId, farmId)))
    .returning();
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  res.status(204).send();
});

router.post(
  "/farms/:farmId/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const farmId = parseIntParam(req.params.farmId);
    const convId = parseIntParam(req.params.conversationId);
    const access = await farmAccess(req.user!, farmId);
    if (!access) {
      res.status(404).json({ error: "Finca no encontrada" });
      return;
    }
    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.farmId, farmId)));
    if (!conv) {
      res.status(404).json({ error: "Conversación no encontrada" });
      return;
    }

    const credential = await resolveCredential(access.farm, req.user!);
    if (!credential) {
      res.status(409).json({
        error:
          "No hay ninguna clave de OpenAI configurada. Añade tu clave en Ajustes para usar el técnico virtual.",
      });
      return;
    }
    const limitMsg = await checkMonthlyLimit(req.user!, credential);
    if (limitMsg) {
      res.status(429).json({ error: limitMsg });
      return;
    }

    // Store the user message first.
    const [userMsg] = await db
      .insert(messagesTable)
      .values({ conversationId: convId, role: "user", content: parsed.data.content })
      .returning();

    // Build context.
    const [soil, leaf, water, active, sectors, history] = await Promise.all([
      latestAnalysis(farmId, "soil"),
      latestAnalysis(farmId, "leaf"),
      latestAnalysis(farmId, "water"),
      activeRecommendation(farmId),
      db.select().from(sectorsTable).where(eq(sectorsTable.farmId, farmId)),
      db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, convId))
        .orderBy(desc(messagesTable.id))
        .limit(20),
    ]);
    const contextBlock = buildFarmContext({ farm: access.farm, sectors, soil, leaf, water, active });
    const sources = contextSources({ soil, leaf, water, active });

    const model = credential.selectedModel ?? "gpt-4o-mini";
    const start = Date.now();
    try {
      const client = clientFor(credential);
      const chatHistory = history
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: agronomistSystemPrompt(access.farm, contextBlock) },
          ...chatHistory,
        ],
      });
      const answer =
        completion.choices[0]?.message?.content ?? "No he podido generar una respuesta.";
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      const cost = estimateCostEur(model, inputTokens, outputTokens);
      const [assistantMsg] = await db
        .insert(messagesTable)
        .values({
          conversationId: convId,
          role: "assistant",
          content: answer,
          sources,
          toolsUsed: ["contexto_finca", "analiticas", "programa_vigente"],
          estimatedCostEur: cost,
        })
        .returning();
      await db
        .update(conversationsTable)
        .set({
          title:
            conv.title === "Nueva conversación"
              ? parsed.data.content.slice(0, 80)
              : conv.title,
        })
        .where(eq(conversationsTable.id, convId));
      await recordUsage({
        userId: req.user!.id,
        farmId,
        model,
        operation: "chat",
        inputTokens,
        outputTokens,
        estimatedCostEur: cost,
        durationMs: Date.now() - start,
        result: "ok",
      });
      await audit({
        userId: req.user!.id,
        farmId,
        action: "ai_query",
        entityType: "conversation",
        entityId: convId,
      });
      res
        .status(201)
        .json(SendMessageResponse.parse([serializeMessage(userMsg), serializeMessage(assistantMsg)]));
    } catch (err) {
      req.log.error({ err: (err as Error).message }, "OpenAI chat failed");
      await recordUsage({
        userId: req.user!.id,
        farmId,
        model,
        operation: "chat",
        durationMs: Date.now() - start,
        result: "error",
      });
      res.status(502).json({
        error:
          "El servicio de OpenAI ha devuelto un error. Comprueba tu clave y su crédito en Ajustes e inténtalo de nuevo.",
      });
    }
  },
);

export default router;
