import { Router, type IRouter } from "express";
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
} from "@workspace/db";
import {
  GetUsageResponse,
  GetUsageQueryParams,
  ListAuditLogQueryParams,
  ListAuditLogResponse,
  GetDashboardResponse,
  GetMobileAppUrlResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { farmAlerts, latestAnalysis, activeRecommendation } from "../lib/farmContext";

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

router.get("/mobile-app", async (_req, res): Promise<void> => {
  const url =
    process.env.MOBILE_APP_URL ??
    (process.env.REPLIT_EXPO_DEV_DOMAIN ? `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}` : null);
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
