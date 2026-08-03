import path from "node:path";
import fs from "node:fs";
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import {
  db,
  reportsTable,
  recommendationsTable,
  sectorsTable,
  conversationsTable,
  messagesTable,
  phytoTreatmentsTable,
} from "@workspace/db";
import {
  ListReportsResponse,
  CreateReportBody,
  CreateReportResponse,
  PreviewReportNotesBody,
  PreviewReportNotesResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, canEdit, parseIntParam } from "../middlewares/auth";
import { serializeReport } from "../lib/serializers";
import {
  latestAnalysis,
  activeRecommendation,
  userName,
  resolveCredential,
} from "../lib/farmContext";
import { synthesizeTechnicianNotes } from "../lib/reportNotes";
import {
  synthesizeAmendmentPlan,
  SCENARIO_LABELS,
  type AmendmentScenario,
} from "../lib/amendmentPlan";
import { generatePdf, generateDocx, REPORTS_DIR } from "../lib/reportGen";
import { audit } from "../lib/audit";
import { demoMode, DEMO_REPORT_LIMIT_MESSAGE } from "../lib/demo";

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
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos para generar informes" });
    return;
  }
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const reportType = parsed.data.reportType ?? "fertirrigacion";
  if (demoMode()) {
    // En la instancia de demostración solo se permite un informe de cada tipo
    // (los que terminaron en error no cuentan: se pueden reintentar).
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reportsTable)
      .where(and(eq(reportsTable.reportType, reportType), ne(reportsTable.status, "error")));
    if (count >= 1) {
      res.status(403).json({ error: DEMO_REPORT_LIMIT_MESSAGE });
      return;
    }
  }
  const scenario = (parsed.data.scenario ?? null) as AmendmentScenario | null;
  if (reportType === "enmiendas") {
    if (!scenario) {
      res.status(400).json({
        error: "Indica el escenario del plan de enmiendas (arranque y siembra, o época de lluvias).",
      });
      return;
    }
    const credential = await resolveCredential(access.farm, req.user!);
    if (!credential) {
      res.status(400).json({
        error:
          "No hay ninguna clave de OpenAI configurada. Añádela en Ajustes para generar el plan de enmiendas.",
      });
      return;
    }
    const soilCheck = await latestAnalysis(farmId, "soil");
    if (!soilCheck) {
      res.status(422).json({
        error:
          "No hay ninguna analítica de suelo registrada. El plan de enmiendas se basa en las analíticas: registra al menos la de suelo antes de generar este informe.",
      });
      return;
    }
  }
  let recommendation = null;
  if (reportType === "enmiendas") {
    // Los informes de enmiendas no incluyen programa de fertirrigación.
  } else if (parsed.data.recommendationId != null) {
    const [r] = await db
      .select()
      .from(recommendationsTable)
      .where(
        and(
          eq(recommendationsTable.id, parsed.data.recommendationId),
          eq(recommendationsTable.farmId, farmId),
        ),
      );
    if (!r) {
      res.status(404).json({ error: "El programa de abonado seleccionado no existe en esta finca" });
      return;
    }
    recommendation = r;
  } else {
    recommendation = await activeRecommendation(farmId);
  }
  let conversation = null;
  if (parsed.data.conversationId != null) {
    const [c] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, parsed.data.conversationId),
          eq(conversationsTable.farmId, farmId),
        ),
      );
    if (!c) {
      res.status(404).json({ error: "La conversación indicada no existe en esta finca" });
      return;
    }
    conversation = c;
  }
  // Snapshot the conversation now so messages/attachments added after this
  // request cannot nondeterministically appear in the report.
  const conversationMsgs = conversation
    ? await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversation.id))
        .orderBy(messagesTable.id)
    : [];
  // Guard: without a technician-AI reply, the notes synthesis has almost no
  // material and would fabricate content. Require a completed exchange.
  if (conversation && !conversationMsgs.some((m) => m.role === "assistant")) {
    res.status(422).json({
      error:
        "El técnico IA aún no ha respondido en esa conversación. Espera su respuesta (o revisa la previsualización) antes de generar el informe.",
    });
    return;
  }
  const title =
    parsed.data.title ??
    (reportType === "enmiendas"
      ? `Informe de enmiendas del terreno (${SCENARIO_LABELS[scenario!]}) — ${access.farm.name}`
      : `Informe técnico de fertirrigación — ${access.farm.name}`);
  const [report] = await db
    .insert(reportsTable)
    .values({
      farmId,
      recommendationId: recommendation?.id ?? null,
      title,
      reportType,
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
  const user = req.user!;
  const farm = access.farm;
  const log = req.log;
  // Año en curso en la zona horaria de las fincas (Canarias), no la del servidor.
  const canaryYear = (): number =>
    Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Atlantic/Canary",
        year: "numeric",
      }).format(new Date()),
    );
  void (async () => {
    const filePath = path.join(
      REPORTS_DIR,
      `informe-${farmId}-${report.id}.${parsed.data.format}`,
    );
    try {
      const [soil, leaf, water, sectors, treatments] = await Promise.all([
        latestAnalysis(farmId, "soil"),
        latestAnalysis(farmId, "leaf"),
        latestAnalysis(farmId, "water"),
        db.select().from(sectorsTable).where(eq(sectorsTable.farmId, farmId)),
        db
          .select()
          .from(phytoTreatmentsTable)
          .where(
            and(
              eq(phytoTreatmentsTable.farmId, farmId),
              gte(phytoTreatmentsTable.applicationDate, `${canaryYear()}-01-01`),
              lt(phytoTreatmentsTable.applicationDate, `${canaryYear() + 1}-01-01`),
            ),
          )
          .orderBy(desc(phytoTreatmentsTable.applicationDate)),
      ]);
      let amendment: { scenarioLabel: string; text: string } | null = null;
      if (reportType === "enmiendas") {
        const text = await synthesizeAmendmentPlan({
          farm,
          user,
          userId,
          farmId,
          scenario: scenario!,
          soil,
          water,
          leaf,
          sectors,
          log,
        });
        if (!text) {
          // Sin IA no hay plan: mejor marcar error explícito que un informe vacío.
          await db
            .update(reportsTable)
            .set({ status: "error" })
            .where(eq(reportsTable.id, report.id));
          log.error(
            "Amendment report failed: no AI credential or synthesis error",
          );
          return;
        }
        amendment = { scenarioLabel: SCENARIO_LABELS[scenario!], text };
      }
      let technicianNotes: string | null = null;
      if (conversation) {
        technicianNotes = await synthesizeTechnicianNotes({
          farm,
          user,
          userId,
          farmId,
          msgs: conversationMsgs,
          log,
        });
      }
      const data = {
        title,
        technicianNotes,
        farm: access.farm,
        sectors,
        soil,
        leaf,
        water,
        recommendation,
        amendment,
        authorName,
        date: new Date().toLocaleDateString("es-ES"),
        // El informe de enmiendas se centra en el suelo; el cuaderno
        // fitosanitario solo va en el informe de fertirrigación.
        phytoTreatments: (reportType === "enmiendas" ? [] : treatments).map((t) => ({
          applicationDate: t.applicationDate,
          productName: t.productName,
          sectorName:
            t.sectorId != null
              ? (sectors.find((s) => s.id === t.sectorId)?.name ?? null)
              : null,
          safetyDays: t.safetyDays,
        })),
      };
      const warnings =
        parsed.data.format === "pdf"
          ? await generatePdf(data, filePath)
          : await generateDocx(data, filePath);
      await db
        .update(reportsTable)
        .set({ status: "ready", filePath, warnings: warnings.length ? warnings : null })
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

router.post(
  "/farms/:farmId/reports/notes-preview",
  async (req, res): Promise<void> => {
    const farmId = parseIntParam(req.params.farmId);
    const access = await farmAccess(req.user!, farmId);
    if (!access) {
      res.status(404).json({ error: "Finca no encontrada" });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: "Sin permisos para generar informes" });
      return;
    }
    const parsed = PreviewReportNotesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [conversation] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, parsed.data.conversationId),
          eq(conversationsTable.farmId, farmId),
        ),
      );
    if (!conversation) {
      res.status(404).json({ error: "La conversación indicada no existe en esta finca" });
      return;
    }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversation.id))
      .orderBy(messagesTable.id);
    const notes = await synthesizeTechnicianNotes({
      farm: access.farm,
      user: req.user!,
      userId: req.user!.id,
      farmId,
      msgs,
      log: req.log,
    });
    if (!notes) {
      res.status(422).json({
        error:
          "La conversación no tiene contenido suficiente para generar observaciones. Chatea con el técnico IA y vuelve a intentarlo.",
      });
      return;
    }
    res.json(PreviewReportNotesResponse.parse({ notes }));
  },
);

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
