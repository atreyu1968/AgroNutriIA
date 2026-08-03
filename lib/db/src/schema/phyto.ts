import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  date,
} from "drizzle-orm/pg-core";
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
