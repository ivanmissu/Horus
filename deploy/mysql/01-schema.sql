-- ============================================================================
-- Horus V1 · MySQL 8.0 建表脚本（01-schema.sql）
-- ----------------------------------------------------------------------------
-- 来源：由 frontend/src/db/schema.ts 经 drizzle-kit generate 生成（8 张表），
--       与应用启动时 drizzle-kit push 的目标结构一致。
-- 用途：在【空库】上人工初始化，或上线前评审表结构时使用；推荐通过
--       ./scripts/init-sql.sh 执行（会顺带校验结果）。
--       执行后请在应用侧设 HORUS_DB_PUSH=false，容器启动就不再跑 drizzle-kit
--       （docs/kubernetes-deployment.md 第 1、8 节）。
--       常规 Compose 部署不需要手工执行本脚本——容器启动会自动同步表结构
--       （docs/deployment-guide.md 第 5 节「路径 A」）。
-- 注意：本脚本为一次性建表脚本，重复执行会因表/外键/索引已存在而报错，
--       不要对已有数据的生产库重复执行。字符集请使用 utf8mb4。
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE `horus_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` varchar(64) NOT NULL,
	`requirement_id` int,
	`action` varchar(64) NOT NULL,
	`detail` json NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_audit_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `horus_members` (
	`id` varchar(64) NOT NULL,
	`name` varchar(100) NOT NULL,
	`username` varchar(32) NOT NULL,
	`role` varchar(16) NOT NULL DEFAULT 'pm',
	`team_ids` json NOT NULL,
	`password_hash` varchar(100),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `horus_members_username_unique` UNIQUE(`username`)
);

CREATE TABLE `horus_notification_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`status` varchar(10) NOT NULL,
	`summary` text NOT NULL,
	`error` text,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_notification_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `horus_notification_settings` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`enabled` boolean NOT NULL DEFAULT false,
	`time` varchar(5) NOT NULL DEFAULT '09:30',
	`webhook` varchar(2048) NOT NULL DEFAULT '',
	`signing_secret` varchar(500) NOT NULL DEFAULT '',
	`app_url` varchar(1000) NOT NULL DEFAULT '',
	`last_run_date` varchar(10),
	`pending_items` json NOT NULL,
	CONSTRAINT `horus_notification_settings_id` PRIMARY KEY(`id`)
);

CREATE TABLE `horus_requirement_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requirement_id` int NOT NULL,
	`team_id` varchar(64) NOT NULL,
	`type` varchar(24) NOT NULL,
	`detail` json NOT NULL,
	`estimated` boolean NOT NULL DEFAULT false,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_requirement_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `horus_requirement_events_unique` UNIQUE(`requirement_id`,`type`,`created_at`)
);

CREATE TABLE `horus_requirements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`priority` varchar(16) NOT NULL DEFAULT 'medium',
	`owner` varchar(128) NOT NULL DEFAULT '',
	`expected_date` varchar(10),
	`stage_id` varchar(64) NOT NULL,
	`entered_at` varchar(40) NOT NULL,
	`blocked` boolean NOT NULL DEFAULT false,
	`block_reason` text NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`source` varchar(60) NOT NULL DEFAULT '手工录入',
	`external_id` varchar(255),
	`created_by` varchar(64),
	`updated_by` varchar(64),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	`released_at` varchar(40),
	`cancelled_at` varchar(40),
	`archived_at` varchar(40),
	CONSTRAINT `horus_requirements_id` PRIMARY KEY(`id`)
);

CREATE TABLE `horus_sessions` (
	`id` varchar(64) NOT NULL,
	`member_id` varchar(64) NOT NULL,
	`expires_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_sessions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `horus_teams` (
	`id` varchar(64) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT 'purple',
	`icon` varchar(32) NOT NULL DEFAULT 'code',
	`stages` json NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `horus_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `horus_teams_name_unique` UNIQUE(`name`)
);

ALTER TABLE `horus_requirements` ADD CONSTRAINT `horus_requirements_team_id_horus_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `horus_teams`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `horus_requirements` ADD CONSTRAINT `horus_requirements_created_by_horus_members_id_fk` FOREIGN KEY (`created_by`) REFERENCES `horus_members`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `horus_requirements` ADD CONSTRAINT `horus_requirements_updated_by_horus_members_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `horus_members`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `horus_sessions` ADD CONSTRAINT `horus_sessions_member_id_horus_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `horus_members`(`id`) ON DELETE no action ON UPDATE no action;
CREATE INDEX `horus_audit_logs_requirement_id_idx` ON `horus_audit_logs` (`requirement_id`);
CREATE INDEX `horus_requirement_events_requirement_id_idx` ON `horus_requirement_events` (`requirement_id`);
CREATE INDEX `horus_requirement_events_created_at_idx` ON `horus_requirement_events` (`created_at`);
CREATE INDEX `horus_requirement_events_team_id_idx` ON `horus_requirement_events` (`team_id`);
CREATE INDEX `horus_sessions_member_id_idx` ON `horus_sessions` (`member_id`);
