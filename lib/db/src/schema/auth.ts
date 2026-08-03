import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  real,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  role: text("role").notNull().default("owner"),
  isAdmin: boolean("is_admin").notNull().default(false),
  unitsPreference: text("units_preference").default("metric"),
  reportLanguage: text("report_language").default("es"),
  aiMonthlyLimitEur: real("ai_monthly_limit_eur"),
  aiResponseStyle: text("ai_response_style"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type User = typeof usersTable.$inferSelect;

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Session = typeof sessionsTable.$inferSelect;

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // sha256 del token enviado por email
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;

export const credentialsTable = pgTable("api_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("openai"),
  name: text("name").notNull(),
  encryptedKey: text("encrypted_key").notNull(), // AES-256-GCM iv:tag:ciphertext base64
  maskedKey: text("masked_key").notNull(),
  selectedModel: text("selected_model").default("gpt-4o-mini"),
  monthlyLimitEur: real("monthly_limit_eur"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Credential = typeof credentialsTable.$inferSelect;
