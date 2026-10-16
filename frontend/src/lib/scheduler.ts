import { db } from "@/db";
import { notificationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { shanghaiClock, todayString } from "./domain";
import { sendDigest } from "./notifications";
import { purgeExpiredSessions } from "./sessions";

const globalScheduler = globalThis as typeof globalThis & { horusScheduler?: ReturnType<typeof setInterval> };

function logFailure(scope: string, error: unknown) {
  console.error(`Horus ${scope} failed`, error instanceof Error ? error.message : error);
}

async function tick() {
  try {
    await purgeExpiredSessions();
  } catch (error) {
    logFailure("expired session cleanup", error);
  }
  try {
    const [settings] = await db.select({
      enabled: notificationSettings.enabled,
      webhook: notificationSettings.webhook,
      time: notificationSettings.time,
      lastRunDate: notificationSettings.lastRunDate,
    }).from(notificationSettings).where(eq(notificationSettings.id, "default"));
    if (!settings?.enabled || !settings.webhook || settings.lastRunDate === todayString()) return;
    if (shanghaiClock() < settings.time) return;
    const result = await sendDigest(true);
    if (result.skipped || result.sent) return;
    console.error(`Horus scheduled digest was not delivered: ${result.message}`);
  } catch (error) {
    logFailure("scheduler tick", error);
  }
}

export function startScheduler() {
  if (globalScheduler.horusScheduler) return;
  globalScheduler.horusScheduler = setInterval(tick, 60_000);
  globalScheduler.horusScheduler.unref();
  const initial = setTimeout(tick, 5_000);
  initial.unref();
}
