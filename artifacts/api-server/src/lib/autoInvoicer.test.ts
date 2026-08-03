import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  installationsTable,
  billingChargesTable,
  invoicesTable,
  appSettingsTable,
} from "@workspace/db";
import { runAutoInvoicing } from "./autoInvoicer";
import { currentPeriod } from "./provisioner";
import {
  invoiceHash,
  SETTING_BILLING_ISSUER_NAME,
  SETTING_BILLING_ISSUER_TAX_ID,
} from "./invoiceGen";
import { setEmailSetting } from "./email";

// Facturación automática de cargos mensuales: al cerrarse el mes, los cargos
// "pending" de periodos anteriores se facturan solos (numeración correlativa
// y huella encadenada reutilizadas), saltándose instalaciones sin NIF y sin
// duplicar facturas en ejecuciones repetidas. Este fichero es el único que
// toca las claves billing_* de app_settings (se ejecuta en su propio proceso,
// pero los ficheros corren en paralelo sobre la misma BD).

const suffix = randomUUID().slice(0, 8);
const createdIds: number[] = [];
const PAST_PERIOD = "2020-01";

async function createInstallation(overrides: Partial<typeof installationsTable.$inferInsert> = {}) {
  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop AutoInv ${suffix}`,
      contactName: "Persona Prueba",
      contactEmail: `autoinv-${suffix}@example.com`,
      subdomain: `autoinv-${suffix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40),
      publicToken: randomBytes(20).toString("base64url"),
      apiToken: randomBytes(24).toString("base64url"),
      status: "active",
      termsAcceptedAt: new Date(),
      ...overrides,
    })
    .returning();
  createdIds.push(inst.id);
  return inst;
}

async function createCharge(installationId: number, period: string, farmCount = 4) {
  const variableCents = farmCount * 250;
  const [charge] = await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period,
      baseCents: 10000,
      farmCount,
      variableCents,
      totalCents: 10000 + variableCents,
    })
    .returning();
  return charge;
}

before(async () => {
  await setEmailSetting(SETTING_BILLING_ISSUER_NAME, `Emisor Test ${suffix}`);
  await setEmailSetting(SETTING_BILLING_ISSUER_TAX_ID, "B12345678");
});

after(async () => {
  await db
    .delete(appSettingsTable)
    .where(
      inArray(appSettingsTable.key, [SETTING_BILLING_ISSUER_NAME, SETTING_BILLING_ISSUER_TAX_ID]),
    );
  if (createdIds.length) {
    // Las facturas referencian instalaciones con onDelete: restrict. Las
    // emitidas están protegidas por trigger: se desactiva solo para limpiar.
    await db.transaction(async (tx) => {
      await tx.execute(`ALTER TABLE invoices DISABLE TRIGGER invoices_protect_delete`);
      await tx.delete(invoicesTable).where(inArray(invoicesTable.installationId, createdIds));
      await tx.execute(`ALTER TABLE invoices ENABLE TRIGGER invoices_protect_delete`);
    });
    await db.delete(installationsTable).where(inArray(installationsTable.id, createdIds));
  }
  await pool.end();
});

test("factura automáticamente los cargos de meses cerrados y salta los sin NIF", async () => {
  const conNif = await createInstallation({ taxId: "F11111111" });
  const sinNif = await createInstallation();
  const chargeConNif = await createCharge(conNif.id, PAST_PERIOD, 4);
  const chargeSinNif = await createCharge(sinNif.id, PAST_PERIOD, 2);
  // Cargo del mes en curso: no debe facturarse (el importe aún puede cambiar).
  const chargeActual = await createCharge(conNif.id, currentPeriod(), 4);

  const result = await runAutoInvoicing();
  assert.ok(result.issued >= 1, `esperaba al menos 1 emitida, hubo ${result.issued}`);

  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.chargeId, chargeConNif.id));
  assert.ok(inv, "el cargo cerrado con NIF debe tener factura");
  assert.equal(inv.period, PAST_PERIOD);
  assert.equal(inv.subtotalCents, chargeConNif.totalCents);
  assert.equal(inv.customerTaxId, "F11111111");
  assert.match(inv.fullNumber, /^[A-Z0-9]+-\d{4}-\d{4}$/);
  // Huella encadenada verificable con los datos guardados.
  assert.equal(
    inv.hash,
    invoiceHash({
      prevHash: inv.prevHash,
      fullNumber: inv.fullNumber,
      issueDate: inv.issueDate,
      period: inv.period,
      issuerName: inv.issuerName,
      issuerTaxId: inv.issuerTaxId,
      issuerAddress: inv.issuerAddress,
      customerName: inv.customerName,
      customerTaxId: inv.customerTaxId,
      customerAddress: inv.customerAddress,
      baseCents: inv.baseCents,
      farmCount: inv.farmCount,
      variableCents: inv.variableCents,
      subtotalCents: inv.subtotalCents,
      taxRateBps: inv.taxRateBps,
      taxName: inv.taxName,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
    }),
  );

  const [chargeAfter] = await db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.id, chargeConNif.id));
  assert.equal(chargeAfter.status, "invoiced");

  // Sin NIF: el cargo sigue pendiente y sin factura.
  const invsSinNif = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.chargeId, chargeSinNif.id));
  assert.equal(invsSinNif.length, 0);
  const [pendiente] = await db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.id, chargeSinNif.id));
  assert.equal(pendiente.status, "pending");

  // El cargo del mes en curso no se toca.
  const [actual] = await db
    .select()
    .from(billingChargesTable)
    .where(eq(billingChargesTable.id, chargeActual.id));
  assert.equal(actual.status, "pending");

  // Idempotente: una segunda pasada no duplica la factura.
  await runAutoInvoicing();
  const invs = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.chargeId, chargeConNif.id));
  assert.equal(invs.length, 1);
});

test("numeración correlativa entre facturas automáticas consecutivas", async () => {
  const a = await createInstallation({ taxId: "F22222222" });
  const b = await createInstallation({ taxId: "F33333333" });
  await createCharge(a.id, "2020-02", 1);
  await createCharge(b.id, "2020-02", 3);

  await runAutoInvoicing();

  const invs = await db
    .select()
    .from(invoicesTable)
    .where(inArray(invoicesTable.installationId, [a.id, b.id]))
    .orderBy(invoicesTable.id);
  const nuevos = invs.filter((i) => i.period === "2020-02");
  assert.equal(nuevos.length, 2);
  assert.equal(Math.abs(nuevos[1].number - nuevos[0].number), 1);
  // Encadenado: la segunda apunta a la huella de la primera.
  assert.equal(nuevos[1].prevHash, nuevos[0].hash);
});
