-- Horus V1 · PostgreSQL initial owner and notification settings.
-- The initial account has no password; the owner sets it on first login.

INSERT INTO "horus_members" (
  "id", "name", "username", "role", "team_ids", "password_hash", "active", "created_at"
)
VALUES (
  'owner', '团队负责人', 'admin', 'owner', '[]'::jsonb, NULL, TRUE,
  to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "horus_notification_settings" ("id", "pending_items")
VALUES ('default', '[]'::jsonb)
ON CONFLICT ("id") DO NOTHING;

SELECT "id", "username", "name", "role", "active", ("password_hash" IS NULL) AS "password_not_set"
FROM "horus_members" WHERE "id" = 'owner';
SELECT "id", "enabled", "time" FROM "horus_notification_settings" WHERE "id" = 'default';
