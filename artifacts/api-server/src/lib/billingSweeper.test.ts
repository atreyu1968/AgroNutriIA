import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, installationsTable, billingChargesTable } from "@workspace/db";
import {
  rollForwardCharges,
  settleClosedCharges,
  markInvoicedChargesPaid,
  ensureBillingSchema,
} from "./billingSweeper";
import { currentPeriod, upsertMonthlyCharge } from "./provisioner";
import { centsToEur } from "./paypal";

// Cobro mensual del variable por fincas activas: el proceso toma los cargos
// "pending" de meses cerrados, revisa el precio de la suscripción de PayPal
// (aquí con una función inyectada, sin red) y los marca "invoiced"; el webhook
// de pago los pasa a "paid".

const suffix = randomUUID().slice(0, 8);
const createdIds: number[] = [];

after(async () => {
  if (createdIds.length) {
    await db.delete(installationsTable).where(inArray(installationsTable.id, createdIds));
  }
  await pool.end();
});

async function createInstallation(
  overrides: Partial<typeof installationsTable.$inferInsert> = {},
) {
  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop Sweep ${suffix}`,
      contactName: "Persona Prueba",
      contactEmail: `sweep-${suffix}@example.com`,
      subdomain: `sweep-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      publicToken: randomBytes(20).toString("base64url"),
      apiToken: randomBytes(24).toString("base64url"),
      paypalSubscriptionId: `I-SWEEP${suffix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      termsAcceptedAt: new Date(),
      status: "active",
      ...overrides,
    })
    .returning();
  createdIds.push(inst.id);
  return inst;
}

async function insertCharge(
  installationId: number,
  period: string,
  farmCount: number,
  status = "pending",
  invoicedAt: Date | null = null,
) {
  const variableCents = farmCount * 250;
  const [row] = await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period,
      baseCents: 10000,
      farmCount,
      variableCents,
      totalCents: 10000 + variableCents,
      status,
      invoicedAt,
    })
    .returning();
  return row;
}

async function charges(installationId: number) {
  return db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.installationId, installationId));
}

test("ensureBillingSchema es idempotente y deja las columnas de cobro", async () => {
  await ensureBillingSchema();
  await ensureBillingSchema(); // segunda pasada sin error
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'billing_charges' AND column_name IN ('invoiced_at', 'paypal_sale_id')`,
  );
  assert.equal(rows.length, 2);
});

test("centsToEur formatea el importe para PayPal", () => {
  assert.equal(centsToEur(10000), "100.00");
  assert.equal(centsToEur(10250), "102.50");
});

test("settleClosedCharges cobra el mes cerrado revisando la suscripción", async () => {
  const inst = await createInstallation({ activeFarmCount: 8 });
  await insertCharge(inst.id, "2026-07", 8); // mes cerrado, 8 fincas → 20 €
  await insertCharge(inst.id, "2026-08", 8); // mes en curso: no se toca

  const revisions: { subscriptionId: string; totalEur: string }[] = [];
  const now = new Date(Date.UTC(2026, 7, 3)); // agosto de 2026
  const n = await settleClosedCharges({
    now,
    revise: async (_cfg, subscriptionId, totalEur) => {
      revisions.push({ subscriptionId, totalEur });
    },
  });
  assert.equal(n, 1);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].subscriptionId, inst.paypalSubscriptionId);
  // Próxima cuota: 100 € base + 8 × 2,50 € = 120 €.
  assert.equal(revisions[0].totalEur, "120.00");

  const rows = await charges(inst.id);
  assert.equal(rows.find((c) => c.period === "2026-07")?.status, "invoiced");
  assert.equal(rows.find((c) => c.period === "2026-08")?.status, "pending");

  // Idempotente: una segunda pasada no vuelve a cobrar.
  const again = await settleClosedCharges({
    now,
    revise: async () => {
      assert.fail("no debería revisarse de nuevo");
    },
  });
  assert.equal(again, 0);
});

test("varios meses pendientes se suman en una sola revisión", async () => {
  const inst = await createInstallation({ activeFarmCount: 4 });
  await insertCharge(inst.id, "2026-06", 2); // 5 €
  await insertCharge(inst.id, "2026-07", 4); // 10 €

  const revisions: string[] = [];
  const n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async (_cfg, _id, totalEur) => {
      revisions.push(totalEur);
    },
  });
  assert.equal(n, 2);
  assert.deepEqual(revisions, ["115.00"]); // 100 + 5 + 10
  const rows = await charges(inst.id);
  assert.ok(rows.every((c) => c.status === "invoiced"));
});

test("si la revisión falla, el cargo sigue pendiente para reintentar", async () => {
  const inst = await createInstallation();
  await insertCharge(inst.id, "2026-07", 3);
  const n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async () => {
      throw new Error("PayPal caído");
    },
  });
  assert.equal(n, 0);
  const rows = await charges(inst.id);
  assert.equal(rows[0].status, "pending");
  // Limpieza: que este cargo pendiente no interfiera en los tests siguientes.
  await db.delete(billingChargesTable).where(eq(billingChargesTable.installationId, inst.id));
});

test("solo se cobran instalaciones activas con suscripción", async () => {
  const cancelled = await createInstallation({ status: "cancelled" });
  const suspended = await createInstallation({ status: "suspended" });
  const noSub = await createInstallation({ paypalSubscriptionId: null });
  await insertCharge(cancelled.id, "2026-07", 5);
  await insertCharge(suspended.id, "2026-07", 5);
  await insertCharge(noSub.id, "2026-07", 5);
  const n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async () => {
      assert.fail("no debería revisarse ninguna suscripción");
    },
  });
  assert.equal(n, 0);
  // Limpieza para no interferir con otros tests del fichero.
  for (const id of [cancelled.id, suspended.id, noSub.id]) {
    await db.delete(billingChargesTable).where(eq(billingChargesTable.installationId, id));
  }
});

test("markInvoicedChargesPaid liquida solo cargos revisados antes del pago", async () => {
  const inst = await createInstallation();
  const invoicedAt = new Date("2026-08-01T10:00:00Z");
  await insertCharge(inst.id, "2026-06", 2, "invoiced", invoicedAt);
  await insertCharge(inst.id, "2026-07", 2, "pending");

  // Evento de un ciclo ANTERIOR a la revisión (retrasado/desordenado): no liquida.
  let n = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-OLD",
    paidAt: new Date("2026-07-15T00:00:00Z"),
  });
  assert.equal(n, 0);

  // Pago posterior a la revisión: liquida el cargo 'invoiced', no el 'pending'.
  n = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-NEW",
    paidAt: new Date("2026-09-01T10:00:00Z"),
  });
  assert.equal(n, 1);
  const rows = await charges(inst.id);
  const paid = rows.find((c) => c.period === "2026-06");
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paypalSaleId, "SALE-NEW");
  assert.equal(rows.find((c) => c.period === "2026-07")?.status, "pending");

  // Entrega repetida del mismo evento: idempotente.
  n = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-NEW",
    paidAt: new Date("2026-09-01T10:00:00Z"),
  });
  assert.equal(n, 0);
  // Limpieza: el cargo 2026-07 sigue "pending" y afectaría a otros tests.
  await db.delete(billingChargesTable).where(eq(billingChargesTable.installationId, inst.id));
});

test("un reporte de uso tardío no modifica un cargo ya 'invoiced' ni 'paid'", async () => {
  const inst = await createInstallation({ activeFarmCount: 8 });
  const julio = new Date(Date.UTC(2026, 6, 15));
  await upsertMonthlyCharge(inst.id, julio); // 8 fincas → 120 €

  // El proceso mensual lo incluye en la próxima cuota (invoiced).
  const n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async () => {},
  });
  assert.equal(n, 1);

  // Reporte de uso tardío para julio con otro recuento: no debe tocar el cargo.
  await db
    .update(installationsTable)
    .set({ activeFarmCount: 20 })
    .where(eq(installationsTable.id, inst.id));
  await upsertMonthlyCharge(inst.id, julio);

  let rows = await charges(inst.id);
  let charge = rows.find((c) => c.period === "2026-07");
  assert.equal(charge?.status, "invoiced");
  assert.equal(charge?.farmCount, 8);
  assert.equal(charge?.totalCents, 10000 + 8 * 250);

  // Tampoco tras el pago; y la liquidación sigue siendo coherente.
  const paid = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-LATE",
    paidAt: new Date(Date.UTC(2026, 8, 1)),
  });
  assert.equal(paid, 1);
  await upsertMonthlyCharge(inst.id, julio);
  rows = await charges(inst.id);
  charge = rows.find((c) => c.period === "2026-07");
  assert.equal(charge?.status, "paid");
  assert.equal(charge?.totalCents, 10000 + 8 * 250);
});

test("una factura emitida a mano no bloquea ni liquida el cobro por PayPal", async () => {
  const inst = await createInstallation({ activeFarmCount: 4 });
  // El administrador emite la factura del mes en curso (julio) antes del
  // barrido: status pasa a 'invoiced' pero SIN revisión de PayPal (invoicedAt NULL).
  await insertCharge(inst.id, "2026-07", 4, "invoiced", null);

  // Llega un cobro de PayPal de solo la base: no debe liquidar ese cargo.
  let n = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-BASE-ONLY",
    paidAt: new Date(Date.UTC(2026, 6, 20)),
  });
  assert.equal(n, 0);
  let rows = await charges(inst.id);
  assert.equal(rows[0].status, "invoiced");
  assert.equal(rows[0].invoicedAt, null);

  // Al cerrar julio, el barrido sí lo incluye en la próxima cuota de PayPal.
  const revisions: string[] = [];
  n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async (_cfg, _id, totalEur) => {
      revisions.push(totalEur);
    },
  });
  assert.equal(n, 1);
  assert.deepEqual(revisions, ["110.00"]); // 100 + 4 × 2,50
  rows = await charges(inst.id);
  assert.ok(rows[0].invoicedAt, "debe registrarse la revisión de PayPal");

  // Y solo un cobro posterior a la revisión lo liquida.
  n = await markInvoicedChargesPaid(inst.id, {
    saleId: "SALE-CYCLE",
    paidAt: new Date(Date.UTC(2026, 8, 1)),
  });
  assert.equal(n, 1);
  assert.equal((await charges(inst.id))[0].status, "paid");
});

test("un cargo cobrado por otra vía (paid) no se vuelve a cobrar por PayPal", async () => {
  const inst = await createInstallation();
  await insertCharge(inst.id, "2026-07", 5, "paid");
  const n = await settleClosedCharges({
    now: new Date(Date.UTC(2026, 7, 3)),
    revise: async () => {
      assert.fail("un cargo pagado no debe revisarse");
    },
  });
  assert.equal(n, 0);
});

test("rollForwardCharges crea el cargo del mes en curso si falta", async () => {
  const inst = await createInstallation({ activeFarmCount: 6 });
  const now = new Date();
  const created = await rollForwardCharges(now);
  assert.ok(created >= 1);
  const rows = await charges(inst.id);
  const current = rows.find((c) => c.period === currentPeriod(now));
  assert.ok(current, "debe existir el cargo del mes en curso");
  assert.equal(current!.totalCents, 10000 + 6 * 250);
  assert.equal(current!.status, "pending");

  // Segunda pasada: no duplica ni modifica.
  await rollForwardCharges(now);
  assert.equal((await charges(inst.id)).length, rows.length);
});
