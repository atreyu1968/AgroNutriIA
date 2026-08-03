import type { Request, Response, NextFunction } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  sessionsTable,
  usersTable,
  farmsTable,
  farmMembersTable,
  type User,
  type Farm,
} from "@workspace/db";

export const SESSION_COOKIE = "agronutri_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function sessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (cookieToken && typeof cookieToken === "string") return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return null;
}

export async function loadUser(req: Request): Promise<User | null> {
  const token = sessionToken(req);
  if (!token || typeof token !== "string") return null;
  const rows = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(
      and(
        eq(sessionsTable.id, token),
        gt(sessionsTable.expiresAt, new Date()),
        eq(usersTable.active, true),
      ),
    );
  return rows[0]?.user ?? null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await loadUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  req.user = user;
  next();
}

export type FarmAccess = { farm: Farm; role: string };

/** Returns the farm and the caller's role on it, or null if no access. */
export async function farmAccess(user: User, farmId: number): Promise<FarmAccess | null> {
  const [farm] = await db.select().from(farmsTable).where(eq(farmsTable.id, farmId));
  if (!farm) return null;
  if (farm.ownerId === user.id) return { farm, role: "owner" };
  if (user.isAdmin) return { farm, role: "technician" };
  const [member] = await db
    .select()
    .from(farmMembersTable)
    .where(and(eq(farmMembersTable.farmId, farmId), eq(farmMembersTable.userId, user.id)));
  if (!member) return null;
  return { farm, role: member.role };
}

export function canEdit(role: string): boolean {
  return role === "owner" || role === "technician";
}

export function canApply(role: string): boolean {
  return role === "owner" || role === "technician" || role === "manager";
}

export function parseIntParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v ?? "", 10);
}
