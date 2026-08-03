import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { inArray } from "drizzle-orm";
import { db, appSettingsTable, type Invoice } from "@workspace/db";

/**
 * Facturación de instalaciones: configuración del emisor, numeración,
 * encadenado de huellas (preparado para VeriFactu) y generación del PDF.
 */

export const SETTING_BILLING_ISSUER_NAME = "billing_issuer_name";
export const SETTING_BILLING_ISSUER_TAX_ID = "billing_issuer_tax_id";
export const SETTING_BILLING_ISSUER_ADDRESS = "billing_issuer_address";
export const SETTING_BILLING_SERIES = "billing_series";
export const SETTING_BILLING_TAX_RATE_BPS = "billing_tax_rate_bps";
export const SETTING_BILLING_TAX_NAME = "billing_tax_name";

export const BILLING_SETTING_KEYS = [
  SETTING_BILLING_ISSUER_NAME,
  SETTING_BILLING_ISSUER_TAX_ID,
  SETTING_BILLING_ISSUER_ADDRESS,
  SETTING_BILLING_SERIES,
  SETTING_BILLING_TAX_RATE_BPS,
  SETTING_BILLING_TAX_NAME,
];

export type BillingSettings = {
  issuerName: string | null;
  issuerTaxId: string | null;
  issuerAddress: string | null;
  series: string;
  taxRateBps: number;
  taxName: string;
  configured: boolean;
};

export async function getBillingSettings(): Promise<BillingSettings> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, BILLING_SETTING_KEYS));
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const issuerName = get(SETTING_BILLING_ISSUER_NAME);
  const issuerTaxId = get(SETTING_BILLING_ISSUER_TAX_ID);
  const rateRaw = get(SETTING_BILLING_TAX_RATE_BPS);
  const rate = rateRaw != null && /^\d+$/.test(rateRaw) ? Number(rateRaw) : 700;
  return {
    issuerName,
    issuerTaxId,
    issuerAddress: get(SETTING_BILLING_ISSUER_ADDRESS),
    series: get(SETTING_BILLING_SERIES) ?? "AGN",
    taxRateBps: rate,
    taxName: get(SETTING_BILLING_TAX_NAME) ?? "IGIC",
    configured: Boolean(issuerName && issuerTaxId),
  };
}

/**
 * Huella SHA-256 del registro de facturación completo, encadenada con la
 * anterior, siguiendo el espíritu del registro de facturación VeriFactu.
 * Cubre todos los datos fiscales para que cualquier alteración posterior
 * invalide la huella registrada.
 */
export function invoiceHash(rec: {
  prevHash: string | null;
  fullNumber: string;
  issueDate: Date;
  period: string;
  issuerName: string;
  issuerTaxId: string;
  issuerAddress: string;
  customerName: string;
  customerTaxId: string;
  customerAddress: string | null;
  baseCents: number;
  farmCount: number;
  variableCents: number;
  subtotalCents: number;
  taxRateBps: number;
  taxName: string;
  taxCents: number;
  totalCents: number;
}): string {
  const payload = [
    rec.prevHash ?? "",
    rec.fullNumber,
    rec.issueDate.toISOString().slice(0, 10),
    rec.period,
    rec.issuerName,
    rec.issuerTaxId,
    rec.issuerAddress,
    rec.customerName,
    rec.customerTaxId,
    rec.customerAddress ?? "",
    rec.baseCents,
    rec.farmCount,
    rec.variableCents,
    rec.subtotalCents,
    rec.taxRateBps,
    rec.taxName,
    rec.taxCents,
    rec.totalCents,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").toUpperCase();
}

/** Clave del advisory lock que serializa la emisión de facturas. */
export const INVOICE_ISSUE_LOCK_KEY = 784_213_901;

export function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const GREEN = "#166534";
const GRAY = "#555555";

/** Genera el PDF de la factura y lo devuelve como Buffer. */
export async function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Cabecera
    doc.fontSize(20).fillColor(GREEN).font("Helvetica-Bold").text("FACTURA");
    doc
      .fontSize(10)
      .fillColor("#000000")
      .font("Helvetica")
      .text(`Número: ${inv.fullNumber}`)
      .text(`Fecha de emisión: ${inv.issueDate.toLocaleDateString("es-ES")}`)
      .text(`Periodo facturado: ${inv.period}`);
    doc.moveDown(1.5);

    // Emisor y cliente
    const y0 = doc.y;
    doc.font("Helvetica-Bold").text("Emisor", 50, y0);
    doc
      .font("Helvetica")
      .text(inv.issuerName)
      .text(`NIF: ${inv.issuerTaxId}`)
      .text(inv.issuerAddress, { width: 220 });
    doc.font("Helvetica-Bold").text("Cliente", 320, y0);
    doc
      .font("Helvetica")
      .text(inv.customerName, 320)
      .text(`NIF: ${inv.customerTaxId}`, 320);
    if (inv.customerAddress) doc.text(inv.customerAddress, 320, doc.y, { width: 220 });
    doc.moveDown(2);
    doc.x = 50;

    // Líneas
    const tableTop = Math.max(doc.y, 260);
    const col = { desc: 50, qty: 330, price: 390, total: 470 };
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Concepto", col.desc, tableTop);
    doc.text("Cant.", col.qty, tableTop, { width: 50, align: "right" });
    doc.text("Precio", col.price, tableTop, { width: 70, align: "right" });
    doc.text("Importe", col.total, tableTop, { width: 75, align: "right" });
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(545, tableTop + 14)
      .strokeColor(GREEN)
      .stroke();

    let y = tableTop + 22;
    doc.font("Helvetica").fontSize(10).fillColor("#000000");
    const line = (desc: string, qty: string, price: string, total: string) => {
      doc.text(desc, col.desc, y, { width: 270 });
      doc.text(qty, col.qty, y, { width: 50, align: "right" });
      doc.text(price, col.price, y, { width: 70, align: "right" });
      doc.text(total, col.total, y, { width: 75, align: "right" });
      y += 18;
    };
    line(
      `Cuota base — instalación y mantenimiento (${inv.period})`,
      "1",
      formatEuros(inv.baseCents),
      formatEuros(inv.baseCents),
    );
    if (inv.farmCount > 0) {
      const unit = inv.farmCount > 0 ? Math.round(inv.variableCents / inv.farmCount) : 0;
      line(
        `Cuota variable — fincas activas (${inv.period})`,
        String(inv.farmCount),
        formatEuros(unit),
        formatEuros(inv.variableCents),
      );
    }

    // Totales
    y += 10;
    doc.moveTo(330, y).lineTo(545, y).strokeColor("#cccccc").stroke();
    y += 8;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(label, 330, y, { width: 130, align: "right" });
      doc.text(value, col.total, y, { width: 75, align: "right" });
      y += 16;
    };
    totalRow("Base imponible", `${formatEuros(inv.subtotalCents)} €`);
    totalRow(
      `${inv.taxName} (${(inv.taxRateBps / 100).toLocaleString("es-ES")} %)`,
      `${formatEuros(inv.taxCents)} €`,
    );
    totalRow("TOTAL", `${formatEuros(inv.totalCents)} €`, true);

    // Pie con huella (VeriFactu-ready). Nota: poner margins.bottom a 0 antes
    // de escribir en el margen inferior, o pdfkit añade páginas en blanco.
    doc.page.margins.bottom = 0;
    doc
      .fontSize(7)
      .fillColor(GRAY)
      .font("Helvetica")
      .text(
        `Registro de facturación con huella encadenada SHA-256: ${inv.hash}`,
        50,
        doc.page.height - 40,
        { width: 495, align: "center" },
      );
    doc.end();
  });
}
