-- ============================================================================
-- Horus V1 · 「需求周期」升级脚本（MySQL 8.0）
-- ----------------------------------------------------------------------------
-- 适用：已按旧版 01-schema.sql 建库、且要升级到带「需求周期」的版本。
--       新库请直接执行 01-schema.sql（已包含该列），不要执行本脚本。
-- 注意：本脚本是一次性升级脚本，重复执行会因列已存在而报错。
-- 说明：存量需求默认记为「本周」，创建时间保持不变。
-- ============================================================================

ALTER TABLE `horus_requirements`
  ADD COLUMN `requirement_cycle` varchar(16) NOT NULL DEFAULT 'this' AFTER `expected_date`;

UPDATE `horus_requirements`
   SET `requirement_cycle` = 'this'
 WHERE `requirement_cycle` IS NULL;
