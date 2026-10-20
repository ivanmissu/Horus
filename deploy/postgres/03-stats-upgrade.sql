-- Horus V1 · 「需求统计」升级脚本（PostgreSQL / Supabase）
-- 适用：已经按旧版 01-schema.sql 建库、且要升级到带「需求统计」的版本。
-- 新库请直接执行 01-schema.sql（已包含这些结构），不要执行本脚本。
--
-- 执行后运行 `cd frontend && npm run db:backfill`（或首次打开统计页时自动回填），
-- 历史事件会按 createdAt / enteredAt / archivedAt 与审计日志补齐。

ALTER TABLE "horus_requirements" ADD COLUMN IF NOT EXISTS "released_at" varchar(40);
ALTER TABLE "horus_requirements" ADD COLUMN IF NOT EXISTS "cancelled_at" varchar(40);

CREATE TABLE IF NOT EXISTS "horus_requirement_events" (
  "id" serial PRIMARY KEY,
  "requirement_id" integer NOT NULL,
  "team_id" varchar(64) NOT NULL,
  "type" varchar(24) NOT NULL,
  "detail" jsonb NOT NULL,
  "estimated" boolean NOT NULL DEFAULT false,
  "created_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_requirement_events_unique" UNIQUE ("requirement_id", "type", "created_at")
);

CREATE INDEX IF NOT EXISTS "horus_requirement_events_requirement_id_idx" ON "horus_requirement_events" ("requirement_id");
CREATE INDEX IF NOT EXISTS "horus_requirement_events_created_at_idx" ON "horus_requirement_events" ("created_at");
CREATE INDEX IF NOT EXISTS "horus_requirement_events_team_id_idx" ON "horus_requirement_events" ("team_id");

UPDATE "horus_requirements"
   SET "released_at" = "entered_at"
 WHERE "status" = 'released' AND "released_at" IS NULL;

UPDATE "horus_requirements"
   SET "cancelled_at" = "archived_at"
 WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;

ALTER TABLE "horus_requirement_events" ENABLE ROW LEVEL SECURITY;
