import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  recommendationsTable,
  fertilizersTable,
  sectorsTable,
} from "@workspace/db";
import {
  ListRecommendationsResponse,
  CreateRecommendationBody,
  CreateRecommendationResponse,
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
import { latestAnalysis, userName } from "../lib/farmContext";
import { runEngine } from "../lib/engine";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

async function fullSerialize(r: typeof recommendationsTable.$inferSelect) {
  return serializeRecommendation(r, await userName(r.createdBy), await userName(r.validatedBy));
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
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.items) {
    Object.assign(update, await computeEstimates(farmId, access.farm, parsed.data.items));
  }
  const [rec] = await db
    .update(recommendationsTable)
    .set(update)
    .where(eq(recommendationsTable.id, recId))
    .returning();
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
