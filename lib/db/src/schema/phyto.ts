import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth";
import { farmsTable, sectorsTable } from "./farms";

// Registro de aplicaciones de productos fitosanitarios por finca/sector.
export const phytoTreatmentsTable = pgTable("phyto_treatments", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").references(() => sectorsTable.id, { onDelete: "set null" }),
  applicationDate: date("application_date").notNull(),
  productName: text("product_name").notNull(),
  registryNumber: text("registry_number"),
  activeIngredient: text("active_ingredient"),
  targetPest: text("target_pest"),
  doseAmount: real("dose_amount"),
  doseUnit: text("dose_unit"), // ml/hl | g/hl | l/ha | kg/ha | cc/l ...
  waterVolumeL: real("water_volume_l"),
  areaHa: real("area_ha"),
  safetyDays: integer("safety_days"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PhytoTreatment = typeof phytoTreatmentsTable.$inferSelect;

// Catálogo global de productos fitosanitarios autorizados (verificados contra
// el Registro del MAPA / Sanidad Vegetal de Canarias). Incluye la fecha de fin
// de la autorización para saber cuándo caduca sin volver a comprobar.
export const phytoProductsTable = pgTable("phyto_products", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  registryNumber: text("registry_number"),
  activeIngredient: text("active_ingredient"),
  pests: text("pests"), // plagas autorizadas en platanera, separadas por comas
  doseInfo: text("dose_info"), // p. ej. "150 ml/hl, máx 2 aplicaciones/año"
  maxApplicationsYear: integer("max_applications_year"),
  safetyDays: integer("safety_days"),
  expiryDate: date("expiry_date"), // fin de la autorización / inscripción
  exceptional: integer("exceptional").notNull().default(0), // 1 = autorización excepcional (Canarias)
  notes: text("notes"),
  sourceUrl: text("source_url"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Evitan duplicados en cargas concurrentes; el upsert se apoya en ellos.
  uniqueIndex("phyto_products_registry_uq").on(table.registryNumber),
  uniqueIndex("phyto_products_name_uq").on(sql`lower(${table.productName})`),
]);
export type PhytoProduct = typeof phytoProductsTable.$inferSelect;
