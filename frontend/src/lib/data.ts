import { and, asc, desc, eq, sql } from "drizzle-orm";
import { databaseDialect, db } from "@/db";
import { auditLogs, teams, members, requirements, notificationSettings, notificationLogs } from "@/db/schema";
import { getActor, publicMember } from "./auth";
import { canViewTeam } from "./domain";
import { isPreviewMode } from "./preview";
import { previewWorkspace } from "./preview-data";
import { normalizePendingItems } from "./notification-settings";
import { AppError } from "./auth";
import type { RequirementDateChange, WorkspaceData } from "./types";

/**
 * Audit rows written by `updateRequirement` carry `detail.dateChange` only when
 * the expected date actually moved. Filtering in SQL keeps the workspace payload
 * proportional to real adjustments instead of every field edit ever saved.
 * Both expressions avoid `?`, which MySQL would treat as a placeholder.
 */
const dateChangeExists = databaseDialect === "postgres"
  ? sql`jsonb_exists(${auditLogs.detail}, 'dateChange')`
  : sql`json_extract(${auditLogs.detail}, '$.dateChange') is not null`;

type DateChangeDetail = {
  from?: unknown;
  to?: unknown;
  reason?: unknown;
};

function calendarDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  if (isPreviewMode()) return previewWorkspace();
  const { actor, demo } = await getActor();
  const [allTeams, allMembers, allRequirements, [settings], logs, changeLogs] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.createdAt)),
    db.select().from(members).orderBy(asc(members.createdAt)),
    db.select().from(requirements).orderBy(asc(requirements.id)),
    db.select().from(notificationSettings).limit(1),
    actor.role === "owner" ? db.select().from(notificationLogs).orderBy(desc(notificationLogs.createdAt)).limit(20) : Promise.resolve([]),
    db.select({
      id: auditLogs.id,
      requirementId: auditLogs.requirementId,
      actorId: auditLogs.actorId,
      detail: auditLogs.detail,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(and(eq(auditLogs.action, "updateRequirement"), dateChangeExists)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)),
  ]);
  if (!settings) throw new AppError("通知设置尚未初始化，请联系管理员执行数据库初始化", 503);
  const { webhook, signingSecret, pendingItems, ...safeSettings } = settings;
  // 负责人看全部；产品经理与观察员只看绑定团队的团队与需求，成员列表保留负责人及同团队成员。
  const visibleTeams = allTeams.filter(team => canViewTeam(actor, team.id));
  const visibleRequirements = allRequirements.filter(item => canViewTeam(actor, item.teamId));
  const visibleMembers = allMembers.filter(member => actor.role === "owner" || member.role === "owner" || member.id === actor.id || member.teamIds.some(id => actor.teamIds.includes(id)));
  const visibleIds = new Set(visibleRequirements.map(item => item.id));
  // 操作人姓名按全量成员解析（停用成员也保留姓名），避免按可见成员过滤后历史记录只剩「系统」。
  const memberNames = new Map(allMembers.map(member => [member.id, member.name]));
  const dateChanges: RequirementDateChange[] = [];
  for (const row of changeLogs) {
    if (row.requirementId === null || !visibleIds.has(row.requirementId)) continue;
    const detail = (row.detail as { dateChange?: DateChangeDetail } | null)?.dateChange;
    if (!detail || typeof detail.reason !== "string" || !detail.reason.trim()) continue;
    const fromDate = calendarDate(detail.from);
    const toDate = calendarDate(detail.to);
    if (fromDate === toDate) continue;
    dateChanges.push({
      id: row.id,
      requirementId: row.requirementId,
      fromDate,
      toDate,
      reason: detail.reason,
      actorId: row.actorId,
      actorName: memberNames.get(row.actorId) ?? "系统",
      createdAt: row.createdAt,
    });
  }
  return {
    teams: visibleTeams, members: visibleMembers.map(publicMember), requirements: visibleRequirements, dateChanges,
    settings: { ...safeSettings, hasWebhook: !!webhook, hasSigningSecret: !!signingSecret, pendingCount: normalizePendingItems(pendingItems).length },
    logs, actor, demo, embeddedAuth: process.env.HORUS_EMBEDDED_PREVIEW === "true", now: new Date().toISOString(),
  };
}
