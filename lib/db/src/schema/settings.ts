import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Configuración global de la aplicación (clave-valor), editable por administradores. */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AppSetting = typeof appSettingsTable.$inferSelect;
