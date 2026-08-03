import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, farmsTable, farmMembersTable } from "@workspace/db";
import {
  AdminListUsersResponse,
  AdminCreateUserBody,
  AdminCreateUserResponse,
  AdminUpdateUserBody,
  AdminUpdateUserResponse,
  AdminListFarmsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

/** Strictly parse a numeric path param; returns null for malformed values like "1abc". */
function strictId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

router.use((req, res, next) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo para administradores" });
    return;
  }
  next();
});

async function serializeAdminUser(u: typeof usersTable.$inferSelect) {
  const [owned] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(farmsTable)
    .where(eq(farmsTable.ownerId, u.id));
  const [member] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(farmMembersTable)
    .where(eq(farmMembersTable.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    company: u.company,
    phone: u.phone,
    role: u.role,
    isAdmin: u.isAdmin,
    active: u.active,
    aiMonthlyLimitEur: u.aiMonthlyLimitEur,
    farmCount: (owned?.count ?? 0) + (member?.count ?? 0),
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const result = [];
  for (const u of users) result.push(await serializeAdminUser(u));
  res.json(AdminListUsersResponse.parse(result));
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const parsed = AdminCreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Ya existe una cuenta con ese correo" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      name: parsed.data.name,
      company: parsed.data.company ?? null,
      role: parsed.data.role ?? "owner",
      isAdmin: parsed.data.isAdmin ?? false,
    })
    .returning();
  await audit({
    userId: req.user!.id,
    action: "admin_user_created",
    entityType: "user",
    entityId: user.id,
    detail: user.email,
  });
  res.status(201).json(AdminCreateUserResponse.parse(await serializeAdminUser(user)));
});

router.patch("/admin/users/:userId", async (req, res): Promise<void> => {
  const userId = strictId(req.params.userId);
  if (userId == null) {
    res.status(400).json({ error: "Identificador de usuario no válido" });
    return;
  }
  const parsed = AdminUpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (userId === req.user!.id && parsed.data.isAdmin === false) {
    res.status(400).json({ error: "No puedes quitarte a ti mismo los permisos de administrador" });
    return;
  }
  if (userId === req.user!.id && parsed.data.active === false) {
    res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
    return;
  }
  const { password, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No se ha indicado ningún campo para actualizar" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(update)
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  await audit({
    userId: req.user!.id,
    action: "admin_user_updated",
    entityType: "user",
    entityId: userId,
    detail: user.email,
  });
  res.json(AdminUpdateUserResponse.parse(await serializeAdminUser(user)));
});

router.delete("/admin/users/:userId", async (req, res): Promise<void> => {
  const userId = strictId(req.params.userId);
  if (userId == null) {
    res.status(400).json({ error: "Identificador de usuario no válido" });
    return;
  }
  if (userId === req.user!.id) {
    res.status(400).json({ error: "No puedes eliminar tu propia cuenta de administrador" });
    return;
  }
  // Atomic: the ownership check and the delete run in one transaction so a farm
  // created concurrently cannot be cascade-deleted by the user delete.
  const outcome = await db.transaction(async (tx) => {
    // Note: FOR UPDATE cannot be combined with aggregates, so lock the rows and count them here.
    const ownedFarms = await tx
      .select({ id: farmsTable.id })
      .from(farmsTable)
      .where(eq(farmsTable.ownerId, userId))
      .for("update");
    if (ownedFarms.length > 0) return { status: "has_farms" as const };
    const [user] = await tx.delete(usersTable).where(eq(usersTable.id, userId)).returning();
    if (!user) return { status: "not_found" as const };
    return { status: "deleted" as const, user };
  });
  if (outcome.status === "has_farms") {
    res.status(409).json({
      error:
        "El usuario es propietario de fincas. Elimina o reasigna sus fincas antes de borrar la cuenta.",
    });
    return;
  }
  if (outcome.status === "not_found") {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  const user = outcome.user;
  await audit({
    userId: req.user!.id,
    action: "admin_user_deleted",
    entityType: "user",
    entityId: userId,
    detail: user.email,
  });
  res.status(204).send();
});

router.get("/admin/farms", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ farm: farmsTable, ownerName: usersTable.name })
    .from(farmsTable)
    .leftJoin(usersTable, eq(usersTable.id, farmsTable.ownerId))
    .orderBy(farmsTable.id);
  const result = [];
  for (const r of rows) {
    const [mc] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(farmMembersTable)
      .where(eq(farmMembersTable.farmId, r.farm.id));
    result.push({
      id: r.farm.id,
      ownerId: r.farm.ownerId,
      ownerName: r.ownerName ?? "—",
      name: r.farm.name,
      companyName: r.farm.companyName,
      island: r.farm.island,
      municipality: r.farm.municipality,
      plantCount: r.farm.plantCount,
      surfaceHa: r.farm.surfaceHa,
      memberCount: (mc?.count ?? 0) + 1,
      createdAt: r.farm.createdAt?.toISOString() ?? null,
    });
  }
  res.json(AdminListFarmsResponse.parse(result));
});

router.delete("/admin/farms/:farmId", async (req, res): Promise<void> => {
  const farmId = strictId(req.params.farmId);
  if (farmId == null) {
    res.status(400).json({ error: "Identificador de finca no válido" });
    return;
  }
  const [farm] = await db.delete(farmsTable).where(eq(farmsTable.id, farmId)).returning();
  if (!farm) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  await audit({
    userId: req.user!.id,
    action: "admin_farm_deleted",
    entityType: "farm",
    entityId: farmId,
    detail: farm.name,
  });
  res.status(204).send();
});

export default router;
