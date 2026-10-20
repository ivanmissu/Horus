import { and, eq, isNull, sql } from "drizzle-orm";
import { databaseDialect, db } from "./index.ts";
import { auditLogs, requirementEvents, requirements } from "./schema.ts";
import { buildBackfillEvents } from "../lib/events.ts";

/**
 * Fills the explicit lifecycle timestamps for rows created before they existed.
 * Both statements are idempotent and only touch rows that are still null.
 */
export async function fillLifecycleTimestamps() {
  await db.update(requirements)
    .set({ releasedAt: sql`${requirements.enteredAt}` })
    .where(and(eq(requirements.status, "released"), isNull(requirements.releasedAt)));
  await db.update(requirements)
    .set({ cancelledAt: sql`${requirements.archivedAt}` })
    .where(and(eq(requirements.status, "cancelled"), isNull(requirements.cancelledAt)));
}

/**
 * One-time (and safe to repeat) reconstruction of lifecycle events.
 * Exact audit-log actions win; missing types fall back to requirement fields
 * and are stored with `estimated = true`.
 */
export async function backfillRequirementEvents() {
  const [allRequirements, logs] = await Promise.all([
    db.select().from(requirements),
    db.select({
      requirementId: auditLogs.requirementId,
      action: auditLogs.action,
      detail: auditLogs.detail,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs),
  ]);
  const events = buildBackfillEvents(allRequirements, logs);
  let inserted = 0;
  for (let index = 0; index < events.length; index += 200) {
    const chunk = events.slice(index, index + 200);
    const statement = db.insert(requirementEvents).values(chunk);
    if (databaseDialect === "postgres") await (statement as any).onConflictDoNothing();
    else await (statement as any).ignore();
    inserted += chunk.length;
  }
  return { requirements: allRequirements.length, events: inserted };
}

let baseline: Promise<void> | undefined;
/**
 * True when at least one requirement has no `created` event yet. This catches
 * both an empty event table and the partial state where new actions were
 * recorded before legacy rows were backfilled.
 */
async function hasUnbackfilledRequirements() {
  const [covered] = await db.select({ count: sql<number>`count(distinct ${requirementEvents.requirementId})` })
    .from(requirementEvents)
    .where(eq(requirementEvents.type, "created"));
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(requirements);
  return Number(covered?.count ?? 0) < Number(total?.count ?? 0);
}

/**
 * Runs once per server process on the first statistics request. The event
 * backfill must happen before timestamps are filled, otherwise derived events
 * would look exact and lose the `estimated` marker.
 */
export function ensureStatsBaseline() {
  if (!baseline) {
    baseline = (async () => {
      if (await hasUnbackfilledRequirements()) await backfillRequirementEvents();
      await fillLifecycleTimestamps();
    })().catch(error => {
      baseline = undefined;
      throw error;
    });
  }
  return baseline;
}
