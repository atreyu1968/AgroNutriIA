import { logger } from "./logger";

/**
 * Envío de emails mediante Resend (https://resend.com).
 *
 * Variables de entorno:
 * - RESEND_API_KEY  Clave de API de Resend. Si falta, no se envía email y se
 *                   registra el enlace en los logs (útil en desarrollo).
 * - EMAIL_FROM      Remitente, p. ej. "AgroNutri <no-reply@midominio.com>".
 *                   Por defecto usa el dominio de pruebas de Resend.
 * - APP_URL         URL pública de la aplicación, para construir enlaces.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function appUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY no configurada");
  }
  const from = process.env.EMAIL_FROM ?? "AgroNutri <onboarding@resend.dev>";
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
