import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  farmsTable,
  farmMembersTable,
  sectorsTable,
  usersTable,
  farmApiConfigTable,
  credentialsTable,
} from "@workspace/db";
import {
  CreateFarmBody,
  UpdateFarmBody,
  CreateFarmResponse,
  GetFarmResponse,
  UpdateFarmResponse,
  ListFarmsResponse,
  GetFarmSummaryResponse,
  CreateSectorBody,
  UpdateSectorBody,
  ListSectorsResponse,
  CreateSectorResponse,
  UpdateSectorResponse,
  AddMemberBody,
  UpdateMemberBody,
  ListMembersResponse,
  AddMemberResponse,
  UpdateMemberResponse,
  GetFarmApiConfigResponse,
  SetFarmApiConfigBody,
  SetFarmApiConfigResponse,
} from "@workspace/api-zod";
import { requireAuth, farmAccess, canEdit, parseIntParam } from "../middlewares/auth";
import { serializeFarm, serializeAnalysis, serializeRecommendation } from "../lib/serializers";
import {
  latestAnalysis,
  activeRecommendation,
  farmAlerts,
  resolveCredential,
  userName,
} from "../lib/farmContext";
import { audit } from "../lib/audit";
import { demoMode, DEMO_FARM_LIMIT_MESSAGE } from "../lib/demo";

const router: IRouter = Router();
router.use(requireAuth);

async function sectorCount(farmId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sectorsTable)
    .where(eq(sectorsTable.farmId, farmId));
  return row?.count ?? 0;
}

router.get("/farms", async (req, res): Promise<void> => {
  const user = req.user!;
  const owned = await db.select().from(farmsTable).where(eq(farmsTable.ownerId, user.id));
  const memberships = await db
    .select()
    .from(farmMembersTable)
    .where(eq(farmMembersTable.userId, user.id));
  const memberFarmIds = memberships.map((m) => m.farmId).filter((id) => !owned.some((f) => f.id === id));
  const memberFarms = memberFarmIds.length
    ? await db.select().from(farmsTable).where(inArray(farmsTable.id, memberFarmIds))
    : [];
  const roleOf = (farmId: number) =>
    memberships.find((m) => m.farmId === farmId)?.role ?? "viewer";

  const result = [];
  for (const f of owned) result.push(serializeFarm(f, "owner", await sectorCount(f.id)));
  for (const f of memberFarms) result.push(serializeFarm(f, roleOf(f.id), await sectorCount(f.id)));
  res.json(ListFarmsResponse.parse(result));
});

router.post("/farms", async (req, res): Promise<void> => {
  const parsed = CreateFarmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (demoMode()) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(farmsTable);
    if (count >= 1) {
      res.status(403).json({ error: DEMO_FARM_LIMIT_MESSAGE });
      return;
    }
  }
  const [farm] = await db
    .insert(farmsTable)
    .values({ ...parsed.data, ownerId: req.user!.id })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId: farm.id,
    action: "farm_created",
    entityType: "farm",
    entityId: farm.id,
    detail: farm.name,
  });
  res.status(201).json(CreateFarmResponse.parse(serializeFarm(farm, "owner", 0)));
});

router.get("/farms/:farmId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  res.json(GetFarmResponse.parse(serializeFarm(access.farm, access.role, await sectorCount(farmId))));
});

router.patch("/farms/:farmId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos para editar la finca" });
    return;
  }
  const parsed = UpdateFarmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [farm] = await db
    .update(farmsTable)
    .set(parsed.data)
    .where(eq(farmsTable.id, farmId))
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "farm_updated",
    entityType: "farm",
    entityId: farmId,
  });
  res.json(UpdateFarmResponse.parse(serializeFarm(farm, access.role, await sectorCount(farmId))));
});

router.delete("/farms/:farmId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (access.role !== "owner" && !req.user!.isAdmin) {
    res.status(403).json({ error: "Solo el propietario puede eliminar la finca" });
    return;
  }
  await db.delete(farmsTable).where(eq(farmsTable.id, farmId));
  await audit({
    userId: req.user!.id,
    action: "farm_deleted",
    entityType: "farm",
    entityId: farmId,
    detail: access.farm.name,
  });
  res.status(204).send();
});

router.get("/farms/:farmId/summary", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [soil, leaf, water, active] = await Promise.all([
    latestAnalysis(farmId, "soil"),
    latestAnalysis(farmId, "leaf"),
    latestAnalysis(farmId, "water"),
    activeRecommendation(farmId),
  ]);
  const cred = await resolveCredential(access.farm, req.user!);
  const weeklyWaterM3 =
    access.farm.plantCount && access.farm.weeklyLitresPerPlant
      ? Math.round((access.farm.plantCount * access.farm.weeklyLitresPerPlant) / 100) / 10
      : null;
  res.json(
    GetFarmSummaryResponse.parse({
      farm: serializeFarm(access.farm, access.role, await sectorCount(farmId)),
      weeklyWaterM3,
      latestSoilAnalysis: soil ? serializeAnalysis(soil) : null,
      latestLeafAnalysis: leaf ? serializeAnalysis(leaf) : null,
      latestWaterAnalysis: water ? serializeAnalysis(water) : null,
      activeRecommendation: active
        ? serializeRecommendation(
            active,
            await userName(active.createdBy),
            await userName(active.validatedBy),
          )
        : null,
      alerts: farmAlerts({ farm: access.farm, soil, leaf, water, active }),
      aiAvailable: !!cred,
    }),
  );
});

// ---- Sectors ----

router.get("/farms/:farmId/sectors", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const sectors = await db
    .select()
    .from(sectorsTable)
    .where(eq(sectorsTable.farmId, farmId))
    .orderBy(sectorsTable.id);
  res.json(ListSectorsResponse.parse(sectors));
});

router.post("/farms/:farmId/sectors", async (req, res): Promise<void> => {
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
  const parsed = CreateSectorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [sector] = await db
    .insert(sectorsTable)
    .values({ ...parsed.data, farmId })
    .returning();
  res.status(201).json(CreateSectorResponse.parse(sector));
});

router.patch("/farms/:farmId/sectors/:sectorId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const sectorId = parseIntParam(req.params.sectorId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const parsed = UpdateSectorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [sector] = await db
    .update(sectorsTable)
    .set(parsed.data)
    .where(and(eq(sectorsTable.id, sectorId), eq(sectorsTable.farmId, farmId)))
    .returning();
  if (!sector) {
    res.status(404).json({ error: "Sector no encontrado" });
    return;
  }
  res.json(UpdateSectorResponse.parse(sector));
});

router.delete("/farms/:farmId/sectors/:sectorId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const sectorId = parseIntParam(req.params.sectorId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const [sector] = await db
    .delete(sectorsTable)
    .where(and(eq(sectorsTable.id, sectorId), eq(sectorsTable.farmId, farmId)))
    .returning();
  if (!sector) {
    res.status(404).json({ error: "Sector no encontrado" });
    return;
  }
  res.status(204).send();
});

// ---- Members ----

function serializeMember(m: { id: number; farmId: number; userId: number; role: string }, u: { name: string; email: string }) {
  return { id: m.id, farmId: m.farmId, userId: m.userId, role: m.role, name: u.name, email: u.email };
}

router.get("/farms/:farmId/members", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select({ member: farmMembersTable, user: usersTable })
    .from(farmMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, farmMembersTable.userId))
    .where(eq(farmMembersTable.farmId, farmId));
  res.json(ListMembersResponse.parse(rows.map((r) => serializeMember(r.member, r.user))));
});

router.post("/farms/:farmId/members", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (access.role !== "owner" && !req.user!.isAdmin) {
    res.status(403).json({ error: "Solo el propietario puede gestionar miembros" });
    return;
  }
  const parsed = AddMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const [target] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!target) {
    res.status(404).json({ error: "No existe ningún usuario con ese correo. Pídele que se registre primero." });
    return;
  }
  if (target.id === access.farm.ownerId) {
    res.status(409).json({ error: "Ese usuario ya es el propietario de la finca" });
    return;
  }
  const [existing] = await db
    .select()
    .from(farmMembersTable)
    .where(and(eq(farmMembersTable.farmId, farmId), eq(farmMembersTable.userId, target.id)));
  if (existing) {
    res.status(409).json({ error: "Ese usuario ya es miembro de la finca" });
    return;
  }
  const [member] = await db
    .insert(farmMembersTable)
    .values({ farmId, userId: target.id, role: parsed.data.role })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "member_added",
    entityType: "member",
    entityId: member.id,
    detail: `${target.email} (${parsed.data.role})`,
  });
  res.status(201).json(AddMemberResponse.parse(serializeMember(member, target)));
});

router.patch("/farms/:farmId/members/:memberId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const memberId = parseIntParam(req.params.memberId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (access.role !== "owner" && !req.user!.isAdmin) {
    res.status(403).json({ error: "Solo el propietario puede gestionar miembros" });
    return;
  }
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [member] = await db
    .update(farmMembersTable)
    .set({ role: parsed.data.role })
    .where(and(eq(farmMembersTable.id, memberId), eq(farmMembersTable.farmId, farmId)))
    .returning();
  if (!member) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, member.userId));
  res.json(UpdateMemberResponse.parse(serializeMember(member, target)));
});

router.delete("/farms/:farmId/members/:memberId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const memberId = parseIntParam(req.params.memberId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (access.role !== "owner" && !req.user!.isAdmin) {
    res.status(403).json({ error: "Solo el propietario puede gestionar miembros" });
    return;
  }
  const [member] = await db
    .delete(farmMembersTable)
    .where(and(eq(farmMembersTable.id, memberId), eq(farmMembersTable.farmId, farmId)))
    .returning();
  if (!member) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  res.status(204).send();
});

// ---- Farm API config ----

async function apiConfigPayload(farmId: number) {
  const [cfg] = await db
    .select()
    .from(farmApiConfigTable)
    .where(eq(farmApiConfigTable.farmId, farmId));
  let credentialName: string | null = null;
  if (cfg?.credentialId) {
    const [cred] = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.id, cfg.credentialId));
    credentialName = cred?.name ?? null;
  }
  return { farmId, credentialId: cfg?.credentialId ?? null, credentialName };
}

router.get("/farms/:farmId/api-config", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  res.json(GetFarmApiConfigResponse.parse(await apiConfigPayload(farmId)));
});

router.put("/farms/:farmId/api-config", async (req, res): Promise<void> => {
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
  const parsed = SetFarmApiConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const credentialId = parsed.data.credentialId ?? null;
  if (credentialId != null) {
    const [cred] = await db
      .select()
      .from(credentialsTable)
      .where(and(eq(credentialsTable.id, credentialId), eq(credentialsTable.userId, req.user!.id)));
    if (!cred) {
      res.status(404).json({ error: "Credencial no encontrada" });
      return;
    }
  }
  await db
    .insert(farmApiConfigTable)
    .values({ farmId, credentialId })
    .onConflictDoUpdate({ target: farmApiConfigTable.farmId, set: { credentialId } });
  res.json(SetFarmApiConfigResponse.parse(await apiConfigPayload(farmId)));
});

export default router;
