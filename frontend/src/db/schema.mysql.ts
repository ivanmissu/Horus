import { index, int, json, mysqlTable, text, uniqueIndex, varchar, boolean } from "drizzle-orm/mysql-core";

export type Stage = { id: string; name: string };
export type RequirementEventType = "created" | "released" | "cancelled" | "archived" | "blocked" | "unblocked";
const isoNow = () => new Date().toISOString();

export const teams = mysqlTable("horus_teams", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull().$defaultFn(() => ""),
  color: varchar("color", { length: 16 }).notNull().default("purple"),
  icon: varchar("icon", { length: 32 }).notNull().default("code"),
  stages: json("stages").$type<Stage[]>().notNull(),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
}, table => [
  uniqueIndex("horus_teams_name_unique").on(table.name),
]);

export const members = mysqlTable("horus_members", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  username: varchar("username", { length: 32 }).notNull(),
  role: varchar("role", { length: 16 }).$type<"owner" | "pm" | "observer">().notNull().default("pm"),
  teamIds: json("team_ids").$type<string[]>().notNull().$defaultFn(() => []),
  passwordHash: varchar("password_hash", { length: 100 }),
  active: boolean("active").notNull().default(true),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
}, table => [
  uniqueIndex("horus_members_username_unique").on(table.username),
]);

export const requirements = mysqlTable("horus_requirements", {
  id: int("id").autoincrement().primaryKey(),
  teamId: varchar("team_id", { length: 64 }).notNull().references(() => teams.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().$defaultFn(() => ""),
  priority: varchar("priority", { length: 16 }).$type<"high" | "medium" | "low">().notNull().default("medium"),
  owner: varchar("owner", { length: 128 }).notNull().default(""),
  expectedDate: varchar("expected_date", { length: 10 }),
  /** 需求周期：this = 本周（立即创建），next = 下周（创建时间设为下周一 09:00）。 */
  requirementCycle: varchar("requirement_cycle", { length: 16 }).$type<"this" | "next">().notNull().default("this"),
  stageId: varchar("stage_id", { length: 64 }).notNull(),
  enteredAt: varchar("entered_at", { length: 40 }).notNull().$defaultFn(isoNow),
  blocked: boolean("blocked").notNull().default(false),
  blockReason: text("block_reason").notNull().$defaultFn(() => ""),
  status: varchar("status", { length: 16 }).$type<"active" | "released" | "cancelled">().notNull().default("active"),
  source: varchar("source", { length: 60 }).notNull().default("手工录入"),
  externalId: varchar("external_id", { length: 255 }),
  createdBy: varchar("created_by", { length: 64 }).references(() => members.id),
  updatedBy: varchar("updated_by", { length: 64 }).references(() => members.id),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
  updatedAt: varchar("updated_at", { length: 40 }).notNull().$defaultFn(isoNow),
  releasedAt: varchar("released_at", { length: 40 }),
  cancelledAt: varchar("cancelled_at", { length: 40 }),
  archivedAt: varchar("archived_at", { length: 40 }),
});

export const sessions = mysqlTable("horus_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  memberId: varchar("member_id", { length: 64 }).notNull().references(() => members.id),
  expiresAt: varchar("expires_at", { length: 40 }).notNull(),
}, table => [
  index("horus_sessions_member_id_idx").on(table.memberId),
]);

export const auditLogs = mysqlTable("horus_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorId: varchar("actor_id", { length: 64 }).notNull(),
  requirementId: int("requirement_id"),
  action: varchar("action", { length: 64 }).notNull(),
  detail: json("detail").$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
}, table => [
  index("horus_audit_logs_requirement_id_idx").on(table.requirementId),
]);

/**
 * Append-only lifecycle log used by the statistics page.
 * `estimated = true` marks events reconstructed from requirement timestamps
 * (deployments before this table existed), never events written by the app.
 */
export const requirementEvents = mysqlTable("horus_requirement_events", {
  id: int("id").autoincrement().primaryKey(),
  requirementId: int("requirement_id").notNull(),
  teamId: varchar("team_id", { length: 64 }).notNull(),
  type: varchar("type", { length: 24 }).$type<RequirementEventType>().notNull(),
  detail: json("detail").$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  estimated: boolean("estimated").notNull().default(false),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
}, table => [
  index("horus_requirement_events_requirement_id_idx").on(table.requirementId),
  index("horus_requirement_events_created_at_idx").on(table.createdAt),
  index("horus_requirement_events_team_id_idx").on(table.teamId),
  uniqueIndex("horus_requirement_events_unique").on(table.requirementId, table.type, table.createdAt),
]);

export const notificationSettings = mysqlTable("horus_notification_settings", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  enabled: boolean("enabled").notNull().default(false),
  time: varchar("time", { length: 5 }).notNull().default("09:30"),
  webhook: varchar("webhook", { length: 2048 }).notNull().default(""),
  signingSecret: varchar("signing_secret", { length: 500 }).notNull().default(""),
  appUrl: varchar("app_url", { length: 1000 }).notNull().default(""),
  lastRunDate: varchar("last_run_date", { length: 10 }),
  pendingItems: json("pending_items").$type<string[]>().notNull().$defaultFn(() => []),
});

export const notificationLogs = mysqlTable("horus_notification_logs", {
  id: int("id").autoincrement().primaryKey(),
  status: varchar("status", { length: 10 }).$type<"success" | "failed">().notNull(),
  summary: text("summary").notNull(),
  error: text("error"),
  createdAt: varchar("created_at", { length: 40 }).notNull().$defaultFn(isoNow),
});
