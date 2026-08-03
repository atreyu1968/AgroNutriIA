import { eq, inArray } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { encryptSecret, decryptSecret } from "./crypto";
import { logger } from "./logger";

/**
 * Envío de emails mediante Resend (https://resend.com).
 *
 * La clave y el remitente se leen primero de la configuración guardada por el
 * administrador (tabla app_settings, editable en Administración → Configuración);
 * si no hay nada guardado, se usan las variables de entorno:
 * - RESEND_API_KEY  Clave de API de Resend. Si falta, no se envía email y se
 *                   registra el enlace en los logs (útil en desarrollo).
 * - EMAIL_FROM      Remitente, p. ej. "AgroNutri <no-reply@midominio.com>".
 *                   Por defecto usa el dominio de pruebas de Resend.
 * - APP_URL         URL pública de la aplicación, para construir enlaces.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const SETTING_RESEND_API_KEY = "resend_api_key";
export const SETTING_EMAIL_FROM = "email_from";

export function appUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

export type EmailConfig = {
  apiKey: string | null;
  from: string;
  /** De dónde sale la clave activa. */
  source: "db" | "env" | "none";
  /** Valores guardados en BD (sin fallback a entorno). */
  dbApiKey: string | null;
  dbFrom: string | null;
};

export async function getEmailConfig(): Promise<EmailConfig> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [SETTING_RESEND_API_KEY, SETTING_EMAIL_FROM]));
  const storedKey = rows.find((r) => r.key === SETTING_RESEND_API_KEY)?.value?.trim() || null;
  let dbApiKey: string | null = null;
  if (storedKey) {
    try {
      dbApiKey = decryptSecret(storedKey);
    } catch (err) {
      logger.error({ err }, "No se pudo descifrar la clave de Resend guardada; se ignora");
    }
  }
  const dbFrom = rows.find((r) => r.key === SETTING_EMAIL_FROM)?.value?.trim() || null;
  const envKey = process.env.RESEND_API_KEY?.trim() || null;
  const apiKey = dbApiKey ?? envKey;
  return {
    apiKey,
    from:
      dbFrom ?? process.env.EMAIL_FROM?.trim() ?? "AgroNutri <onboarding@resend.dev>",
    source: dbApiKey ? "db" : envKey ? "env" : "none",
    dbApiKey,
    dbFrom,
  };
}

export async function setEmailSetting(key: string, rawValue: string | null): Promise<void> {
  if (rawValue == null) {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
    return;
  }
  // Las claves de API se guardan cifradas en reposo, igual que las de OpenAI.
  const value = key === SETTING_RESEND_API_KEY ? encryptSecret(rawValue) : rawValue;
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function emailConfigured(): Promise<boolean> {
  return Boolean((await getEmailConfig()).apiKey);
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const { apiKey, from } = await getEmailConfig();
  if (!apiKey) {
    throw new Error("Clave de Resend no configurada");
  }
  const resp = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend respondió ${resp.status}: ${body.slice(0, 300)}`);
  }
}

export async function sendTestEmail(to: string, name: string): Promise<void> {
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2e1a">
    <h2 style="color:#166534;margin:0 0 16px">AgroNutri AI</h2>
    <p>Hola ${escapeHtml(name)},</p>
    <p>Este es un email de prueba enviado desde Administración → Configuración.</p>
    <p>Si lo has recibido, la clave de Resend y el remitente están configurados correctamente. ✔️</p>
  </div>`;
  await sendEmail(to, "Email de prueba — AgroNutri AI", html);
  logger.info({ to }, "Test email sent");
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
): Promise<void> {
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2e1a">
    <h2 style="color:#166534;margin:0 0 16px">AgroNutri AI</h2>
    <p>Hola ${escapeHtml(name)},</p>
    <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.
       Pulsa el botón para elegir una nueva contraseña. El enlace caduca en 1 hora.</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${resetUrl}"
         style="background:#166534;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
        Restablecer contraseña
      </a>
    </p>
    <p style="font-size:13px;color:#555">Si el botón no funciona, copia este enlace en el navegador:<br>
      <a href="${resetUrl}">${resetUrl}</a></p>
    <p style="font-size:13px;color:#555">Si no has pedido este cambio, puedes ignorar este mensaje;
       tu contraseña seguirá siendo la misma.</p>
  </div>`;
  await sendEmail(to, "Restablece tu contraseña — AgroNutri AI", html);
  logger.info({ to }, "Password reset email sent");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
