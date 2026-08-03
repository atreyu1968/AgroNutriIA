import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  recommendationsTable,
  fertilizersTable,
  sectorsTable,
  type RecommendationItem,
} from "@workspace/db";
import {
  ListRecommendationsResponse,
  CreateRecommendationBody,
  CreateRecommendationResponse,
  GenerateAiDraftRecommendationBody,
  GenerateAiDraftRecommendationResponse,
  GetRecommendationResponse,
  UpdateRecommendationBody,
  UpdateRecommendationResponse,
  ChangeRecommendationStatusBody,
  ChangeRecommendationStatusResponse,
  RunCalculationBody,
  RunCalculationResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  farmAccess,
  canEdit,
  canApply,
  parseIntParam,
} from "../middlewares/auth";
import { serializeRecommendation } from "../lib/serializers";
import {
  latestAnalysis,
  latestAnalysisScoped,
  activeRecommendation,
  activeRecommendationScoped,
  resolveCredential,
  userName,
} from "../lib/farmContext";
import { runEngine } from "../lib/engine";
import { audit } from "../lib/audit";
import { buildFarmContext } from "../lib/contextBlock";
import {
  clientFor,
  agronomistSystemPrompt,
  estimateCostEur,
  recordUsage,
  checkMonthlyLimit,
} from "../lib/openai";

const router: IRouter = Router();
router.use(requireAuth);

async function fullSerialize(r: typeof recommendationsTable.$inferSelect) {
  return serializeRecommendation(
    r,
    await userName(r.createdBy),
    await userName(r.validatedBy),
    await userName(r.updatedBy),
  );
}

router.get("/farms/:farmId/recommendations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.farmId, farmId))
    .orderBy(desc(recommendationsTable.createdAt));
  const result = [];
  for (const r of rows) result.push(await fullSerialize(r));
  res.json(ListRecommendationsResponse.parse(result));
});

async function computeEstimates(farmId: number, farm: import("@workspace/db").Farm, items: import("@workspace/db").RecommendationItem[]) {
  const fertilizers = await db.select().from(fertilizersTable);
  const water = await latestAnalysis(farmId, "water");
  const out = runEngine({ farm, waterAnalysis: water, fertilizers, items });
  return {
    estimatedEcDsM: out.estimatedEcDsM,
    estimatedWeeklyNKg: out.nutrients.n ?? null,
    warnings: [...out.warnings, ...out.compatibilityIssues],
  };
}

router.post("/farms/:farmId/recommendations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const parsed = CreateRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const est = await computeEstimates(farmId, access.farm, parsed.data.items);
  const [rec] = await db
    .insert(recommendationsTable)
    .values({
      farmId,
      sectorId: parsed.data.sectorId,
      title: parsed.data.title ?? "Programa semanal de fertirrigación",
      items: parsed.data.items,
      rationale: parsed.data.rationale,
      status: "draft",
      source: "manual",
      createdBy: req.user!.id,
      ...est,
    })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_created",
    entityType: "recommendation",
    entityId: rec.id,
    detail: rec.title,
  });
  res.status(201).json(CreateRecommendationResponse.parse(await fullSerialize(rec)));
});

const aiProgramSchema = {
  name: "programa_fertirrigacion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "rationale", "items"],
    properties: {
      title: { type: "string" },
      rationale: {
        type: "string",
        description: "Justificación agronómica breve basada en las analíticas",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fertilizerName", "weeklyDose", "unit", "reason"],
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

router.post("/farms/:farmId/recommendations/ai-draft", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos para crear programas" });
    return;
  }
  // Optional body: { sectorId } → sector-specific program; absent/null → farm-wide.
  const parsedBody = GenerateAiDraftRecommendationBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: "Sector no válido" });
    return;
  }
  const requestedSectorId = parsedBody.data.sectorId ?? null;
  let sector: typeof sectorsTable.$inferSelect | null = null;
  if (requestedSectorId != null) {
    const [s] = await db
      .select()
      .from(sectorsTable)
      .where(and(eq(sectorsTable.id, requestedSectorId), eq(sectorsTable.farmId, farmId)));
    if (!s) {
      res.status(404).json({ error: "El sector indicado no existe en esta finca" });
      return;
    }
    sector = s;
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

  const sectorScope = sector?.id ?? null;
  const [soil, leaf, water, sectors, active, fertilizers] = await Promise.all([
    latestAnalysisScoped(farmId, "soil", sectorScope),
    latestAnalysisScoped(farmId, "leaf", sectorScope),
    latestAnalysisScoped(farmId, "water", sectorScope),
    db.select().from(sectorsTable).where(eq(sectorsTable.farmId, farmId)),
    activeRecommendationScoped(farmId, sectorScope),
    db.select().from(fertilizersTable),
  ]);
  if (!soil && !leaf && !water) {
    res.status(422).json({
      error: sector
        ? `Ni el sector «${sector.name}» ni la finca tienen analíticas registradas. Sube al menos una analítica (agua, suelo o foliar) para generar un programa con IA.`
        : "La finca no tiene ninguna analítica registrada. Sube al menos una analítica (agua, suelo o foliar) para generar un programa con IA.",
    });
    return;
  }
  const contextBlock = buildFarmContext({ farm: access.farm, sectors, soil, leaf, water, active });
  const catalog = fertilizers
    .filter((f) => f.isActive !== false && (f.usage ?? "fertirrigacion") === "fertirrigacion")
    .map((f) => `- ${f.name} (${f.formulaType ?? "?"})`)
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
      response_format: { type: "json_schema", json_schema: aiProgramSchema },
      messages: [
        { role: "system", content: agronomistSystemPrompt(access.farm, contextBlock) },
        {
          role: "user",
          content: sector
            ? `Diseña el programa semanal de fertirrigación más adecuado para el sector «${sector.name}» de esta finca a partir de las últimas analíticas disponibles (las analíticas mostradas son las del propio sector cuando existen; si no, las globales de la finca).
Datos del sector: ${sector.plantCount ?? "?"} plantas, ${sector.surfaceHa ?? "?"} ha, riego ${sector.weeklyLitresPerPlant ?? access.farm.weeklyLitresPerPlant ?? "?"} L/planta/semana${sector.phenologicalStage ? `, fase fenológica ${sector.phenologicalStage}` : ""}.
Usa EXCLUSIVAMENTE fertilizantes de este catálogo (productos de fertirrigación):
${catalog}

Devuelve dosis semanales TOTALES para ese sector (no para toda la finca) en kg o L por fertilizante, con un motivo breve por producto, y una justificación agronómica general basada en los datos de las analíticas.`
            : `Diseña el programa semanal de fertirrigación más adecuado para esta finca a partir de las últimas analíticas disponibles.
Usa EXCLUSIVAMENTE fertilizantes de este catálogo (productos de fertirrigación):
${catalog}

Devuelve dosis semanales TOTALES para la finca en kg o L por fertilizante, con un motivo breve por producto, y una justificación agronómica general basada en los datos de las analíticas.`,
        },
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
      operation: "ai_draft_program",
      inputTokens,
      outputTokens,
      estimatedCostEur: estimateCostEur(model, inputTokens, outputTokens),
      durationMs: Date.now() - start,
      result: "ok",
    });
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "OpenAI ai-draft program failed");
    await recordUsage({
      userId: req.user!.id,
      farmId,
      model,
      operation: "ai_draft_program",
      durationMs: Date.now() - start,
      result: "error",
    });
    res.status(502).json({
      error: "No se ha podido generar el programa con IA. Inténtalo de nuevo en unos momentos.",
    });
    return;
  }

  if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
    res.status(422).json({
      error: "La IA no ha propuesto ningún fertilizante. Revisa que las analíticas tengan datos y vuelve a intentarlo.",
    });
    return;
  }

  const byName = new Map(fertilizers.map((f) => [f.name.toLowerCase(), f]));
  const items: RecommendationItem[] = [];
  const discarded: string[] = [];
  for (const i of extracted.items) {
    const fert = byName.get(i.fertilizerName.toLowerCase());
    const doseOk = Number.isFinite(i.weeklyDose) && i.weeklyDose > 0 && i.weeklyDose <= 10000;
    if (!fert || fert.isActive === false || !doseOk) {
      discarded.push(i.fertilizerName);
      continue;
    }
    items.push({
      fertilizerId: fert.id,
      fertilizerName: fert.name,
      weeklyDose: i.weeklyDose,
      unit: i.unit === "L" ? "L" : "kg",
      reason: i.reason ?? null,
    });
  }
  if (items.length === 0) {
    res.status(422).json({
      error:
        "La IA ha propuesto productos o dosis no válidos y se ha descartado la propuesta. Vuelve a intentarlo.",
    });
    return;
  }
  const out = runEngine({ farm: access.farm, sector, waterAnalysis: water, fertilizers, items });

  const [rec] = await db
    .insert(recommendationsTable)
    .values({
      farmId,
      sectorId: sector?.id ?? null,
      title: extracted.title || "Programa propuesto por el técnico virtual",
      items,
      rationale: extracted.rationale || null,
      status: "draft",
      source: "ai",
      createdBy: req.user!.id,
      estimatedEcDsM: out.estimatedEcDsM,
      estimatedWeeklyNKg: out.nutrients.n ?? null,
      warnings: [
        ...out.warnings,
        ...out.compatibilityIssues,
        ...(discarded.length
          ? [`Se descartaron productos propuestos por la IA fuera del catálogo o con dosis no válidas: ${discarded.join(", ")}`]
          : []),
      ],
    })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_created",
    entityType: "recommendation",
    entityId: rec.id,
    detail: `${rec.title} (borrador IA desde analíticas)`,
  });
  res.status(201).json(GenerateAiDraftRecommendationResponse.parse(await fullSerialize(rec)));
});

router.get("/farms/:farmId/recommendations/:recommendationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const recId = parseIntParam(req.params.recommendationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [rec] = await db
    .select()
    .from(recommendationsTable)
    .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
  if (!rec) {
    res.status(404).json({ error: "Recomendación no encontrada" });
    return;
  }
  res.json(GetRecommendationResponse.parse(await fullSerialize(rec)));
});

router.patch("/farms/:farmId/recommendations/:recommendationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const recId = parseIntParam(req.params.recommendationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const parsed = UpdateRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(recommendationsTable)
    .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
  if (!existing) {
    res.status(404).json({ error: "Recomendación no encontrada" });
    return;
  }
  if (existing.status !== "draft" && existing.status !== "pending_review") {
    res.status(409).json({ error: "Solo se pueden editar recomendaciones en borrador o pendientes de revisión" });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data, updatedBy: req.user!.id };
  if (parsed.data.items) {
    Object.assign(update, await computeEstimates(farmId, access.farm, parsed.data.items));
  }
  const [rec] = await db
    .update(recommendationsTable)
    .set(update)
    .where(eq(recommendationsTable.id, recId))
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_updated",
    entityType: "recommendation",
    entityId: rec.id,
    detail: rec.title,
  });
  res.json(UpdateRecommendationResponse.parse(await fullSerialize(rec)));
});

const TRANSITIONS: Record<string, { from: string[]; to: string; requiresApprover: boolean }> = {
  submit: { from: ["draft", "rejected"], to: "pending_review", requiresApprover: false },
  approve: { from: ["pending_review"], to: "validated", requiresApprover: true },
  reject: { from: ["pending_review"], to: "rejected", requiresApprover: true },
  start_application: { from: ["validated"], to: "applying", requiresApprover: false },
  finish: { from: ["applying"], to: "finished", requiresApprover: false },
};

router.post(
  "/farms/:farmId/recommendations/:recommendationId/status",
  async (req, res): Promise<void> => {
    const farmId = parseIntParam(req.params.farmId);
    const recId = parseIntParam(req.params.recommendationId);
    const access = await farmAccess(req.user!, farmId);
    if (!access) {
      res.status(404).json({ error: "Finca no encontrada" });
      return;
    }
    const parsed = ChangeRecommendationStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const t = TRANSITIONS[parsed.data.action];
    if (t.requiresApprover && !canEdit(access.role)) {
      res.status(403).json({ error: "Solo el propietario o el técnico pueden validar o rechazar" });
      return;
    }
    if (!t.requiresApprover && !canApply(access.role)) {
      res.status(403).json({ error: "Sin permisos" });
      return;
    }
    const [existing] = await db
      .select()
      .from(recommendationsTable)
      .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
    if (!existing) {
      res.status(404).json({ error: "Recomendación no encontrada" });
      return;
    }
    if (!t.from.includes(existing.status)) {
      res.status(409).json({
        error: `No se puede pasar de «${existing.status}» con la acción «${parsed.data.action}»`,
      });
      return;
    }
    const update: Record<string, unknown> = { status: t.to };
    if (parsed.data.action === "approve" || parsed.data.action === "reject") {
      update.validatedBy = req.user!.id;
      update.reviewComment = parsed.data.comment ?? null;
    }
    const [rec] = await db
      .update(recommendationsTable)
      .set(update)
      .where(eq(recommendationsTable.id, recId))
      .returning();
    await audit({
      userId: req.user!.id,
      farmId,
      action: `recommendation_${parsed.data.action}`,
      entityType: "recommendation",
      entityId: recId,
      detail: parsed.data.comment ?? null,
    });
    res.json(ChangeRecommendationStatusResponse.parse(await fullSerialize(rec)));
  },
);

router.post("/farms/:farmId/calculations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const parsed = RunCalculationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let sector = null;
  if (parsed.data.sectorId != null) {
    const [s] = await db
      .select()
      .from(sectorsTable)
      .where(and(eq(sectorsTable.id, parsed.data.sectorId), eq(sectorsTable.farmId, farmId)));
    sector = s ?? null;
  }
  const fertilizers = await db.select().from(fertilizersTable);
  const water = await latestAnalysis(farmId, "water");
  const out = runEngine({
    farm: access.farm,
    sector,
    waterAnalysis: water,
    fertilizers,
    items: parsed.data.items,
    weeklyLitresPerPlant: parsed.data.weeklyLitresPerPlant,
    plantCount: parsed.data.plantCount,
  });
  res.json(RunCalculationResponse.parse(out));
});

export default router;
