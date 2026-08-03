import {
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
  integer,
  real,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable, credentialsTable } from "./auth";

export const farmsTable = pgTable("farms", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  companyName: text("company_name"),
  cif: text("cif"),
  island: text("island"),
  municipality: text("municipality"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  altitudeM: real("altitude_m"),
  surfaceHa: real("surface_ha"),
  mainCrop: text("main_crop").default("platanera"),
  variety: text("variety"),
  plantCount: integer("plant_count"),
  phenologicalStage: text("phenological_stage"),
  cropSystem: text("crop_system"),
  soilType: text("soil_type"),
  hasDrainage: boolean("has_drainage"),
  foliarAllowed: boolean("foliar_allowed"),
  hasDesalinatedWater: boolean("has_desalinated_water"),
  desalinatedWaterPct: real("desalinated_water_pct"),
  weeklyLitresPerPlant: real("weekly_litres_per_plant"),
  maxEcDsM: real("max_ec_ds_m"),
  managementNotes: text("management_notes"),
  responsibleTechnician: text("responsible_technician"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type Farm = typeof farmsTable.$inferSelect;

export const farmMembersTable = pgTable(
  "farm_members",
  {
    id: serial("id").primaryKey(),
    farmId: integer("farm_id")
      .notNull()
      .references(() => farmsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // technician | manager | viewer
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("farm_members_farm_user_unique").on(t.farmId, t.userId)]
);
export type FarmMember = typeof farmMembersTable.$inferSelect;

export const sectorsTable = pgTable("sectors", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  plantCount: integer("plant_count"),
  surfaceHa: real("surface_ha"),
  weeklyLitresPerPlant: real("weekly_litres_per_plant"),
  phenologicalStage: text("phenological_stage"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Sector = typeof sectorsTable.$inferSelect;

export const farmApiConfigTable = pgTable("farm_api_config", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .unique()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  credentialId: integer("credential_id").references(() => credentialsTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type FarmApiConfig = typeof farmApiConfigTable.$inferSelect;
