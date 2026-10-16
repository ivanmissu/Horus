import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "../db/index.ts";
import { notificationSettings } from "../db/schema.ts";

/**
 * Atomically claim today's scheduled digest.
 * InnoDB row locks make concurrent callers serialize: exactly one update matches
 * `last_run_date IS NULL OR last_run_date <> today` and flips it to today.
 * Relative imports keep this callable from Node's type-stripping test runner.
 */
export async function claimScheduledDigest(today: string, id = "default") {
  const updated = await db.update(notificationSettings).set({ lastRunDate: today }).where(and(
    eq(notificationSettings.id, id),
    eq(notificationSettings.enabled, true),
    ne(notificationSettings.webhook, ""),
    or(isNull(notificationSettings.lastRunDate), ne(notificationSettings.lastRunDate, today)),
  ));
  const header = (Array.isArray(updated) ? updated[0] : updated) as { affectedRows?: number };
  return Number(header?.affectedRows ?? 0) > 0;
}
