-- ============================================================================
-- Horus V1 · 「需求统计」升级脚本（MySQL 8.0）
-- ----------------------------------------------------------------------------
-- 适用：已经按旧版 01-schema.sql 建库、且要升级到带「需求统计」的版本。
--       新库请直接执行 01-schema.sql（已包含这些结构），不要执行本脚本。
-- 注意：本脚本是一次性升级脚本，重复执行会因列/表/索引已存在而报错。
--
-- 执行后：
--   1. 应用侧可设置 HORUS_DB_PUSH=false；容器启动会校验 8 张表。
--   2. 回填历史生命周期事件（任选其一，可重复执行）：
--      docker compose exec horus node --experimental-strip-types /opt/horus-migrate/src/db/backfill-events-cli.ts
--      cd frontend && DATABASE_URL=... npm run db:backfill
--      或首次打开「需求统计」时由应用自动回填；历史卡点标记为估算。
-- ============================================================================

ALTER TABLE `horus_requirements`
  ADD COLUMN `released_at` varchar(40) NULL AFTER `updated_at`,
  ADD COLUMN `cancelled_at` varchar(40) NULL AFTER `released_at`;

CREATE TABLE `horus_requirement_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `requirement_id` int NOT NULL,
  `team_id` varchar(64) NOT NULL,
  `type` varchar(24) NOT NULL,
  `detail` json NOT NULL,
  `estimated` boolean NOT NULL DEFAULT false,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `horus_requirement_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `horus_requirement_events_unique` UNIQUE (`requirement_id`, `type`, `created_at`)
);

CREATE INDEX `horus_requirement_events_requirement_id_idx` ON `horus_requirement_events` (`requirement_id`);
CREATE INDEX `horus_requirement_events_created_at_idx` ON `horus_requirement_events` (`created_at`);
CREATE INDEX `horus_requirement_events_team_id_idx` ON `horus_requirement_events` (`team_id`);

-- Best-effort historical timestamps. Events are backfilled by the app because
-- audit-log details are JSON and differ between MySQL and PostgreSQL.
UPDATE `horus_requirements`
   SET `released_at` = `entered_at`
 WHERE `status` = 'released' AND `released_at` IS NULL;

UPDATE `horus_requirements`
   SET `cancelled_at` = `archived_at`
 WHERE `status` = 'cancelled' AND `cancelled_at` IS NULL;
