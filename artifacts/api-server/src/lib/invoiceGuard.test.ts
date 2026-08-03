import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  installationsTable,
  billingChargesTable,
  invoicesTable,
  type Invoice,
} from "@workspace/db";
import { ensureInvoiceGuards } from "./invoiceGuard";

/** Comprueba que el error (o su causa, drizzle envuelve los errores de pg) coincide. */
function pgError(pattern: RegExp) {
  return (err: unknown): boolean => {
    const msgs = [
      err instanceof Error ? err.message : String(err),
      err instanceof Error && err.cause instanceof Error ? err.cause.message : "",
    ];
    assert.ok(
      msgs.some((m) => pattern.test(m)),
      `esperaba ${pattern}, recibido: ${msgs.join(" | ")}`,
    );
    return true;
  };
}

// Protección a nivel de base de datos de las facturas emitidas: los campos
// fiscales no pueden modificarse ni la fila borrarse (triggers), y solo se
// permiten los cambios de estado (sent/paid) con sus fechas.

const suffix = randomUUID();
let installationId: number;
let chargeId: number;
let invoice: Invoice;

before(async () => {
  await ensureInvoiceGuards();
  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop guard ${suffix}`,
      contactName: "Test",
      contactEmail: `guard-${suffix}@test.local`,
      subdomain: `guard-${suffix}`,
      publicToken: `pub-${suffix}`,
      apiToken: `api-${suffix}`,
      termsAcceptedAt: new Date(),
    })
    .returning();
  installationId = inst.id;
  const [charge] = await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period: "2099-01",
      baseCents: 10000,
      farmCount: 4,
      variableCents: 1000,
      totalCents: 11000,
      status: "invoiced",
    })
    .returning();
  chargeId = charge.id;
  const [inv] = await db
    .insert(invoicesTable)
    .values({
      installationId,
      chargeId,
      series: "TST",
      year: 2099,
      number: 1,
      fullNumber: `TST-2099-${suffix.slice(0, 8)}`,
      issueDate: new Date(),
      period: "2099-01",
      issuerName: "Emisor SL",
      issuerTaxId: "B00000000",
      issuerAddress: "Calle Uno 1",
      customerName: "Cliente SL",
      customerTaxId: "B11111111",
      customerAddress: "Calle Dos 2",
      baseCents: 10000,
      farmCount: 4,
      variableCents: 1000,
      subtotalCents: 11000,
      taxRateBps: 700,
      taxName: "IGIC",
      taxCents: 770,
      totalCents: 11770,
      prevHash: null,
      hash: "ABC123",
    })
    .returning();
  invoice = inv;
});

after(async () => {
  // Limpieza: desactivar el trigger requiere DDL explícito de propietario
  // (ALTER TABLE), nunca una simple variable de sesión.
  await db.transaction(async (tx) => {
    await tx.execute(`ALTER TABLE invoices DISABLE TRIGGER invoices_protect_delete`);
    await tx.delete(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    await tx.execute(`ALTER TABLE invoices ENABLE TRIGGER invoices_protect_delete`);
  });
  await db.delete(billingChargesTable).where(eq(billingChargesTable.id, chargeId));
  await db.delete(installationsTable).where(eq(installationsTable.id, installationId));
  await pool.end();
});

test("rechaza modificar un campo fiscal (importe total)", async () => {
  await assert.rejects(
    db
      .update(invoicesTable)
      .set({ totalCents: 1, updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoice.id)),
    pgError(/campos fiscales son inmutables/),
  );
});

test("rechaza modificar la huella encadenada", async () => {
  await assert.rejects(
    db
      .update(invoicesTable)
      .set({ hash: "MANIPULADA" })
      .where(eq(invoicesTable.id, invoice.id)),
    pgError(/campos fiscales son inmutables/),
  );
});

test("rechaza cambiar la numeración o los datos del cliente", async () => {
  await assert.rejects(
    db
      .update(invoicesTable)
      .set({ number: 999, fullNumber: "TST-2099-9999" })
      .where(eq(invoicesTable.id, invoice.id)),
    pgError(/campos fiscales son inmutables/),
  );
  await assert.rejects(
    db
      .update(invoicesTable)
      .set({ customerName: "Otro" })
      .where(eq(invoicesTable.id, invoice.id)),
    pgError(/campos fiscales son inmutables/),
  );
});

test("permite los cambios de estado enviada y pagada", async () => {
  const [sent] = await db
    .update(invoicesTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();
  assert.equal(sent.status, "sent");
  const [paid] = await db
    .update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();
  assert.equal(paid.status, "paid");
  assert.equal(paid.totalCents, 11770);
});

test("rechaza un estado fuera de issued/sent/paid", async () => {
  await assert.rejects(
    db
      .update(invoicesTable)
      .set({ status: "cancelled" })
      .where(eq(invoicesTable.id, invoice.id)),
    pgError(/estado no permitido/),
  );
});

test("rechaza el borrado directo de la factura", async () => {
  await assert.rejects(
    db.delete(invoicesTable).where(eq(invoicesTable.id, invoice.id)),
    pgError(/no puede borrarse/),
  );
  const [still] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoice.id));
  assert.ok(still);
});

test("rechaza vaciar la tabla con TRUNCATE", async () => {
  await assert.rejects(
    db.execute(`TRUNCATE invoices CASCADE`),
    pgError(/TRUNCATE bloqueado/),
  );
  const [still] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoice.id));
  assert.ok(still);
});

test("una sesión no puede saltarse la protección con variables de sesión", async () => {
  // Ninguna variable de sesión/transacción desactiva la protección: el
  // trigger no consulta configuración alguna.
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute(`SET LOCAL app.allow_invoice_purge = 'on'`);
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    }),
    pgError(/no puede borrarse/),
  );
  await db.execute(`SET app.allow_invoice_purge = 'on'`);
  await assert.rejects(
    db.delete(invoicesTable).where(eq(invoicesTable.id, invoice.id)),
    pgError(/no puede borrarse/),
  );
  await db.execute(`RESET app.allow_invoice_purge`);
  const [still] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoice.id));
  assert.ok(still);
});
