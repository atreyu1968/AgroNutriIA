import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable, passwordResetTokensTable } from "@workspace/db";
import { and, gt, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  RegisterBody,
  LoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
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
import { appUrl, emailConfigured, sendPasswordResetEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { serializeUser } from "../lib/serializers";
import { isCoopInstance } from "../lib/instance";
import { demoMode } from "../lib/demo";
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

// El registro público está desactivado por defecto (solo el administrador
// da de alta usuarios); se habilita explícitamente con PUBLIC_REGISTRATION=true.
export function registrationEnabled(): boolean {
  return process.env.PUBLIC_REGISTRATION === "true";
}

router.get("/auth/config", (_req, res): void => {
  res.json({
    registrationEnabled: registrationEnabled(),
    coopInstance: isCoopInstance(),
    demoMode: demoMode(),
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  if (!registrationEnabled()) {
    res.status(403).json({
      error: "El registro está desactivado. Pide al administrador que cree tu cuenta.",
    });
    return;
  }
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
  if (!user.active) {
    res.status(403).json({ error: "Tu cuenta está desactivada. Contacta con el administrador." });
    return;
  }
  const token = await startSession(res, user.id);
  await audit({ userId: user.id, action: "login", entityType: "user", entityId: user.id });
  res.json(LoginResponse.parse({ ...serializeUser(user), token }));
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Limitador sencillo en memoria para evitar abuso del envío de emails:
// máx. 5 solicitudes por IP y 3 por correo cada 15 minutos.
const FORGOT_WINDOW_MS = 15 * 60 * 1000;
const forgotHits = new Map<string, number[]>();
function forgotAllowed(key: string, max: number): boolean {
  const now = Date.now();
  const hits = (forgotHits.get(key) ?? []).filter((t) => now - t < FORGOT_WINDOW_MS);
  if (hits.length >= max) {
    forgotHits.set(key, hits);
    return false;
  }
  hits.push(now);
  forgotHits.set(key, hits);
  if (forgotHits.size > 10000) {
    for (const [k, v] of forgotHits) {
      if (v.every((t) => now - t >= FORGOT_WINDOW_MS)) forgotHits.delete(k);
    }
  }
  return true;
}

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const withinLimit =
    forgotAllowed(`ip:${req.ip ?? "?"}`, 5) && forgotAllowed(`email:${email}`, 3);

  // Respuesta siempre 204 para no revelar si el correo existe (también al limitar).
  res.status(204).send();
  if (!withinLimit) {
    logger.warn({ ip: req.ip }, "forgot-password limitado por exceso de solicitudes");
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user || !user.active) return;
    const token = randomToken();
    await db.insert(passwordResetTokensTable).values({
      tokenHash: hashResetToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    // En producción el enlace se construye solo desde APP_URL configurada;
    // nunca desde la cabecera Host (controlable por el cliente).
    let base = appUrl();
    if (!base) {
      if (process.env.NODE_ENV === "production") {
        logger.error(
          "APP_URL no configurada: no se puede generar un enlace de recuperación seguro en producción",
        );
        return;
      }
      base = `${req.protocol}://${req.get("host") ?? "localhost"}`;
    }
    const resetUrl = `${base}/restablecer?token=${token}`;
    if (await emailConfigured()) {
      await sendPasswordResetEmail(user.email, user.name, resetUrl);
    } else {
      logger.warn(
        { email: user.email, resetUrl },
        "Clave de Resend no configurada (ni en Administración ni en el entorno): no se ha enviado el email de recuperación (enlace en este log)",
      );
    }
    await audit({ userId: user.id, action: "forgot_password", entityType: "user", entityId: user.id });
  } catch (err) {
    logger.error({ err }, "Error procesando la solicitud de recuperación de contraseña");
  }
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tokenHash = hashResetToken(parsed.data.token);
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  // Consumo atómico del token: el UPDATE condicional garantiza un solo uso
  // aunque lleguen dos peticiones simultáneas con el mismo enlace.
  const userId = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.tokenHash, tokenHash),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });
    if (!consumed) return null;
    await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, consumed.userId));
    // Cierra todas las sesiones abiertas por seguridad.
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, consumed.userId));
    return consumed.userId;
  });
  if (userId == null) {
    res.status(400).json({ error: "El enlace no es válido o ha caducado. Solicita uno nuevo." });
    return;
  }
  await audit({ userId, action: "reset_password", entityType: "user", entityId: userId });
  res.status(204).send();
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
