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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("billing_charges_installation_period_unique").on(t.installationId, t.period)],
);
export type BillingCharge = typeof billingChargesTable.$inferSelect;
