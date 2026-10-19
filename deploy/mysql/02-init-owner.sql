-- ============================================================================
-- Horus V1 · 初始数据脚本（02-init-owner.sql）
-- ----------------------------------------------------------------------------
-- 作用：创建初始团队负责人账号（密码留空，首次登录时设置）+ 通知设置默认行。
--       与应用自带 db:init（frontend/src/db/init-prod.ts）等价的 SQL 版本，
--       供 DBA 人工初始化时使用。执行本脚本后可在应用侧设 HORUS_DB_INIT=false
--       彻底跳过容器内的初始化；不执行也没关系——容器每次启动都会幂等跑 db:init。
-- 执行前：确认 01-schema.sql 已在当前库执行；按需修改下方 @owner_name /
--         @owner_username 两个变量（账号规则：3-32 位字母、数字、. _ -）。
-- 幂等性：可重复执行。负责人已存在时不会覆盖其密码/姓名，通知行不重复插入。
-- 注意：created_at 按应用约定存 UTC ISO-8601 字符串（VARCHAR），此处用
--       UTC_TIMESTAMP 生成同格式值，与应用写入格式一致。
-- ============================================================================

SET NAMES utf8mb4;

SET @owner_username = 'admin';
SET @owner_name = '团队负责人';

-- 初始负责人：id 固定为 owner，password_hash 为 NULL 表示尚未设置密码
INSERT INTO `horus_members` (`id`, `name`, `username`, `role`, `team_ids`, `password_hash`, `active`, `created_at`)
SELECT 'owner', @owner_name, @owner_username, 'owner', JSON_ARRAY(), NULL, TRUE,
       CONCAT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.'), LPAD(MICROSECOND(UTC_TIMESTAMP(3)) DIV 1000, 3, '0'), 'Z')
WHERE NOT EXISTS (SELECT 1 FROM `horus_members` WHERE `id` = 'owner');

-- 通知设置默认行（钉钉 Webhook 等由负责人在页面「通知设置」中填写）
INSERT IGNORE INTO `horus_notification_settings` (`id`, `pending_items`) VALUES ('default', JSON_ARRAY());

-- 执行后校验：应各返回 1 行
SELECT `id`, `username`, `name`, `role`, `active`, (`password_hash` IS NULL) AS `password_not_set`
FROM `horus_members` WHERE `id` = 'owner';
SELECT `id`, `enabled`, `time` FROM `horus_notification_settings` WHERE `id` = 'default';
