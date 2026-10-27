-- Horus V1 · 「需求池」升级脚本（PostgreSQL / Supabase）
-- 适用：已按旧版 01-schema.sql 建库、要升级到带「需求池」的版本。
-- 新库请直接执行 01-schema.sql（已包含本表），不要执行本脚本。
-- 需求池独立于工作台、需求统计与钉钉摘要，不需要回填历史数据。

CREATE TABLE IF NOT EXISTS "horus_requirement_pool" (
  "id" serial PRIMARY KEY,
  "team_id" varchar(64) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "priority" varchar(16) NOT NULL DEFAULT 'medium',
  "submitter" varchar(128) NOT NULL DEFAULT '',
  "expected_date" varchar(10),
  "business_value" text NOT NULL,
  "note" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "requirement_id" integer,
  "decided_at" varchar(40),
  "decided_by" varchar(64),
  "decision_note" text NOT NULL,
  "created_by" varchar(64),
  "updated_by" varchar(64),
  "created_at" varchar(40) NOT NULL,
  "updated_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_requirement_pool_team_id_horus_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "horus_teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "horus_requirement_pool_decided_by_horus_members_id_fk"
    FOREIGN KEY ("decided_by") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "horus_requirement_pool_created_by_horus_members_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "horus_requirement_pool_updated_by_horus_members_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "horus_requirement_pool_team_id_idx" ON "horus_requirement_pool" ("team_id");
CREATE INDEX IF NOT EXISTS "horus_requirement_pool_status_idx" ON "horus_requirement_pool" ("status");
CREATE INDEX IF NOT EXISTS "horus_requirement_pool_created_at_idx" ON "horus_requirement_pool" ("created_at");

ALTER TABLE "horus_requirement_pool" ENABLE ROW LEVEL SECURITY;
