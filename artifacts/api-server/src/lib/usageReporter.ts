import { db, farmsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Reporte automático de uso a la central de facturación.
 *
 * Cada instalación de cooperativa cuenta sus fincas activas y las envía a la
 * central (POST /api/billing/usage) autenticándose con su token secreto. La
 * central actualiza con ello el cargo variable del mes (base + €/finca).
 *
 * Configuración (inyectada por deploy/provision-coop.sh en el .env de la
 * instancia):
 *   CENTRAL_URL    URL base de la instalación central (p. ej. https://www.dominio.com)
 *   INSTALL_TOKEN  Token secreto de la instalación (apiToken generado al contratar)
 *
 * Sin esas variables (desarrollo, o la propia central) el job no se arranca.
 */

/** Una vez al día; la central acumula el último valor reportado del mes. */
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Reintentos con espera creciente si la central no responde. */
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export function usageReporterConfig(): { centralUrl: string; token: string } | null {
  const centralUrl = process.env.CENTRAL_URL?.trim().replace(/\/+$/, "");
  const token = process.env.INSTALL_TOKEN?.trim();
  if (!centralUrl || !token) return null;
  return { centralUrl, token };
}

export async function countActiveFarms(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(farmsTable);
  return row?.count ?? 0;
}

/**
 * Envía el número de fincas activas a la central. Devuelve `true` si la
 * central lo aceptó; lanza en caso de error (para que el llamante reintente).
 */
export async function sendUsageReport(
  cfg: { centralUrl: string; token: string },
  activeFarms: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const url = `${cfg.centralUrl}/api/billing/usage`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-install-token": cfg.token,
    },
    body: JSON.stringify({ activeFarms }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`La central respondió ${res.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Un ciclo completo de reporte: cuenta las fincas y lo envía con reintentos.
 * Devuelve `true` si se llegó a reportar; `false` si se agotaron los intentos.
 */
export async function reportUsageOnce(
  cfg: { centralUrl: string; token: string },
  fetchFn: typeof fetch = fetch,
  retryDelaysMs: number[] = RETRY_DELAYS_MS,
): Promise<boolean> {
  const activeFarms = await countActiveFarms();
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await sendUsageReport(cfg, activeFarms, fetchFn);
      logger.info({ activeFarms, centralUrl: cfg.centralUrl }, "Uso reportado a la central de facturación");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const last = attempt === retryDelaysMs.length;
      logger.warn(
        { activeFarms, attempt: attempt + 1, maxAttempts: retryDelaysMs.length + 1, err: message },
        last
          ? "No se pudo reportar el uso a la central; se reintentará en el próximo ciclo diario"
          : "Fallo al reportar el uso a la central; reintentando",
      );
      if (last) return false;
      await sleep(retryDelaysMs[attempt]);
    }
  }
  return false;
}

/**
 * Arranca el job diario si la instancia está configurada como instalación de
 * cooperativa (CENTRAL_URL + INSTALL_TOKEN). Reporta una vez al arrancar y
 * después cada 24 h.
 */
export function startUsageReporter(): void {
  const cfg = usageReporterConfig();
  if (!cfg) {
    logger.info(
      "Reporte de uso a la central desactivado (CENTRAL_URL / INSTALL_TOKEN no configurados)",
    );
    return;
  }
  const run = () =>
    reportUsageOnce(cfg).catch((err: Error) =>
      logger.error({ err: err.message }, "El reporte de uso a la central falló inesperadamente"),
    );
  void run();
  const timer = setInterval(run, REPORT_INTERVAL_MS);
  timer.unref();
  logger.info({ centralUrl: cfg.centralUrl }, "Reporte diario de uso a la central activado");
}
