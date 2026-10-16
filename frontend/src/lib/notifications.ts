import { createHmac } from "node:crypto";
import { db } from "@/db";
import { requirements, teams, notificationSettings, notificationLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isOverdue, todayString } from "./domain";
import { AppError } from "./auth";

export function validateWebhook(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.pathname !== "/robot/send" || !url.searchParams.get("access_token") || url.port || url.username || url.password) throw new Error();
    return url;
  } catch { throw new AppError("请输入有效的钉钉机器人 Webhook（https://oapi.dingtalk.com/robot/send?access_token=…）"); }
}
const clean = (value: string) => value.replace(/[\r\n]/g, " ").replace(/([*\[\]<>])/g, "\\$1");
let sending: Promise<{ sent: boolean; message: string }> | undefined;
export function sendDigest(scheduled = false) {
  if (sending) return sending;
  sending = deliver(scheduled).finally(() => { sending = undefined; });
  return sending;
}
async function deliver(scheduled: boolean) {
  const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, "default"));
  if (!settings?.webhook) throw new AppError("请先保存钉钉机器人 Webhook");
  const active = await db.select().from(requirements).where(eq(requirements.status, "active"));
  const allTeams = await db.select().from(teams);
  const relevant = active.filter(r => r.blocked || isOverdue(r));
  const items = relevant.map(r => {
    const team = allTeams.find(t => t.id === r.teamId)?.name || "";
    const notes = [r.blocked ? `卡点：${clean(r.blockReason)}` : "", isOverdue(r) ? `高优逾期（期望 ${r.expectedDate} 上线）` : ""].filter(Boolean).join("；");
    return `- **${clean(r.title)}** · ${clean(team)}\n  ${notes} · 负责人：${clean(r.owner || "未指定")}`;
  });
  const merged = [...new Set([...settings.pendingItems, ...items])];
  const title = `Horus 每日异常摘要 · ${todayString()}`;
  const appLink = settings.appUrl || process.env.APP_URL || "";
  const markdown = `## ${title}\n\n> ${active.filter(r => r.blocked).length} 项卡点 · ${active.filter(r => isOverdue(r)).length} 项高优逾期${settings.pendingItems.length ? " · 含上次未送达摘要" : ""}\n\n${merged.length ? merged.join("\n\n") : "所有需求有序推进，暂无卡点或高优逾期。"}${appLink ? `\n\n[打开 Horus 工作台](${appLink})` : ""}`;
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
      await tx.insert(notificationLogs).values({ status: "success", summary: `已送达 ${merged.length} 项异常摘要` });
      await tx.update(notificationSettings).set({ pendingItems: [], ...(scheduled ? { lastRunDate: todayString() } : {}) }).where(eq(notificationSettings.id, "default"));
    });
    return { sent: true, message: "异常摘要已发送至钉钉群" };
  } catch (error) {
    await db.transaction(async tx => {
      await tx.insert(notificationLogs).values({ status: "failed", summary: `${merged.length} 项异常摘要待重试`, error: error instanceof Error && error.message.startsWith("机器人返回") ? error.message : "网络连接失败或请求超时，请检查机器人配置" });
      await tx.update(notificationSettings).set({ pendingItems: merged, ...(scheduled ? { lastRunDate: todayString() } : {}) }).where(eq(notificationSettings.id, "default"));
    });
    return { sent: false, message: "本次未送达，已记录日志，将在下次定时推送时合并重试" };
  }
}
