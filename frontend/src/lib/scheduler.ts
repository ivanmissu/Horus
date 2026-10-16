import { db } from "@/db";
import { notificationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { todayString } from "./domain";
import { sendDigest } from "./notifications";

const globalScheduler = globalThis as typeof globalThis & { horusScheduler?: ReturnType<typeof setInterval> };
export function startScheduler() {
  if (globalScheduler.horusScheduler) return;
  const tick = async () => {
    try {
      const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, "default"));
      if (!settings?.enabled || !settings.webhook || settings.lastRunDate === todayString()) return;
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      if (time >= settings.time) await sendDigest(true);
    } catch { /* Database may be bootstrapping. Retry on the next minute. */ }
  };
  globalScheduler.horusScheduler = setInterval(tick, 60000);
  globalScheduler.horusScheduler.unref();
  const initial = setTimeout(tick, 5000);
  initial.unref();
}
