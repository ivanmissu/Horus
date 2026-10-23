-- Horus V1 · PostgreSQL schema (8 tables).
-- Apply once to an empty database; the application uses Drizzle's matching
-- schema at frontend/src/db/schema.postgres.ts.

CREATE TABLE "horus_teams" (
  "id" varchar(64) NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text NOT NULL,
  "color" varchar(16) NOT NULL DEFAULT 'purple',
  "icon" varchar(32) NOT NULL DEFAULT 'code',
  "stages" jsonb NOT NULL,
  "created_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_teams_id" PRIMARY KEY ("id"),
  CONSTRAINT "horus_teams_name_unique" UNIQUE ("name")
);

CREATE TABLE "horus_members" (
  "id" varchar(64) NOT NULL,
  "name" varchar(100) NOT NULL,
  "username" varchar(32) NOT NULL,
  "role" varchar(16) NOT NULL DEFAULT 'pm',
  "team_ids" jsonb NOT NULL,
  "password_hash" varchar(100),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_members_id" PRIMARY KEY ("id"),
  CONSTRAINT "horus_members_username_unique" UNIQUE ("username")
);

CREATE TABLE "horus_requirement_events" (
  "id" serial PRIMARY KEY,
  "requirement_id" integer NOT NULL,
  "team_id" varchar(64) NOT NULL,
  "type" varchar(24) NOT NULL,
  "detail" jsonb NOT NULL,
  "estimated" boolean NOT NULL DEFAULT false,
  "created_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_requirement_events_unique" UNIQUE ("requirement_id", "type", "created_at")
);

CREATE TABLE "horus_requirements" (
  "id" serial PRIMARY KEY,
  "team_id" varchar(64) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "priority" varchar(16) NOT NULL DEFAULT 'medium',
  "owner" varchar(128) NOT NULL DEFAULT '',
  "expected_date" varchar(10),
  "stage_id" varchar(64) NOT NULL,
  "entered_at" varchar(40) NOT NULL,
  "blocked" boolean NOT NULL DEFAULT false,
  "block_reason" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "source" varchar(60) NOT NULL DEFAULT '手工录入',
  "external_id" varchar(255),
  "created_by" varchar(64),
  "updated_by" varchar(64),
  "created_at" varchar(40) NOT NULL,
  "updated_at" varchar(40) NOT NULL,
  "released_at" varchar(40),
  "cancelled_at" varchar(40),
  "archived_at" varchar(40),
  CONSTRAINT "horus_requirements_team_id_horus_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "horus_teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "horus_requirements_created_by_horus_members_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "horus_requirements_updated_by_horus_members_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "horus_sessions" (
  "id" varchar(64) NOT NULL,
  "member_id" varchar(64) NOT NULL,
  "expires_at" varchar(40) NOT NULL,
  CONSTRAINT "horus_sessions_id" PRIMARY KEY ("id"),
  CONSTRAINT "horus_sessions_member_id_horus_members_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "horus_members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "horus_audit_logs" (
  "id" serial PRIMARY KEY,
  "actor_id" varchar(64) NOT NULL,
  "requirement_id" integer,
  "action" varchar(64) NOT NULL,
  "detail" jsonb NOT NULL,
  "created_at" varchar(40) NOT NULL
);

CREATE TABLE "horus_notification_settings" (
  "id" varchar(64) NOT NULL DEFAULT 'default',
  "enabled" boolean NOT NULL DEFAULT false,
  "time" varchar(5) NOT NULL DEFAULT '09:30',
  "webhook" varchar(2048) NOT NULL DEFAULT '',
  "signing_secret" varchar(500) NOT NULL DEFAULT '',
  "app_url" varchar(1000) NOT NULL DEFAULT '',
  "last_run_date" varchar(10),
  "pending_items" jsonb NOT NULL,
  CONSTRAINT "horus_notification_settings_id" PRIMARY KEY ("id")
);

CREATE TABLE "horus_notification_logs" (
  "id" serial PRIMARY KEY,
  "status" varchar(10) NOT NULL,
  "summary" text NOT NULL,
  "error" text,
  "created_at" varchar(40) NOT NULL
);

CREATE INDEX "horus_audit_logs_requirement_id_idx" ON "horus_audit_logs" ("requirement_id");
CREATE INDEX "horus_requirement_events_requirement_id_idx" ON "horus_requirement_events" ("requirement_id");
CREATE INDEX "horus_requirement_events_created_at_idx" ON "horus_requirement_events" ("created_at");
CREATE INDEX "horus_requirement_events_team_id_idx" ON "horus_requirement_events" ("team_id");
CREATE INDEX "horus_sessions_member_id_idx" ON "horus_sessions" ("member_id");

-- The application uses a server-only PostgreSQL URL. Do not expose these
-- tables through Supabase's public Data API (there are intentionally no policies).
ALTER TABLE "horus_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_requirement_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horus_notification_logs" ENABLE ROW LEVEL SECURITY;
