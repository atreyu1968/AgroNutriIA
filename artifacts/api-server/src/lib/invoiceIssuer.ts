import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  billingChargesTable,
  invoicesTable,
  type BillingCharge,
  type Installation,
  type Invoice,
} from "@workspace/db";
import {
  invoiceHash,
  INVOICE_ISSUE_LOCK_KEY,
  type BillingSettings,
} from "./invoiceGen";

/**
 * Emisión de una factura a partir de un cargo mensual. Lógica compartida por
 * la emisión manual (panel de administración) y la emisión automática.
 *
 * La numeración correlativa y el encadenado de huellas se serializan con un
 * advisory lock dentro de la misma transacción, para que dos emisiones
 * concurrentes no dupliquen números ni bifurquen la cadena.
 */
export async function issueInvoiceForCharge(opts: {
  inst: Installation;
  charge: BillingCharge;
  settings: BillingSettings;
  issueDate?: Date;
}): Promise<Invoice> {
  const { inst, charge, settings } = opts;
  if (!settings.configured || !settings.issuerName || !settings.issuerTaxId) {
    throw new Error("Faltan los datos del emisor (nombre y NIF)");
  }
  if (!inst.taxId) {
    throw new Error("La instalación no tiene NIF");
  }
  const issueDate = opts.issueDate ?? new Date();
  const year = issueDate.getFullYear();
  const subtotalCents = charge.totalCents;
  const taxCents = Math.round((subtotalCents * settings.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INVOICE_ISSUE_LOCK_KEY})`);
    // Idempotencia dentro del lock: si otro proceso acaba de facturar este
    // cargo, se devuelve la factura existente en vez de duplicarla.
    const [existing] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.chargeId, charge.id));
    if (existing) return existing;

    const [maxRow] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.series, settings.series), eq(invoicesTable.year, year)))
      .orderBy(desc(invoicesTable.number))
      .limit(1);
    const number = (maxRow?.number ?? 0) + 1;
    const fullNumber = `${settings.series}-${year}-${String(number).padStart(4, "0")}`;
    const [lastInv] = await tx
      .select()
      .from(invoicesTable)
      .orderBy(desc(invoicesTable.id))
      .limit(1);
    const prevHash = lastInv?.hash ?? null;
    const record = {
      prevHash,
      fullNumber,
      issueDate,
      period: charge.period,
      issuerName: settings.issuerName!,
      issuerTaxId: settings.issuerTaxId!,
      issuerAddress: settings.issuerAddress ?? "",
      customerName: inst.name,
      customerTaxId: inst.taxId!,
      customerAddress: inst.billingAddress,
      baseCents: charge.baseCents,
      farmCount: charge.farmCount,
      variableCents: charge.variableCents,
      subtotalCents,
      taxRateBps: settings.taxRateBps,
      taxName: settings.taxName,
      taxCents,
      totalCents,
    };
    const hash = invoiceHash(record);
    const [created] = await tx
      .insert(invoicesTable)
      .values({
        installationId: inst.id,
        chargeId: charge.id,
        series: settings.series,
        year,
        number,
        ...record,
        hash,
      })
      .returning();
    await tx
      .update(billingChargesTable)
      .set({ status: "invoiced", updatedAt: new Date() })
      .where(eq(billingChargesTable.id, charge.id));
    return created;
  });
}
