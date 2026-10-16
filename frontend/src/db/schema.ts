import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export type Stage = { id: string; name: string };
export const teams = pgTable("horus_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("purple"),
  icon: text("icon").notNull().default("code"),
  stages: jsonb("stages").$type<Stage[]>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});
export const members = pgTable("horus_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  role: text("role").$type<"owner" | "pm">().notNull().default("pm"),
  teamIds: jsonb("team_ids").$type<string[]>().notNull().default([]),
  passwordHash: text("password_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});
export const requirements = pgTable("horus_requirements", {
  id: serial("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").$type<"high" | "medium" | "low">().notNull().default("medium"),
  owner: text("owner").notNull().default(""),
  expectedDate: text("expected_date"),
  stageId: text("stage_id").notNull(),
  enteredAt: timestamp("entered_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  blocked: boolean("blocked").notNull().default(false),
  blockReason: text("block_reason").notNull().default(""),
  status: text("status").$type<"active" | "released" | "cancelled">().notNull().default("active"),
  source: text("source").notNull().default("手工录入"),
  externalId: text("external_id"),
  createdBy: text("created_by").references(() => members.id),
  updatedBy: text("updated_by").references(() => members.id),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { mode: "string", withTimezone: true }),
});
export const sessions = pgTable("horus_sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }).notNull(),
});
export const auditLogs = pgTable("horus_audit_logs", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  requirementId: integer("requirement_id"),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});
export const notificationSettings = pgTable("horus_notification_settings", {
  id: text("id").primaryKey().default("default"),
  enabled: boolean("enabled").notNull().default(false),
  time: text("time").notNull().default("09:30"),
  webhook: text("webhook").notNull().default(""),
  signingSecret: text("signing_secret").notNull().default(""),
  appUrl: text("app_url").notNull().default(""),
  lastRunDate: text("last_run_date"),
  pendingItems: jsonb("pending_items").$type<string[]>().notNull().default([]),
});
export const notificationLogs = pgTable("horus_notification_logs", {
  id: serial("id").primaryKey(),
  status: text("status").$type<"success" | "failed">().notNull(),
  summary: text("summary").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});
