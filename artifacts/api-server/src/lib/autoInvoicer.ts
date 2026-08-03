import { and, eq, lt } from "drizzle-orm";
import { db, billingChargesTable, installationsTable } from "@workspace/db";
import { logger } from "./logger";
import { getBillingSettings, renderInvoicePdf, formatEuros } from "./invoiceGen";
import { issueInvoiceForCharge } from "./invoiceIssuer";
import { currentPeriod } from "./provisioner";
import { emailConfigured, sendInvoiceEmail } from "./email";
import { invoicesTable } from "@workspace/db";

/**
 * Emisión automática de facturas: cuando un mes se cierra, los cargos de
 * periodos anteriores que siguen en estado "pending" se facturan sin
 * intervención manual (el importe del mes ya no cambia). Opcionalmente, la
 * factura se envía por email a la cooperativa según la configuración de
 * facturación (billing_auto_send).
 *
 * Requisitos para emitir: datos del emisor configurados y NIF de la
 * instalación. Si falta algo se omite el cargo (quedará pendiente en el
 * panel de administración) y se deja constancia en los logs.
 */

const AUTO_INVOICE_INTERVAL_MS = 60 * 60_000; // cada hora

export type AutoInvoiceResult = {
  issued: number;
  emailed: number;
  skipped: number;
};

export async function runAutoInvoicing(now = new Date()): Promise<AutoInvoiceResult> {
  const result: AutoInvoiceResult = { issued: 0, emailed: 0, skipped: 0 };
  const period = currentPeriod(now);
  const closedCharges = await db
    .select()
    .from(billingChargesTable)
    .where(
      and(eq(billingChargesTable.status, "pending"), lt(billingChargesTable.period, period)),
    );
  if (closedCharges.length === 0) return result;

  const settings = await getBillingSettings();
  if (!settings.configured) {
    logger.warn(
      { pendingCharges: closedCharges.length },
      "Facturación automática omitida: faltan los datos del emisor (Administración → Facturación)",
    );
    result.skipped = closedCharges.length;
    return result;
  }
  const canEmail = settings.autoSendEmail && (await emailConfigured());
  if (settings.autoSendEmail && !canEmail) {
    logger.warn(
      {},
      "Envío automático de facturas activado pero el email (Resend) no está configurado; se emitirán sin enviar",
    );
  }

  for (const charge of closedCharges) {
    const [inst] = await db
      .select()
      .from(installationsTable)
      .where(eq(installationsTable.id, charge.installationId));
    if (!inst) {
      result.skipped++;
      continue;
    }
    if (!inst.taxId) {
      logger.warn(
        { installationId: inst.id, period: charge.period },
        "Factura automática omitida: la instalación no tiene NIF",
      );
      result.skipped++;
      continue;
    }
    try {
      const inv = await issueInvoiceForCharge({ inst, charge, settings });
      result.issued++;
      logger.info(
        { installationId: inst.id, invoice: inv.fullNumber, period: charge.period },
        "Factura emitida automáticamente",
      );
      if (canEmail && inv.status === "issued") {
        try {
          const pdf = await renderInvoicePdf(inv);
          await sendInvoiceEmail({
            to: inst.contactEmail,
            contactName: inst.contactName,
            coopName: inst.name,
            fullNumber: inv.fullNumber,
            period: inv.period,
            totalEuros: formatEuros(inv.totalCents),
            pdf,
          });
          await db
            .update(invoicesTable)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(eq(invoicesTable.id, inv.id));
          result.emailed++;
        } catch (err) {
          // La factura ya está emitida; el envío puede reintentarse a mano.
          logger.error(
            { err, invoice: inv.fullNumber },
            "No se pudo enviar por email la factura emitida automáticamente",
          );
        }
      }
    } catch (err) {
      result.skipped++;
      logger.error(
        { err, installationId: inst.id, period: charge.period },
        "No se pudo emitir automáticamente la factura del cargo",
      );
    }
  }
  return result;
}

export function startAutoInvoicer(): void {
  const run = () =>
    runAutoInvoicing().catch((err: Error) =>
      logger.error({ err: err.message }, "Facturación automática falló"),
    );
  void run();
  const timer = setInterval(run, AUTO_INVOICE_INTERVAL_MS);
  timer.unref();
}
