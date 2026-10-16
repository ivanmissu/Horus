import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";
import { notificationSettings } from "../src/db/schema.ts";
import { claimScheduledDigest } from "../src/lib/digest-claim.ts";
import { todayString } from "../src/lib/domain.ts";

if (!process.env.DATABASE_URL) {
  console.log("SKIP digest claim checks: DATABASE_URL is not set");
  process.exit(0);
}

const id = `qa-claim-${Date.now().toString(36)}`;
const today = todayString();
try {
  await db.insert(notificationSettings).values({
    id,
    enabled: true,
    time: "09:30",
    webhook: "https://oapi.dingtalk.com/robot/send?access_token=acceptance",
    signingSecret: "",
    appUrl: "http://localhost:3000",
    lastRunDate: null,
    pendingItems: ["stale"],
  });
  const claims = await Promise.all([claimScheduledDigest(today, id), claimScheduledDigest(today, id)]);
  assert.equal(claims.filter(Boolean).length, 1, "exactly one concurrent claim must win");
  const [claimed] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, id));
  assert.equal(claimed.lastRunDate, today);
  assert.deepEqual(claimed.pendingItems, ["stale"], "claim must not clear pending retries");
  assert.equal(await claimScheduledDigest(today, id), false);

  await db.update(notificationSettings).set({ enabled: false, lastRunDate: null }).where(eq(notificationSettings.id, id));
  assert.equal(await claimScheduledDigest(today, id), false, "disabled settings cannot be claimed");
  await db.update(notificationSettings).set({ enabled: true, webhook: "", lastRunDate: null }).where(eq(notificationSettings.id, id));
  assert.equal(await claimScheduledDigest(today, id), false, "empty webhook cannot be claimed");
  console.log("DIGEST CLAIM TESTS PASSED");
} finally {
  await db.delete(notificationSettings).where(eq(notificationSettings.id, id));
  await pool.end();
}
