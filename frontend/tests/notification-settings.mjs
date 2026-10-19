import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePendingItems } from "../src/lib/notification-settings.ts";

for (const value of [null, undefined, "null", {}, 0]) {
  assert.deepEqual(normalizePendingItems(value), []);
}
assert.deepEqual(normalizePendingItems([]), []);
assert.deepEqual(normalizePendingItems(["待重试摘要", null, 1, "另一条摘要"]), ["待重试摘要", "另一条摘要"]);
const sql = readFileSync(new URL("../../deploy/mysql/02-init-owner.sql", import.meta.url), "utf8");
assert.match(sql, /INSERT IGNORE INTO `horus_notification_settings` \(`id`, `pending_items`\) VALUES \('default', JSON_ARRAY\(\)\)/);
console.log("Notification settings null compatibility and SQL initialization tests passed");
