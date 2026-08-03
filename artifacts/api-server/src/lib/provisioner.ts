import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  installationsTable,
  provisioningEventsTable,
  billingChargesTable,
  type Installation,
} from "@workspace/db";
import { emailConfigured, sendInstallationReadyEmail } from "./email";
import { BASE_PRICE_CENTS, PER_FARM_CENTS } from "./paypal";
import { logger } from "./logger";

/**
 * Aprovisionamiento automático de instalaciones por cooperativa.
 *
 * En producción, con las variables PROVISION_SCRIPT (ruta a
 * deploy/provision-coop.sh) y BASE_DOMAIN definidas, ejecuta el script real
 * que crea subdominio (nginx + DNS wildcard), base de datos propia, servicio
 * systemd y certificado TLS. Sin esas variables (desarrollo/Replit) los pasos
 * se registran como simulados para poder probar el flujo completo.
 */

export function baseDomain(): string {
  return process.env.BASE_DOMAIN?.trim() || "agronutri.example";
}

export function installationUrl(subdomain: string): string {
  return `https://${subdomain}.${baseDomain()}`;
}

async function logEvent(
  installationId: number,
  step: string,
  status: "ok" | "error" | "info",
  detail?: string,
): Promise<void> {
  await db.insert(provisioningEventsTable).values({ installationId, step, status, detail });
}

async function setStatus(installationId: number, status: string): Promise<void> {
  await db
    .update(installationsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(installationsTable.id, installationId));
}

function generatePassword(): string {
  // 12 bytes → 16 caracteres base64url, sin ambigüedades molestas.
  return randomBytes(12).toString("base64url");
}

function runScript(script: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.slice(-4000));
      else reject(new Error(`El script terminó con código ${code}: ${out.slice(-1000)}`));
    });
  });
}

/** Pasos lógicos del aprovisionamiento, en orden. */
const STEPS: { step: string; label: string }[] = [
  { step: "dns", label: "Subdominio y DNS (wildcard)" },
  { step: "database", label: "Base de datos propia" },
  { step: "service", label: "Servicio de la aplicación (systemd)" },
  { step: "tls", label: "Certificado TLS" },
  { step: "admin_account", label: "Cuenta de administrador inicial" },
];

/**
 * Aprovisiona una instalación (idempotente: si ya está activa no hace nada).
 * Se lanza en segundo plano; el estado y los eventos quedan en la BD.
 */
export async function provisionInstallation(installationId: number): Promise<void> {
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, installationId));
  if (!inst) return;
  if (inst.status === "active") return;
  await setStatus(installationId, "provisioning");
  await logEvent(installationId, "start", "info", `Aprovisionando ${inst.subdomain}.${baseDomain()}`);

  const adminEmail = inst.contactEmail;
  const adminPassword = generatePassword();
  const script = process.env.PROVISION_SCRIPT?.trim();

  try {
    if (script) {
      // Saneado defensivo: el script vuelve a validar, pero nunca se le pasan
      // caracteres de control ni comillas procedentes del formulario público.
      const clean = (s: string) => s.replace(/[\x00-\x1f\x7f'"`\\$]/g, "").slice(0, 80);
      const output = await runScript(script, [inst.subdomain, baseDomain()], {
        COOP_NAME: clean(inst.name),
        ADMIN_EMAIL: adminEmail,
        ADMIN_PASSWORD: adminPassword,
        ADMIN_NAME: clean(inst.contactName),
        // Para el reporte automático de uso (fincas activas → cargo variable):
        // la URL pública de la central y el token secreto de la instalación.
        CENTRAL_URL: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
        INSTALL_TOKEN: inst.apiToken,
      });
      for (const s of STEPS) await logEvent(installationId, s.step, "ok", s.label);
      await logEvent(installationId, "script", "ok", output.slice(-800));
    } else {
      for (const s of STEPS) {
        await logEvent(
          installationId,
          s.step,
          "ok",
          `${s.label} — simulado (PROVISION_SCRIPT no configurado en este entorno)`,
        );
      }
    }

    // Email con las credenciales del administrador inicial.
    if (await emailConfigured()) {
      try {
        await sendInstallationReadyEmail({
          to: inst.contactEmail,
          contactName: inst.contactName,
          coopName: inst.name,
          url: installationUrl(inst.subdomain),
          adminEmail,
          adminPassword,
        });
        await logEvent(installationId, "email", "ok", `Credenciales enviadas a ${inst.contactEmail}`);
      } catch (err) {
        await logEvent(
          installationId,
          "email",
          "error",
          `No se pudo enviar el email de credenciales: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      await logEvent(
        installationId,
        "email",
        "info",
        "Email no configurado (Resend): las credenciales no se han podido enviar automáticamente",
      );
    }

    await db
      .update(installationsTable)
      .set({ status: "active", provisionedAt: new Date(), updatedAt: new Date() })
      .where(eq(installationsTable.id, installationId));
    await logEvent(installationId, "done", "ok", "Instalación activa");
    await upsertMonthlyCharge(installationId);
    logger.info({ installationId, subdomain: inst.subdomain }, "Instalación aprovisionada");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(installationId, "error", "error", message);
    await setStatus(installationId, "error");
    logger.error({ err, installationId }, "Fallo al aprovisionar la instalación");
  }
}

/** Lanza el aprovisionamiento en segundo plano sin bloquear la petición. */
export function provisionInBackground(installationId: number): void {
  void provisionInstallation(installationId).catch((err) =>
    logger.error({ err, installationId }, "Aprovisionamiento en segundo plano falló"),
  );
}

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Crea o actualiza el cargo del mes en curso: cuota base + variable por
 * fincas activas (según el último reporte de uso de la instalación).
 */
export async function upsertMonthlyCharge(installationId: number): Promise<void> {
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, installationId));
  if (!inst) return;
  const farmCount = inst.activeFarmCount;
  const variableCents = farmCount * PER_FARM_CENTS;
  const totalCents = BASE_PRICE_CENTS + variableCents;
  const period = currentPeriod();
  await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period,
      baseCents: BASE_PRICE_CENTS,
      farmCount,
      variableCents,
      totalCents,
    })
    .onConflictDoUpdate({
      target: [billingChargesTable.installationId, billingChargesTable.period],
      set: { farmCount, variableCents, totalCents, updatedAt: new Date() },
    });
}

/** Suspensión por impago (según los términos publicados). */
export async function suspendInstallation(inst: Installation, reason: string): Promise<void> {
  if (inst.status === "cancelled") return;
  await setStatus(inst.id, "suspended");
  await logEvent(inst.id, "suspend", "info", reason);
}

/** Reactivación tras regularizar el pago. */
export async function reactivateInstallation(inst: Installation): Promise<void> {
  if (inst.status !== "suspended") return;
  await setStatus(inst.id, "active");
  await logEvent(inst.id, "reactivate", "info", "Suscripción reactivada");
}

/** Baja: se marca cancelada y se registra la exportación de datos prometida. */
export async function cancelInstallation(inst: Installation, reason: string): Promise<void> {
  if (inst.status === "cancelled") return;
  await setStatus(inst.id, "cancelled");
  await logEvent(inst.id, "cancel", "info", reason);
  const script = process.env.EXPORT_SCRIPT?.trim();
  if (script) {
    try {
      const output = await runScript(script, [inst.subdomain, baseDomain()], {});
      await logEvent(inst.id, "export", "ok", `Exportación de datos generada. ${output.slice(-500)}`);
    } catch (err) {
      await logEvent(
        inst.id,
        "export",
        "error",
        `Fallo en la exportación de datos: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    await logEvent(
      inst.id,
      "export",
      "info",
      "Exportación de datos pendiente de ejecución manual (EXPORT_SCRIPT no configurado)",
    );
  }
}
