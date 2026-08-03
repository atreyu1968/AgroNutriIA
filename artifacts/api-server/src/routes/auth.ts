import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import {
  RegisterBody,
  LoginBody,
  UpdateMeBody,
  RegisterResponse,
  LoginResponse,
  GetMeResponse,
  UpdateMeResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  loadUser,
  sessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../middlewares/auth";
import { randomToken } from "../lib/crypto";
import { serializeUser } from "../lib/serializers";
import { audit } from "../lib/audit";

const router: IRouter = Router();

async function startSession(
  res: import("express").Response,
  userId: number,
): Promise<string> {
  const token = randomToken();
  await db.insert(sessionsTable).values({
    id: token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  return token;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
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
      company: parsed.data.company,
      phone: parsed.data.phone,
    })
    .returning();
  const token = await startSession(res, user.id);
  await audit({ userId: user.id, action: "register", entityType: "user", entityId: user.id });
  res.status(201).json(RegisterResponse.parse({ ...serializeUser(user), token }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Correo o contraseña incorrectos" });
    return;
  }
  const token = await startSession(res, user.id);
  await audit({ userId: user.id, action: "login", entityType: "user", entityId: user.id });
  res.json(LoginResponse.parse({ ...serializeUser(user), token }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = sessionToken(req);
  if (token && typeof token === "string") {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, token));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).send();
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await loadUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  res.json(GetMeResponse.parse(serializeUser(user)));
});

router.patch("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { password, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .update(usersTable)
    .set(update)
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  res.json(UpdateMeResponse.parse(serializeUser(user)));
});

export default router;
