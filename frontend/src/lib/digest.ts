import { daysOverdue, isAnyOverdue, PRIORITY_LABELS } from "./domain.ts";
import type { Requirement, Team } from "./types.ts";

/** Neutralize Markdown/control characters before a value is embedded in a DingTalk message. */
export const clean = (value: string) => value.replace(/[\r\n]/g, " ").replace(/([*\[\]<>])/g, "\\$1");

/**
 * Build the daily DingTalk digest: 卡点 + 逾期 of **any** priority.
 *
 * 逾期 here deliberately does not reuse the workbench's 高优逾期 rule — every requirement past its
 * expected 上线/完成 date has to reach the group, so the priority is spelled out in the line instead
 * of used to filter requirements away.
 */
export function composeDigest(active: Requirement[], allTeams: Team[], today: string, pendingItems: string[], appLink: string) {
  const blockedCount = active.filter(r => r.blocked).length;
  const overdueCount = active.filter(r => isAnyOverdue(r, today)).length;
  const items = active.filter(r => r.blocked || isAnyOverdue(r, today)).map(r => {
    const team = allTeams.find(t => t.id === r.teamId)?.name || "";
    const notes = [r.blocked ? `卡点：${clean(r.blockReason)}` : "", isAnyOverdue(r, today) ? `逾期 ${daysOverdue(r.expectedDate!, today)} 天 · 优先级：${PRIORITY_LABELS[r.priority]}（期望上线/完成 ${r.expectedDate}）` : ""].filter(Boolean).join("；");
    return `- **${clean(r.title)}** · ${clean(team)}\n  ${notes} · 负责人：${clean(r.owner || "未指定")}`;
  });
  const merged = [...new Set([...pendingItems, ...items])];
  const title = `Horus 每日异常摘要 · ${today}`;
  const markdown = `## ${title}\n\n> ${blockedCount} 项卡点 · ${overdueCount} 项逾期${pendingItems.length ? " · 含上次未送达摘要" : ""}\n\n${merged.length ? merged.join("\n\n") : "所有需求有序推进，暂无卡点或逾期。"}${appLink ? `\n\n[打开 Horus 工作台](${appLink})` : ""}`;
  return { title, markdown, blockedCount, overdueCount, merged };
}
