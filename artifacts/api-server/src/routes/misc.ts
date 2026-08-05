import { Router, type IRouter } from "express";
import multer from "multer";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  aiUsageTable,
  auditLogTable,
  farmsTable,
  farmMembersTable,
  sectorsTable,
  recommendationsTable,
  analysesTable,
  usersTable,
  productSheetsTable,
} from "@workspace/db";
import {
  GetUsageResponse,
  GetUsageQueryParams,
  ListAuditLogQueryParams,
  ListAuditLogResponse,
  GetDashboardResponse,
  GetMobileAppUrlResponse,
  ListProductSheetsResponse,
  IdentifyProductSheetResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  farmAlerts,
  latestAnalysis,
  activeRecommendation,
  resolveUserCredential,
} from "../lib/farmContext";
import {
  generateText,
  parseJsonLoose,
  supportsVision,
  modelFor,
  estimateCostEur,
  recordUsage,
  checkMonthlyLimit,
} from "../lib/openai";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

async function accessibleFarmIds(userId: number): Promise<number[]> {
  const owned = await db
    .select({ id: farmsTable.id })
    .from(farmsTable)
    .where(eq(farmsTable.ownerId, userId));
  const member = await db
    .select({ id: farmMembersTable.farmId })
    .from(farmMembersTable)
    .where(eq(farmMembersTable.userId, userId));
  return [...new Set([...owned.map((r) => r.id), ...member.map((r) => r.id)])];
}

router.get("/product-sheets", async (req, res): Promise<void> => {
  // Scope to the caller's own sheets (admins see all) — same ownership model
  // as the delete endpoint below.
  const rows = await db
    .select()
    .from(productSheetsTable)
    .where(req.user!.isAdmin ? undefined : eq(productSheetsTable.createdBy, req.user!.id))
    .orderBy(desc(productSheetsTable.createdAt));
  res.json(
    ListProductSheetsResponse.parse(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        manufacturer: s.manufacturer,
        category: s.category,
        formulaType: s.formulaType,
        description: s.description,
        composition: s.composition,
        dosage: s.dosage,
        sourceUrl: s.sourceUrl,
        fertilizerId: s.fertilizerId,
        createdBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
      })),
    ),
  );
});

router.delete("/product-sheets/:sheetId", async (req, res): Promise<void> => {
  const id = Number(req.params.sheetId);
  const [sheet] = await db.select().from(productSheetsTable).where(eq(productSheetsTable.id, id));
  if (!sheet) {
    res.status(404).json({ error: "Ficha no encontrada" });
    return;
  }
  if (!req.user!.isAdmin && sheet.createdBy !== req.user!.id) {
    res.status(403).json({ error: "Solo el creador o un administrador puede borrar la ficha" });
    return;
  }
  await db.delete(productSheetsTable).where(eq(productSheetsTable.id, id));
  res.status(204).send();
});

router.get("/mobile-app", async (req, res): Promise<void> => {
  // Prioridad: URL explícita > entorno Replit > servidor propio (la versión
  // web del móvil se sirve en MOBILE_APP_PATH, p. ej. /movil, en el mismo host).
  const mobilePath = process.env.MOBILE_APP_PATH;
  // Detrás de nginx la conexión local es HTTP: se respeta X-Forwarded-Proto
  // (que nginx fija) para no generar enlaces http:// en sitios servidos por HTTPS.
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  const url =
    process.env.MOBILE_APP_URL ??
    (process.env.REPLIT_EXPO_DEV_DOMAIN ? `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}` : null) ??
    (mobilePath && host ? `${proto}://${host}${mobilePath}` : null);
  res.json(GetMobileAppUrlResponse.parse({ url }));
});

router.get("/usage", async (req, res): Promise<void> => {
  const q = GetUsageQueryParams.safeParse(req.query);
  const month = q.success && q.data.month ? q.data.month : new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const rows = await db
    .select({ usage: aiUsageTable, farmName: farmsTable.name })
    .from(aiUsageTable)
    .leftJoin(farmsTable, eq(farmsTable.id, aiUsageTable.farmId))
    .where(
      and(
        eq(aiUsageTable.userId, req.user!.id),
        gte(aiUsageTable.createdAt, start),
        lt(aiUsageTable.createdAt, end),
      ),
    )
    .orderBy(desc(aiUsageTable.createdAt));

  const entries = rows.map((r) => ({
    id: r.usage.id,
    farmId: r.usage.farmId,
    farmName: r.farmName,
    model: r.usage.model,
    operation: r.usage.operation,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    estimatedCostEur: r.usage.estimatedCostEur,
    durationMs: r.usage.durationMs,
    result: r.usage.result,
    createdAt: r.usage.createdAt.toISOString(),
  }));
  const totalCost = entries.reduce((s, e) => s + (e.estimatedCostEur ?? 0), 0);
  const limit = req.user!.aiMonthlyLimitEur ?? null;
  res.json(
    GetUsageResponse.parse({
      month,
      queries: entries.filter((e) => e.operation === "chat").length,
      reports: entries.filter((e) => e.operation === "report").length,
      inputTokens: entries.reduce((s, e) => s + (e.inputTokens ?? 0), 0),
      outputTokens: entries.reduce((s, e) => s + (e.outputTokens ?? 0), 0),
      estimatedCostEur: Math.round(totalCost * 1e4) / 1e4,
      monthlyLimitEur: limit,
      limitUsedPct: limit ? Math.round((totalCost / limit) * 1000) / 10 : null,
      entries,
    }),
  );
});

router.get("/audit", async (req, res): Promise<void> => {
  const q = ListAuditLogQueryParams.safeParse(req.query);
  const farmId = q.success ? q.data.farmId : undefined;
  const limit = Math.min(q.success ? (q.data.limit ?? 100) : 100, 500);

  const farmIds = req.user!.isAdmin ? null : await accessibleFarmIds(req.user!.id);
  const conditions = [];
  if (farmId != null) {
    if (farmIds && !farmIds.includes(farmId)) {
      res.status(403).json({ error: "Sin acceso a esa finca" });
      return;
    }
    conditions.push(eq(auditLogTable.farmId, farmId));
  } else if (farmIds) {
    if (farmIds.length === 0) {
      // Only own actions.
      conditions.push(eq(auditLogTable.userId, req.user!.id));
    } else {
      conditions.push(
        sql`(${inArray(auditLogTable.farmId, farmIds)} OR ${eq(auditLogTable.userId, req.user!.id)})`,
      );
    }
  }
  const rows = await db
    .select({ entry: auditLogTable, userName: usersTable.name, farmName: farmsTable.name })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.userId))
    .leftJoin(farmsTable, eq(farmsTable.id, auditLogTable.farmId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
  res.json(
    ListAuditLogResponse.parse(
      rows.map((r) => ({
        id: r.entry.id,
        userId: r.entry.userId,
        userName: r.userName,
        farmId: r.entry.farmId,
        farmName: r.farmName,
        action: r.entry.action,
        entityType: r.entry.entityType,
        entityId: r.entry.entityId,
        detail: r.entry.detail,
        createdAt: r.entry.createdAt.toISOString(),
      })),
    ),
  );
});

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const productImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

router.post("/product-sheets/identify", productImageUpload.single("file"), async (req, res): Promise<void> => {
  const kind = req.body?.kind === "phyto" ? "phyto" : "fertilizer";
  if (!req.file || !productImageTypes.has(req.file.mimetype)) {
    res.status(400).json({
      error: "Adjunta una foto del producto (PNG, JPG, WebP o GIF) para identificarlo.",
    });
    return;
  }
  const credential = await resolveUserCredential(req.user!);
  if (!credential) {
    res.status(409).json({
      error: "Para identificar un producto con IA hace falta una clave de OpenAI o Mistral en Ajustes.",
    });
    return;
  }
  const limitMsg = await checkMonthlyLimit(req.user!, credential);
  if (limitMsg) {
    res.status(429).json({ error: limitMsg });
    return;
  }
  if (!supportsVision(credential)) {
    res.status(409).json({
      error: "El proveedor de IA configurado no admite análisis de imágenes. Usa una clave de OpenAI o Mistral en Ajustes.",
    });
    return;
  }

  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  const model = modelFor(credential);
  const start = Date.now();
  try {
    const { text: raw, inputTokens, outputTokens } = await generateText({
      credential,
      instructions:
        "Eres un técnico agrónomo. Lee la etiqueta o ficha técnica del producto de la fotografía y extrae sus datos en JSON. No inventes datos: si un valor no se ve claramente, devuélvelo como null (números) o cadena vacía (textos). Responde únicamente con el JSON." +
        (kind === "phyto"
          ? " Es un producto fitosanitario. Campos: productName (nombre comercial), registryNumber (nº de registro MAPA), activeIngredient (materia activa y concentración), pests (plagas autorizadas), doseInfo (dosis y condiciones), maxApplicationsYear (número entero), safetyDays (plazo de seguridad en días, entero), expiryDate (fin de autorización AAAA-MM-DD), notes."
          : " Es un abono/fertilizante. Campos: name (nombre comercial), manufacturer, category (abono soluble|abono líquido|quelato|bioestimulante|enmienda|otro), formulaType (solid|liquid), usage (fertirrigacion|enmienda), nPct, p2o5Pct, k2oPct, caoPct, mgoPct, so3Pct, boronPct (porcentajes numéricos, sin %), dosage, notes."),
      input:
        kind === "phyto"
          ? "Devuelve un objeto JSON con productName, registryNumber, activeIngredient, pests, doseInfo, maxApplicationsYear, safetyDays, expiryDate, notes."
          : "Devuelve un objeto JSON con name, manufacturer, category, formulaType, usage, nPct, p2o5Pct, k2oPct, caoPct, mgoPct, so3Pct, boronPct, dosage, notes.",
      images: [dataUrl],
      maxOutputTokens: 1200,
    });
    if (!raw) throw new Error("Respuesta vacía");
    const parsed = parseJsonLoose<Record<string, unknown>>(raw) ?? {};
    const num = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(String(v).replace(",", ".")) : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
    };
    const int = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(String(v).replace(",", ".")) : NaN;
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    };
    const str = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
      return s ? s.slice(0, 500) : null;
    };
    const warnings: string[] = [];
    if (kind === "phyto") {
      if (!str(parsed.productName)) warnings.push("No se ha leído bien el nombre comercial del producto.");
      if (int(parsed.safetyDays) == null) warnings.push("Revisa el plazo de seguridad: no se ha podido leer.");
    } else {
      if (!str(parsed.name)) warnings.push("No se ha leído bien el nombre comercial del producto.");
      const hasCleanComp =
        ["nPct", "p2o5Pct", "k2oPct", "caoPct", "mgoPct", "so3Pct"].some(
          (k) => num(parsed[k]) != null,
        );
      if (!hasCleanComp)
        warnings.push("Revisa la riqueza (N-P-K): no se han podido leer porcentajes fiables.");
    }
    await recordUsage({
      userId: req.user!.id,
      farmId: null,
      model,
      operation: "chat",
      inputTokens,
      outputTokens,
      estimatedCostEur: estimateCostEur(model, inputTokens, outputTokens),
      durationMs: Date.now() - start,
      result: "ok",
    });
    res.json(
      IdentifyProductSheetResponse.parse(
        kind === "phyto"
          ? {
              kind,
              warnings,
              productName: str(parsed.productName),
              registryNumber: str(parsed.registryNumber),
              activeIngredient: str(parsed.activeIngredient),
              pests: str(parsed.pests),
              doseInfo: str(parsed.doseInfo),
              maxApplicationsYear: int(parsed.maxApplicationsYear),
              safetyDays: int(parsed.safetyDays),
              expiryDate:
                typeof parsed.expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.expiryDate)
                  ? parsed.expiryDate
                  : null,
              notes: str(parsed.notes),
            }
          : {
              kind,
              warnings,
              name: str(parsed.name),
              manufacturer: str(parsed.manufacturer),
              category: str(parsed.category),
              formulaType: parsed.formulaType === "liquid" ? "liquid" : str(parsed.formulaType) === "liquid" ? "liquid" : parsed.formulaType === "solid" ? "solid" : null,
              usage: str(parsed.usage) === "enmienda" ? "enmienda" : str(parsed.usage) === "fertirrigacion" ? "fertirrigacion" : null,
              nPct: num(parsed.nPct),
              p2o5Pct: num(parsed.p2o5Pct),
              k2oPct: num(parsed.k2oPct),
              caoPct: num(parsed.caoPct),
              mgoPct: num(parsed.mgoPct),
              so3Pct: num(parsed.so3Pct),
              boronPct: num(parsed.boronPct),
              dosage: str(parsed.dosage),
              notes: str(parsed.notes),
            },
      ),
    );
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "Product identification failed");
    await recordUsage({
      userId: req.user!.id,
      farmId: null,
      model,
      operation: "chat",
      durationMs: Date.now() - start,
      result: "error",
    });
    res.status(502).json({
      error: "No se ha podido identificar el producto. Comprueba tu clave de IA y su crédito en Ajustes e inténtalo de nuevo.",
    });
    return;
  }
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const farmIds = await accessibleFarmIds(req.user!.id);
  let sectorCount = 0;
  let totalPlants = 0;
  let pendingRecommendations = 0;
  let analysesThisYear = 0;
  const alerts: string[] = [];

  if (farmIds.length) {
    const farms = await db.select().from(farmsTable).where(inArray(farmsTable.id, farmIds));
    totalPlants = farms.reduce((s, f) => s + (f.plantCount ?? 0), 0);
    const [sc] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sectorsTable)
      .where(inArray(sectorsTable.farmId, farmIds));
    sectorCount = sc?.count ?? 0;
    const [pr] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recommendationsTable)
      .where(
        and(
          inArray(recommendationsTable.farmId, farmIds),
          eq(recommendationsTable.status, "pending_review"),
        ),
      );
    pendingRecommendations = pr?.count ?? 0;
    const yearStart = new Date(new Date().getUTCFullYear(), 0, 1);
    const [ac] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(analysesTable)
      .where(and(inArray(analysesTable.farmId, farmIds), gte(analysesTable.createdAt, yearStart)));
    analysesThisYear = ac?.count ?? 0;

    for (const farm of farms.slice(0, 5)) {
      const [soil, leaf, water, active] = await Promise.all([
        latestAnalysis(farm.id, "soil"),
        latestAnalysis(farm.id, "leaf"),
        latestAnalysis(farm.id, "water"),
        activeRecommendation(farm.id),
      ]);
      for (const a of farmAlerts({ farm, soil, leaf, water, active }).slice(0, 2)) {
        alerts.push(`${farm.name}: ${a}`);
      }
    }
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const costRows = await db
    .select({ cost: aiUsageTable.estimatedCostEur })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, req.user!.id), gte(aiUsageTable.createdAt, monthStart)));
  const aiCost = costRows.reduce((s, r) => s + (r.cost ?? 0), 0);

  const activityConditions = farmIds.length
    ? sql`(${inArray(auditLogTable.farmId, farmIds)} OR ${eq(auditLogTable.userId, req.user!.id)})`
    : eq(auditLogTable.userId, req.user!.id);
  const activity = await db
    .select({ entry: auditLogTable, userName: usersTable.name, farmName: farmsTable.name })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.userId))
    .leftJoin(farmsTable, eq(farmsTable.id, auditLogTable.farmId))
    .where(activityConditions)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(10);

  res.json(
    GetDashboardResponse.parse({
      farmCount: farmIds.length,
      sectorCount,
      totalPlants,
      pendingRecommendations,
      analysesThisYear,
      aiCostThisMonthEur: Math.round(aiCost * 1e4) / 1e4,
      recentActivity: activity.map((r) => ({
        id: r.entry.id,
        userId: r.entry.userId,
        userName: r.userName,
        farmId: r.entry.farmId,
        farmName: r.farmName,
        action: r.entry.action,
        entityType: r.entry.entityType,
        entityId: r.entry.entityId,
        detail: r.entry.detail,
        createdAt: r.entry.createdAt.toISOString(),
      })),
      alerts: alerts.slice(0, 8),
    }),
  );
});

export default router;
