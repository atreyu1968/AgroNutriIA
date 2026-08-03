import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { farmsTable, sectorsTable } from "./farms";
import { usersTable } from "./auth";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").references(() => sectorsTable.id, {
    onDelete: "set null",
  }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Nueva conversación"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  attachments: text("attachments").array(),
  toolsUsed: text("tools_used").array(),
  sources: text("sources").array(),
  estimatedCostEur: real("estimated_cost_eur"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Message = typeof messagesTable.$inferSelect;

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  farmId: integer("farm_id")
    .notNull()
    .references(() => farmsTable.id, { onDelete: "cascade" }),
  recommendationId: integer("recommendation_id"),
  title: text("title").notNull(),
  reportType: text("report_type").notNull().default("fertirrigacion"), // fertirrigacion | enmiendas
  format: text("format").notNull(), // pdf | docx
  status: text("status").notNull().default("generating"), // generating | ready | error
  warnings: text("warnings").array(),
  filePath: text("file_path"),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Report = typeof reportsTable.$inferSelect;

export const aiUsageTable = pgTable("ai_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  farmId: integer("farm_id").references(() => farmsTable.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  operation: text("operation").notNull(), // chat | report
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostEur: real("estimated_cost_eur"),
  durationMs: integer("duration_ms"),
  result: text("result"), // ok | error
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AiUsage = typeof aiUsageTable.$inferSelect;

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  farmId: integer("farm_id").references(() => farmsTable.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  detail: text("detail"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AuditEntry = typeof auditLogTable.$inferSelect;
