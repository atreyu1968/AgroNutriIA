import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  sectorsTable,
  fertilizersTable,
  recommendationsTable,
  type RecommendationItem,
} from "@workspace/db";
import {
  ListConversationsResponse,
  CreateConversationBody,
  CreateConversationResponse,
  GetConversationResponse,
  SendMessageBody,
  SendMessageResponse,
  CreateDraftFromMessageResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, canEdit, parseIntParam } from "../middlewares/auth";
import {
  serializeConversation,
  serializeMessage,
  serializeRecommendation,
} from "../lib/serializers";
import {
  latestAnalysis,
  activeRecommendation,
  resolveCredential,
  userName,
} from "../lib/farmContext";
import { runEngine } from "../lib/engine";
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

const extractionSchema = {
  name: "programa_abonado",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "items", "rationale"],
    properties: {
      title: { type: "string", description: "Título corto del programa" },
      rationale: {
        type: "string",
        description: "Justificación agronómica resumida del programa",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fertilizerName", "weeklyDose", "unit"],
          properties: {
            fertilizerName: { type: "string" },
            weeklyDose: { type: "number", description: "Dosis semanal total de la finca" },
            unit: { type: "string", enum: ["kg", "L"] },
            reason: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

router.post(
  "/farms/:farmId/conversations/:conversationId/messages/:messageId/draft-recommendation",
  async (req, res): Promise<void> => {
    const farmId = parseIntParam(req.params.farmId);
    const convId = parseIntParam(req.params.conversationId);
    const messageId = parseIntParam(req.params.messageId);
    const access = await farmAccess(req.user!, farmId);
    if (!access) {
      res.status(404).json({ error: "Finca no encontrada" });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: "Sin permisos para crear programas" });
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
    const [msg] = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.id, messageId), eq(messagesTable.conversationId, convId)));
    if (!msg || msg.role !== "assistant") {
      res.status(404).json({ error: "Mensaje del asistente no encontrado" });
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

    const fertilizers = await db.select().from(fertilizersTable);
    const catalog = fertilizers
      .filter((f) => f.isActive !== false)
      .map((f) => `- id ${f.id}: ${f.name} (${f.formulaType ?? "?"})`)
      .join("\n");

    const model = credential.selectedModel ?? "gpt-4o-mini";
    const start = Date.now();
    let extracted: {
      title: string;
      rationale: string;
      items: { fertilizerName: string; weeklyDose: number; unit: string; reason?: string | null }[];
    };
    try {
      const client = clientFor(credential);
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_schema", json_schema: extractionSchema },
        messages: [
          {
            role: "system",
            content: `Eres un asistente que convierte una respuesta de un técnico agrícola en un programa semanal de fertirrigación estructurado.
Extrae EXCLUSIVAMENTE los fertilizantes y dosis semanales que aparecen en el texto; no inventes productos ni dosis.
Usa dosis semanales totales para la finca en kg o L. Si el texto da g/planta, conviértelo si el propio texto da el número de plantas; si no, usa el valor total indicado.
Catálogo de fertilizantes disponibles (usa estos nombres cuando coincidan):
${catalog}`,
          },
          { role: "user", content: msg.content },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      extracted = JSON.parse(raw);
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      await recordUsage({
        userId: req.user!.id,
        farmId,
        model,
        operation: "draft_recommendation",
        inputTokens,
        outputTokens,
        estimatedCostEur: estimateCostEur(model, inputTokens, outputTokens),
        durationMs: Date.now() - start,
        result: "ok",
      });
    } catch (err) {
      req.log.error({ err: (err as Error).message }, "OpenAI draft extraction failed");
      await recordUsage({
        userId: req.user!.id,
        farmId,
        model,
        operation: "draft_recommendation",
        durationMs: Date.now() - start,
        result: "error",
      });
      res.status(502).json({
        error:
          "No se ha podido estructurar la respuesta del asistente. Inténtalo de nuevo o crea el programa manualmente.",
      });
      return;
    }

    if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
      res.status(422).json({
        error:
          "La respuesta del asistente no contiene un programa de abonado con dosis concretas. Pídele un programa semanal con dosis por fertilizante y vuelve a intentarlo.",
      });
      return;
    }

    const byName = new Map(fertilizers.map((f) => [f.name.toLowerCase(), f]));
    const items: RecommendationItem[] = extracted.items.map((i) => ({
      fertilizerId: byName.get(i.fertilizerName.toLowerCase())?.id ?? null,
      fertilizerName: i.fertilizerName,
      weeklyDose: i.weeklyDose,
      unit: i.unit === "L" ? "L" : "kg",
      reason: i.reason ?? null,
    }));

    const water = await latestAnalysis(farmId, "water");
    const out = runEngine({ farm: access.farm, waterAnalysis: water, fertilizers, items });

    const [rec] = await db
      .insert(recommendationsTable)
      .values({
        farmId,
        sectorId: conv.sectorId,
        title: extracted.title || "Programa propuesto por el técnico virtual",
        items,
        rationale: extracted.rationale || null,
        status: "draft",
        source: "ai",
        createdBy: req.user!.id,
        estimatedEcDsM: out.estimatedEcDsM,
        estimatedWeeklyNKg: out.nutrients.n ?? null,
        warnings: [...out.warnings, ...out.compatibilityIssues],
      })
      .returning();
    await audit({
      userId: req.user!.id,
      farmId,
      action: "recommendation_created",
      entityType: "recommendation",
      entityId: rec.id,
      detail: `${rec.title} (borrador IA desde conversación ${convId})`,
    });
    res
      .status(201)
      .json(
        CreateDraftFromMessageResponse.parse(
          serializeRecommendation(rec, await userName(rec.createdBy), null),
        ),
      );
  },
);

export default router;
