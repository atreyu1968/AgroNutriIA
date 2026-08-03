import { and, eq, isNull, lt, ne, notInArray } from "drizzle-orm";
import { db, pool, billingChargesTable, installationsTable } from "@workspace/db";
import {
  getPaypalConfig,
  reviseSubscriptionPrice,
  centsToEur,
  BASE_PRICE_CENTS,
  type PaypalConfig,
} from "./paypal";
import { currentPeriod, upsertMonthlyCharge } from "./provisioner";
import { logger } from "./logger";

/**
 * Cobro mensual del componente variable (2,50 €/finca activa).
 *
 * La suscripción de PayPal cobra la cuota base de forma recurrente. Cuando un
 * mes se cierra, este proceso recoge su cargo de billing_charges y revisa el
 * precio de la suscripción para que la PRÓXIMA cuota cobre base + variable del
 * mes cerrado. Cuando llega el pago del siguiente ciclo (webhook
 * PAYMENT.SALE.COMPLETED), esos cargos pasan a "paid".
 *
 * El estado de COBRO por PayPal se correlaciona con `invoicedAt` (fecha de la
 * revisión de la suscripción) y `paypalSaleId` (cobro que lo liquidó), y es
 * independiente de la EMISIÓN de factura del panel de administración, que
 * también usa status="invoiced" pero sin tocar PayPal (invoicedAt queda NULL):
 * esos cargos siguen siendo elegibles para el cobro por PayPal, y un cobro de
 * PayPal nunca liquida cargos sin revisión previa. Un cargo ya "paid" (p. ej.
 * cobrado a mano y marcado desde su factura) nunca se vuelve a cobrar.
 */

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // cada 6 horas (idempotente)

export type ReviseFn = (
  cfg: PaypalConfig,
  subscriptionId: string,
  totalEur: string,
) => Promise<void>;

/**
 * Asegura que cada instalación activa tiene su cargo del mes en curso (aunque
 * no haya reportado uso este mes se factura con el último recuento conocido).
 */
export async function rollForwardCharges(now = new Date()): Promise<number> {
  const period = currentPeriod(now);
  const withCharge = db
    .select({ installationId: billingChargesTable.installationId })
    .from(billingChargesTable)
    .where(eq(billingChargesTable.period, period));
  const missing = await db
    .select({ id: installationsTable.id })
    .from(installationsTable)
    .where(and(eq(installationsTable.status, "active"), notInArray(installationsTable.id, withCharge)));
  for (const { id } of missing) {
    await upsertMonthlyCharge(id, now);
  }
  return missing.length;
}

/**
 * Toma los cargos de meses cerrados aún no cobrados (sin revisión de PayPal,
 * `invoicedAt` NULL, y no pagados por otra vía) y los cobra ajustando el
 * precio de la suscripción (la próxima cuota incluye el variable). Si una
 * instalación acumula varios meses pendientes se suman en una sola revisión.
 * Devuelve cuántos cargos han quedado incluidos en la próxima cuota.
 */
export async function settleClosedCharges(
  opts: { now?: Date; revise?: ReviseFn } = {},
): Promise<number> {
  const period = currentPeriod(opts.now ?? new Date());
  const rows = await db
    .select({ charge: billingChargesTable, inst: installationsTable })
    .from(billingChargesTable)
    .innerJoin(installationsTable, eq(billingChargesTable.installationId, installationsTable.id))
    .where(
      and(
        lt(billingChargesTable.period, period),
        isNull(billingChargesTable.invoicedAt),
        ne(billingChargesTable.status, "paid"),
      ),
    );
  // Solo instalaciones activas: en suspendidas/canceladas la revisión de la
  // suscripción no cobraría (o no existe); el cargo queda pendiente.
  const billable = rows.filter(
    ({ inst }) => inst.paypalSubscriptionId && inst.status === "active",
  );
  if (billable.length === 0) return 0;

  const cfg = await getPaypalConfig();
  const revise = opts.revise ?? reviseSubscriptionPrice;
  if (!opts.revise && !(cfg.clientId && cfg.clientSecret)) {
    logger.warn(
      { pendingCharges: billable.length },
      "Hay cargos variables pendientes pero PayPal no está configurado; se reintentará",
    );
    return 0;
  }

  // Agrupa por instalación: una única revisión con la suma de variables.
  const byInstallation = new Map<number, { subscriptionId: string; charges: typeof billable }>();
  for (const row of billable) {
    const entry = byInstallation.get(row.inst.id);
    if (entry) entry.charges.push(row);
    else {
      byInstallation.set(row.inst.id, {
        subscriptionId: row.inst.paypalSubscriptionId!,
        charges: [row],
      });
    }
  }

  let invoiced = 0;
  for (const [installationId, { subscriptionId, charges }] of byInstallation) {
    const variableCents = charges.reduce((s, { charge }) => s + charge.variableCents, 0);
    const nextCycleCents = BASE_PRICE_CENTS + variableCents;
    try {
      await revise(cfg, subscriptionId, centsToEur(nextCycleCents));
      for (const { charge } of charges) {
        const updated = await db
          .update(billingChargesTable)
          .set({ status: "invoiced", invoicedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(billingChargesTable.id, charge.id),
              isNull(billingChargesTable.invoicedAt),
              ne(billingChargesTable.status, "paid"),
            ),
          )
          .returning({ id: billingChargesTable.id });
        invoiced += updated.length;
      }
      logger.info(
        { installationId, periods: charges.map(({ charge }) => charge.period), nextCycleCents },
        "Cargo variable añadido a la próxima cuota de PayPal",
      );
    } catch (err) {
      logger.error(
        { err, installationId },
        "No se pudo revisar la suscripción de PayPal para cobrar el variable; se reintentará",
      );
    }
  }
  return invoiced;
}

/**
 * Marca como pagados los cargos ya incluidos en la cuota ("invoiced") de una
 * instalación cuando PayPal confirma el cobro del ciclo (PAYMENT.SALE.COMPLETED).
 *
 * Salvaguardas frente a webhooks retrasados, repetidos o desordenados:
 * - Solo liquida cargos cuya revisión (invoicedAt) es ANTERIOR al momento del
 *   pago: un cobro de un ciclo previo (solo base) no puede liquidar un cargo
 *   revisado después. Los cargos con factura emitida a mano (invoicedAt NULL)
 *   nunca se liquidan por un cobro de PayPal.
 * - Guarda el id del cobro (sale) de PayPal; un evento repetido con el mismo
 *   id no tiene efecto (idempotente).
 */
export async function markInvoicedChargesPaid(
  installationId: number,
  opts: { saleId?: string | null; paidAt?: Date | null } = {},
): Promise<number> {
  const paidAt = opts.paidAt ?? new Date();
  const saleId = opts.saleId ?? null;
  if (saleId) {
    const [already] = await db
      .select({ id: billingChargesTable.id })
      .from(billingChargesTable)
      .where(
        and(
          eq(billingChargesTable.installationId, installationId),
          eq(billingChargesTable.paypalSaleId, saleId),
        ),
      );
    if (already) return 0; // entrega duplicada del webhook
  }
  const updated = await db
    .update(billingChargesTable)
    .set({ status: "paid", paypalSaleId: saleId, updatedAt: new Date() })
    .where(
      and(
        eq(billingChargesTable.installationId, installationId),
        eq(billingChargesTable.status, "invoiced"),
        lt(billingChargesTable.invoicedAt, paidAt),
      ),
    )
    .returning({ id: billingChargesTable.id });
  if (updated.length > 0) {
    logger.info({ installationId, charges: updated.length }, "Cargos variables cobrados vía PayPal");
  }
  return updated.length;
}

/**
 * Migración mínima e idempotente: en bases de datos creadas antes de esta
 * funcionalidad añade las columnas de correlación de cobro. El esquema se
 * gestiona con drizzle push en desarrollo; en producción esto garantiza que
 * las columnas existen antes de que el proceso (o el panel de administración)
 * consulte billing_charges.
 */
export async function ensureBillingSchema(): Promise<void> {
  await pool.query(
    `ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS invoiced_at timestamptz`,
  );
  await pool.query(
    `ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS paypal_sale_id text`,
  );
}

export async function runBillingSweep(now = new Date()): Promise<void> {
  await rollForwardCharges(now);
  await settleClosedCharges({ now });
}

export function startBillingSweeper(): void {
  const run = () =>
    runBillingSweep().catch((err: Error) =>
      logger.error({ err: err.message }, "El proceso de facturación mensual falló"),
    );
  void ensureBillingSchema()
    .catch((err: Error) =>
      logger.error({ err: err.message }, "No se pudo asegurar el esquema de facturación"),
    )
    .then(run);
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
}
