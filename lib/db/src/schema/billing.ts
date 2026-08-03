import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Contratación online: cada fila es una instalación (una cooperativa/OPP con
 * su propio subdominio, base de datos y servicio, según los términos).
 *
 * Estados: pending_payment → provisioning → active
 *          active → suspended (impago) → active (reactivación)
 *          cualquiera → cancelled (baja, con exportación de datos)
 *          provisioning → error (fallo de aprovisionamiento, reintentable)
 */
export const installationsTable = pgTable("installations", {
  id: serial("id").primaryKey(),
  /** Nombre de la cooperativa u OPP. */
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  phone: text("phone"),
  /** Subdominio contratado (cooperativa.midominio.com). */
  subdomain: text("subdomain").notNull().unique(),
  status: text("status").notNull().default("pending_payment"),
  /** Token público para consultar el estado tras volver de PayPal (sin sesión). */
  publicToken: text("public_token").notNull().unique(),
  /** Token secreto de la instalación para reportar uso (fincas activas). */
  apiToken: text("api_token").notNull().unique(),
  paypalSubscriptionId: text("paypal_subscription_id"),
  /** NIF/CIF de la cooperativa, necesario para emitir facturas. */
  taxId: text("tax_id"),
  /** Dirección fiscal para las facturas. */
  billingAddress: text("billing_address"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
  /** Fincas activas según el último reporte de la instalación. */
  activeFarmCount: integer("active_farm_count").notNull().default(0),
  usageReportedAt: timestamp("usage_reported_at", { withTimezone: true }),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Installation = typeof installationsTable.$inferSelect;

/** Registro paso a paso del aprovisionamiento de cada instalación. */
export const provisioningEventsTable = pgTable("provisioning_events", {
  id: serial("id").primaryKey(),
  installationId: integer("installation_id")
    .notNull()
    .references(() => installationsTable.id, { onDelete: "cascade" }),
  /** Paso: dns, database, service, tls, admin_account, email, export… */
  step: text("step").notNull(),
  /** ok | error | info */
  status: text("status").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProvisioningEvent = typeof provisioningEventsTable.$inferSelect;

/**
 * Cargo mensual por instalación: cuota base (100 €) + variable
 * (2,50 € por finca activa). Importes en céntimos para evitar decimales.
 */
export const billingChargesTable = pgTable(
  "billing_charges",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "cascade" }),
    /** Periodo facturado, formato YYYY-MM. */
    period: text("period").notNull(),
    baseCents: integer("base_cents").notNull(),
    farmCount: integer("farm_count").notNull(),
    variableCents: integer("variable_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** pending | invoiced | paid */
    status: text("status").notNull().default("pending"),
    /** Cuándo se añadió a la cuota de PayPal (revisión de la suscripción). */
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    /** Id del cobro (sale) de PayPal que liquidó este cargo. */
    paypalSaleId: text("paypal_sale_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("billing_charges_installation_period_unique").on(t.installationId, t.period)],
);
export type BillingCharge = typeof billingChargesTable.$inferSelect;

/**
 * Factura emitida a partir de un cargo mensual. Registro inmutable:
 * una vez emitida no se edita (rectificaciones = nueva factura).
 * Incluye encadenado de huellas (hash) al estilo VeriFactu.
 */
export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" }),
    chargeId: integer("charge_id")
      .notNull()
      .unique()
      .references(() => billingChargesTable.id, { onDelete: "restrict" }),
    /** Serie de facturación (p. ej. AGN). */
    series: text("series").notNull(),
    /** Año de emisión (la numeración se reinicia cada año). */
    year: integer("year").notNull(),
    /** Número correlativo dentro de la serie y el año. */
    number: integer("number").notNull(),
    /** Número completo mostrado: SERIE-AAAA-0001. */
    fullNumber: text("full_number").notNull().unique(),
    issueDate: timestamp("issue_date", { withTimezone: true }).notNull(),
    /** Periodo facturado YYYY-MM. */
    period: text("period").notNull(),
    /** Snapshot de los datos del emisor y del cliente en el momento de emisión. */
    issuerName: text("issuer_name").notNull(),
    issuerTaxId: text("issuer_tax_id").notNull(),
    issuerAddress: text("issuer_address").notNull(),
    customerName: text("customer_name").notNull(),
    customerTaxId: text("customer_tax_id").notNull(),
    customerAddress: text("customer_address"),
    baseCents: integer("base_cents").notNull(),
    farmCount: integer("farm_count").notNull(),
    variableCents: integer("variable_cents").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    /** Tipo impositivo en centésimas de punto (700 = 7,00 % IGIC). */
    taxRateBps: integer("tax_rate_bps").notNull(),
    /** Nombre del impuesto aplicado (IGIC, IVA…). */
    taxName: text("tax_name").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** issued | sent | paid */
    status: text("status").notNull().default("issued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Huella SHA-256 de la factura anterior de la cadena (VeriFactu). */
    prevHash: text("prev_hash"),
    /** Huella SHA-256 de esta factura (VeriFactu). */
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_series_year_number_unique").on(t.series, t.year, t.number)],
);
export type Invoice = typeof invoicesTable.$inferSelect;

/**
 * Envío del registro de facturación de cada factura a la AEAT (VeriFactu).
 * Una fila por factura: se crea en estado `pending` al emitir (si VeriFactu
 * está activado) y el job de envío la va actualizando con la respuesta.
 */
export const verifactuSubmissionsTable = pgTable("verifactu_submissions", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .unique()
    .references(() => invoicesTable.id, { onDelete: "restrict" }),
  /** pending | accepted | accepted_with_errors | rejected | error */
  status: text("status").notNull().default("pending"),
  /** Entorno AEAT al que se envió: sandbox (pruebas) | production. */
  environment: text("environment"),
  /** Intentos de envío realizados. */
  attempts: integer("attempts").notNull().default(0),
  /** CSV (código seguro de verificación) devuelto por la AEAT al aceptar. */
  aeatCsv: text("aeat_csv"),
  /** Código y descripción de error devueltos por la AEAT, si los hay. */
  aeatErrorCode: text("aeat_error_code"),
  lastError: text("last_error"),
  /** XML del registro enviado (para auditoría y reenvíos). */
  requestXml: text("request_xml"),
  /** XML de la respuesta de la AEAT. */
  responseXml: text("response_xml"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VerifactuSubmission = typeof verifactuSubmissionsTable.$inferSelect;
