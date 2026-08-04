import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  date,
} from "drizzle-orm/pg-core";
import { farmsTable, sectorsTable } from "./farms";
import { usersTable } from "./auth";

export type AnalysisParameter = {
  name: string;
  value: number;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  status?: string | null; // muy_bajo | bajo | normal | alto | muy_alto
};

export const waterSourcesTable = pgTable("water_sources", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sharePct: real("share_pct").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WaterSource = typeof waterSourcesTable.$inferSelect;

export const analysesTable = pgTable("analyses", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").references(() => sectorsTable.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(), // soil | leaf | water
  waterSourceId: integer("water_source_id").references(() => waterSourcesTable.id, {
    onDelete: "set null",
  }),
  reference: text("reference"),
  laboratory: text("laboratory"),
  description: text("description"),
  sampleDate: date("sample_date", { mode: "string" }).notNull(),
  parameters: jsonb("parameters").$type<AnalysisParameter[]>().notNull().default([]),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Analysis = typeof analysesTable.$inferSelect;

export const fertilizersTable = pgTable("fertilizers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  formulaType: text("formula_type").default("solid"), // solid | liquid
  usage: text("usage").default("fertirrigacion"), // fertirrigacion | enmienda
  nPct: real("n_pct").default(0),
  nNitricPct: real("n_nitric_pct").default(0),
  nAmmoniacalPct: real("n_ammoniacal_pct").default(0),
  nUreicPct: real("n_ureic_pct").default(0),
  p2o5Pct: real("p2o5_pct").default(0),
  k2oPct: real("k2o_pct").default(0),
  caoPct: real("cao_pct").default(0),
  mgoPct: real("mgo_pct").default(0),
  so3Pct: real("so3_pct").default(0),
  boronPct: real("boron_pct").default(0),
  densityKgL: real("density_kg_l"),
  ecContribution: real("ec_contribution"), // dS/m per g/L approx
  incompatibleWith: text("incompatible_with").array(),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Fertilizer = typeof fertilizersTable.$inferSelect;

export type ProductSheetComposition = {
  nPct?: number | null;
  p2o5Pct?: number | null;
  k2oPct?: number | null;
  caoPct?: number | null;
  mgoPct?: number | null;
  so3Pct?: number | null;
  boronPct?: number | null;
};

export const productSheetsTable = pgTable("product_sheets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  manufacturer: text("manufacturer"),
  category: text("category"), // abono soluble, quelato, bioestimulante, etc.
  formulaType: text("formula_type"), // solid | liquid
  description: text("description"),
  composition: jsonb("composition").$type<ProductSheetComposition | null>(),
  dosage: text("dosage"),
  sourceUrl: text("source_url"),
  fertilizerId: integer("fertilizer_id").references(() => fertilizersTable.id, {
    onDelete: "set null",
  }),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProductSheet = typeof productSheetsTable.$inferSelect;

export type RecommendationItem = {
  fertilizerId?: number | null;
  fertilizerName: string;
  weeklyDose: number;
  unit: string; // kg | L
  previousDose?: number | null;
  reason?: string | null;
};

export const recommendationsTable = pgTable("recommendations", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").references(() => sectorsTable.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  status: text("status").notNull().default("draft"), // draft | pending_review | validated | applying | finished | rejected
  source: text("source").notNull().default("manual"), // manual | ai
  items: jsonb("items").$type<RecommendationItem[]>().notNull().default([]),
  rationale: text("rationale"),
  estimatedEcDsM: real("estimated_ec_ds_m"),
  estimatedWeeklyNKg: real("estimated_weekly_n_kg"),
  warnings: text("warnings").array(),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  validatedBy: integer("validated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedBy: integer("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  reviewComment: text("review_comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type Recommendation = typeof recommendationsTable.$inferSelect;
