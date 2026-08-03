import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, analysesTable } from "@workspace/db";
import {
  ListAnalysesResponse,
  CreateAnalysisBody,
  CreateAnalysisResponse,
  GetAnalysisResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, canEdit, parseIntParam } from "../middlewares/auth";
import { serializeAnalysis } from "../lib/serializers";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/farms/:farmId/analyses", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.farmId, farmId))
    .orderBy(desc(analysesTable.sampleDate), desc(analysesTable.id));
  res.json(ListAnalysesResponse.parse(rows.map(serializeAnalysis)));
});

router.post("/farms/:farmId/analyses", async (req, res): Promise<void> => {
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
  const parsed = CreateAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [analysis] = await db
    .insert(analysesTable)
    .values({ ...parsed.data, farmId, createdBy: req.user!.id })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "analysis_created",
    entityType: "analysis",
    entityId: analysis.id,
    detail: `${analysis.type} ${analysis.reference ?? ""}`.trim(),
  });
  res.status(201).json(CreateAnalysisResponse.parse(serializeAnalysis(analysis)));
});

router.get("/farms/:farmId/analyses/:analysisId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const analysisId = parseIntParam(req.params.analysisId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.id, analysisId), eq(analysesTable.farmId, farmId)));
  if (!analysis) {
    res.status(404).json({ error: "Analítica no encontrada" });
    return;
  }
  res.json(GetAnalysisResponse.parse(serializeAnalysis(analysis)));
});

router.delete("/farms/:farmId/analyses/:analysisId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const analysisId = parseIntParam(req.params.analysisId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const [analysis] = await db
    .delete(analysesTable)
    .where(and(eq(analysesTable.id, analysisId), eq(analysesTable.farmId, farmId)))
    .returning();
  if (!analysis) {
    res.status(404).json({ error: "Analítica no encontrada" });
    return;
  }
  await audit({
    userId: req.user!.id,
    farmId,
    action: "analysis_deleted",
    entityType: "analysis",
    entityId: analysisId,
  });
  res.status(204).send();
});

export default router;
