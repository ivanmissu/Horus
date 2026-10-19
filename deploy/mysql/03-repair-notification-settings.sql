-- 已有数据库的幂等修复：不修改账号、密码、Webhook 或已有的非空待发送摘要。
-- 请先选择 Horus 所用数据库，并确认 horus_notification_settings 表已存在。
INSERT INTO `horus_notification_settings` (`id`, `pending_items`)
VALUES ('default', JSON_ARRAY())
ON DUPLICATE KEY UPDATE `id` = 'default';

UPDATE `horus_notification_settings`
SET `pending_items` = JSON_ARRAY()
WHERE `id` = 'default'
  AND (`pending_items` IS NULL OR JSON_TYPE(`pending_items`) = 'NULL');

SELECT `id`, JSON_TYPE(`pending_items`) AS `pending_items_type`,
       JSON_LENGTH(`pending_items`) AS `pending_count`
FROM `horus_notification_settings` WHERE `id` = 'default';
