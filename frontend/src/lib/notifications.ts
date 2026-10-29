import { createHmac } from "node:crypto";
import { db } from "@/db";
import { requirements, teams, notificationSettings, notificationLogs } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";
import { claimScheduledDigest } from "./digest-claim.ts";
import { composeDigest } from "./digest.ts";
import { todayString } from "./domain";
import { normalizePendingItems } from "./notification-settings";
import { AppError } from "./auth";

export function validateWebhook(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.pathname !== "/robot/send" || !url.searchParams.get("access_token") || url.port || url.username || url.password) throw new Error();
    return url;
  } catch { throw new AppError("请输入有效的钉钉机器人 Webhook（https://oapi.dingtalk.com/robot/send?access_token=…）"); }
}
export type DigestResult = { sent: boolean; skipped?: boolean; message: string };
let manualSending: Promise<DigestResult> | undefined;
let scheduledSending: Promise<DigestResult> | undefined;

export function sendDigest(scheduled = false) {
  if (scheduled) {
    if (scheduledSending) return scheduledSending;
    scheduledSending = deliver(true).finally(() => { scheduledSending = undefined; });
    return scheduledSending;
  }
  if (manualSending) return manualSending;
  manualSending = deliver(false).finally(() => { manualSending = undefined; });
  return manualSending;
}

function deliveryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith("机器人返回")) return error.message;
  if (error instanceof AppError) return error.message;
  return "网络连接失败或请求超时，请检查机器人配置";
}

async function recordDeliveryFailure(merged: string[], pendingArchiveCount: number, error: unknown, scheduled: boolean, today: string) {
  const message = deliveryErrorMessage(error);
  const archiveSuffix = pendingArchiveCount > 0 ? ` · ${pendingArchiveCount} 项待归档` : "";
  console.error(`Horus digest delivery failed (${scheduled ? "scheduled" : "manual"}, ${merged.length} items${pendingArchiveCount > 0 ? `, ${pendingArchiveCount} pending archive` : ""}): ${message}`);
  try {
    await db.transaction(async tx => {
      await tx.insert(notificationLogs).values({ status: "failed", summary: `${merged.length} 项异常摘要${archiveSuffix}待重试`, error: message });
      await tx.update(notificationSettings).set({ pendingItems: merged, ...(scheduled ? { lastRunDate: today } : {}) }).where(eq(notificationSettings.id, "default"));
    });
  } catch (logError) {
    console.error("Horus digest failure log could not be saved", logError instanceof Error ? logError.message : logError);
  }
}

async function deliver(scheduled: boolean): Promise<DigestResult> {
  const today = todayString();
  if (scheduled) {
    const claimed = await claimScheduledDigest(today);
    if (!claimed) return { sent: false, skipped: true, message: "今日定时摘要已执行或尚未满足发送条件" };
    console.info(`Horus claimed the daily digest for ${today}`);
  }
  const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, "default"));
  if (!settings?.webhook) {
    const error = new AppError("请先保存钉钉机器人 Webhook");
    if (!scheduled) throw error;
    await recordDeliveryFailure([], 0, error, true, today);
    return { sent: false, message: "本次未送达，已记录日志，将在下次定时推送时合并重试" };
  }
  const [unarchived, allTeams] = await Promise.all([
    db.select().from(requirements).where(isNull(requirements.archivedAt)).orderBy(asc(requirements.id)),
    db.select().from(teams).orderBy(asc(teams.createdAt)),
  ]);
  const pendingItems = normalizePendingItems(settings.pendingItems);
  const { title, markdown, pendingArchiveCount, merged } = composeDigest(unarchived, allTeams, today, pendingItems, settings.appUrl || process.env.APP_URL || "");
  const archiveSuffix = pendingArchiveCount > 0 ? ` · ${pendingArchiveCount} 项待归档` : "";
  try {
    const url = validateWebhook(settings.webhook);
    if (settings.signingSecret) {
      const timestamp = String(Date.now());
      const sign = createHmac("sha256", settings.signingSecret).update(`${timestamp}\n${settings.signingSecret}`).digest("base64");
      url.searchParams.set("timestamp", timestamp);
      url.searchParams.set("sign", sign);
    }
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msgtype: "markdown", markdown: { title, text: markdown }, at: { isAtAll: false } }), signal: AbortSignal.timeout(10000), redirect: "error" });
    const result = await response.json();
    if (!response.ok || result.errcode !== 0) throw new Error(`机器人返回错误代码 ${result.errcode ?? response.status}`);
    await db.transaction(async tx => {
      await tx.insert(notificationLogs).values({ status: "success", summary: `已送达 ${merged.length} 项异常摘要${archiveSuffix}` });
      await tx.update(notificationSettings).set({ pendingItems: [], ...(scheduled ? { lastRunDate: today } : {}) }).where(eq(notificationSettings.id, "default"));
    });
    if (scheduled) console.info(`Horus daily digest delivered (${merged.length} items${pendingArchiveCount > 0 ? `, ${pendingArchiveCount} pending archive` : ""})`);
    return { sent: true, message: "异常摘要已发送至钉钉群" };
  } catch (error) {
    await recordDeliveryFailure(merged, pendingArchiveCount, error, scheduled, today);
    return { sent: false, message: "本次未送达，已记录日志，将在下次定时推送时合并重试" };
  }
}
