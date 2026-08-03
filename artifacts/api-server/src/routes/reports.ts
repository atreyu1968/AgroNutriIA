import path from "node:path";
import fs from "node:fs";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  reportsTable,
  recommendationsTable,
  sectorsTable,
} from "@workspace/db";
import {
  ListReportsResponse,
  CreateReportBody,
  CreateReportResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, parseIntParam } from "../middlewares/auth";
import { serializeReport } from "../lib/serializers";
import { latestAnalysis, activeRecommendation, userName } from "../lib/farmContext";
import { generatePdf, generateDocx, REPORTS_DIR } from "../lib/reportGen";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/farms/:farmId/reports", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.farmId, farmId))
    .orderBy(desc(reportsTable.createdAt));
  const result = [];
  for (const r of rows) result.push(serializeReport(r, await userName(r.createdBy)));
  res.json(ListReportsResponse.parse(result));
});

router.post("/farms/:farmId/reports", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let recommendation = null;
  if (parsed.data.recommendationId != null) {
    const [r] = await db
      .select()
      .from(recommendationsTable)
      .where(
        and(
          eq(recommendationsTable.id, parsed.data.recommendationId),
          eq(recommendationsTable.farmId, farmId),
        ),
      );
    recommendation = r ?? null;
  } else {
    recommendation = await activeRecommendation(farmId);
  }
  const title =
    parsed.data.title ?? `Informe técnico de fertirrigación — ${access.farm.name}`;
  const [report] = await db
    .insert(reportsTable)
    .values({
      farmId,
      recommendationId: recommendation?.id ?? null,
      title,
      format: parsed.data.format,
      status: "generating",
      createdBy: req.user!.id,
    })
    .returning();

  // Respond immediately; generation continues in background.
  res
    .status(201)
    .json(CreateReportResponse.parse(serializeReport(report, req.user!.name)));

  const userId = req.user!.id;
  const authorName = req.user!.name;
  const log = req.log;
  void (async () => {
    const filePath = path.join(
      REPORTS_DIR,
      `informe-${farmId}-${report.id}.${parsed.data.format}`,
    );
    try {
      const [soil, leaf, water, sectors] = await Promise.all([
        latestAnalysis(farmId, "soil"),
        latestAnalysis(farmId, "leaf"),
        latestAnalysis(farmId, "water"),
        db.select().from(sectorsTable).where(eq(sectorsTable.farmId, farmId)),
      ]);
      const data = {
        title,
        farm: access.farm,
        sectors,
        soil,
        leaf,
        water,
        recommendation,
        authorName,
        date: new Date().toLocaleDateString("es-ES"),
      };
      if (parsed.data.format === "pdf") await generatePdf(data, filePath);
      else await generateDocx(data, filePath);
      await db
        .update(reportsTable)
        .set({ status: "ready", filePath })
        .where(and(eq(reportsTable.id, report.id), eq(reportsTable.status, "generating")));
      await audit({
        userId,
        farmId,
        action: "report_generated",
        entityType: "report",
        entityId: report.id,
        detail: `${title} (${parsed.data.format})`,
      });
    } catch (err) {
      log.error({ err: (err as Error).message }, "Report generation failed");
      await db
        .update(reportsTable)
        .set({ status: "error" })
        .where(eq(reportsTable.id, report.id))
        .catch((e: Error) =>
          log.error({ err: e.message }, "Failed to mark report as error"),
        );
    }
  })();
});

router.get("/farms/:farmId/reports/:reportId/download", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const reportId = parseIntParam(req.params.reportId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [report] = await db
    .select()
    .from(reportsTable)
    .where(and(eq(reportsTable.id, reportId), eq(reportsTable.farmId, farmId)));
  if (!report || report.status !== "ready" || !report.filePath || !fs.existsSync(report.filePath)) {
    res.status(404).json({ error: "Informe no disponible" });
    return;
  }
  const safeName = report.title.replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 80);
  res.download(report.filePath, `${safeName}.${report.format}`);
});

export default router;
