import { daysOverdue, isAnyOverdue, isHistoricalPendingArchive, PRIORITY_LABELS, startOfShanghaiDay, todayString } from "./domain.ts";
import type { Requirement, Team } from "./types.ts";

/** Neutralize Markdown/control characters before a value is embedded in a DingTalk message. */
export const clean = (value: string) => value.replace(/[\r\n]/g, " ").replace(/([*\[\]<>])/g, "\\$1");

export type TeamArchiveCount = { teamId: string; name: string; count: number };

/**
 * 按团队汇总「历史未归档」数量（本周一 00:00 北京时间前已上线但尚未归档）。
 * 仅返回数量 > 0 的团队，顺序与团队列表保持一致；全局为 0 时返回空数组。
 */
export function countPendingArchiveByTeam(allRequirements: Requirement[], allTeams: Team[], now: string | Date): TeamArchiveCount[] {
  const historical = allRequirements.filter(r => isHistoricalPendingArchive(r, now));
  if (!historical.length) return [];
  const counts = new Map<string, number>();
  for (const r of historical) {
    counts.set(r.teamId, (counts.get(r.teamId) ?? 0) + 1);
  }
  const result: TeamArchiveCount[] = [];
  const seen = new Set<string>();
  for (const team of allTeams) {
    const count = counts.get(team.id) ?? 0;
    if (count > 0) {
      result.push({ teamId: team.id, name: team.name, count });
      seen.add(team.id);
    }
  }
  for (const [teamId, count] of counts) {
    if (!seen.has(teamId) && count > 0) {
      result.push({ teamId, name: teamId || "未分配团队", count });
    }
  }
  return result;
}

/**
 * Build the daily DingTalk digest: 卡点 + 逾期 of **any** priority, plus per-team counts of
 * historical pending-archive requirements (count only, no requirement details; hidden when 0).
 *
 * 逾期 here deliberately does not reuse the workbench's 高优逾期 rule — every requirement past its
 * expected 上线/完成 date has to reach the group, so the priority is spelled out in the line instead
 * of used to filter requirements away.
 */
export function composeDigest(allRequirements: Requirement[], allTeams: Team[], today: string, pendingItems: string[], appLink: string) {
  const refNow = /^\d{4}-\d{2}-\d{2}$/.test(today) ? new Date(`${today}T00:00:00+08:00`) : startOfShanghaiDay(today);
  // 下周待启动的需求尚未真正进入流程，不进入摘要（按下周一 09:00 的北京日期判断）。
  const notStarted = (r: Requirement) => {
    const created = new Date(r.createdAt);
    return Number.isFinite(created.getTime()) && todayString(created) > today;
  };
  // Only active requirements can create detail alerts. Historical released items awaiting
  // archive are reported only as per-team counts, never as individual detail lines.
  const current = allRequirements.filter(r => r.status === "active" && !notStarted(r));
  const blockedCount = current.filter(r => r.blocked).length;
  const overdueCount = current.filter(r => isAnyOverdue(r, today)).length;
  const items = current.filter(r => r.blocked || isAnyOverdue(r, today)).map(r => {
    const team = allTeams.find(t => t.id === r.teamId)?.name || "";
    const notes = [r.blocked ? `卡点：${clean(r.blockReason)}` : "", isAnyOverdue(r, today) ? `逾期 ${daysOverdue(r.expectedDate!, today)} 天 · 优先级：${PRIORITY_LABELS[r.priority]}（期望上线/完成 ${r.expectedDate}）` : ""].filter(Boolean).join("；");
    return `- **${clean(r.title)}** · ${clean(team)}\n  ${notes} · 负责人：${clean(r.owner || "未指定")}`;
  });
  const pendingArchiveTeams = countPendingArchiveByTeam(allRequirements, allTeams, refNow);
  const pendingArchiveCount = pendingArchiveTeams.reduce((sum, item) => sum + item.count, 0);
  const archiveHeader = pendingArchiveCount > 0 ? ` · ${pendingArchiveCount} 项待归档` : "";
  const archiveSection = pendingArchiveCount > 0
    ? `\n\n**待归档**：${pendingArchiveTeams.map(item => `${clean(item.name)} ${item.count} 项`).join(" · ")}`
    : "";
  const merged = [...new Set([...pendingItems, ...items])];
  const title = `Horus 每日异常摘要 · ${today}`;
  const markdown = `## ${title}\n\n> ${blockedCount} 项卡点 · ${overdueCount} 项逾期${archiveHeader}${pendingItems.length ? " · 含上次未送达摘要" : ""}\n\n${merged.length ? merged.join("\n\n") : "所有需求有序推进，暂无卡点或逾期。"}${archiveSection}${appLink ? `\n\n[打开 Horus 工作台](${appLink})` : ""}`;
  return { title, markdown, blockedCount, overdueCount, pendingArchiveCount, pendingArchiveTeams, merged };
}
