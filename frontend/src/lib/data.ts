import { db } from "@/db";
import { teams, members, requirements, notificationSettings, notificationLogs } from "@/db/schema";
import { asc, desc } from "drizzle-orm";
import { getActor, publicMember } from "./auth";
import { isPreviewMode } from "./preview";
import { previewWorkspace } from "./preview-data";
import { normalizePendingItems } from "./notification-settings";
import { AppError } from "./auth";
import type { WorkspaceData } from "./types";

export async function loadWorkspace(): Promise<WorkspaceData> {
  if (isPreviewMode()) return previewWorkspace();
  const { actor, demo } = await getActor();
  const [allTeams, allMembers, allRequirements, [settings], logs] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.createdAt)),
    db.select().from(members).orderBy(asc(members.createdAt)),
    db.select().from(requirements).orderBy(asc(requirements.id)),
    db.select().from(notificationSettings).limit(1),
    actor.role === "owner" ? db.select().from(notificationLogs).orderBy(desc(notificationLogs.createdAt)).limit(20) : Promise.resolve([]),
  ]);
  if (!settings) throw new AppError("通知设置尚未初始化，请联系管理员执行数据库初始化", 503);
  const { webhook, signingSecret, pendingItems, ...safeSettings } = settings;
  return {
    teams: allTeams, members: allMembers.map(publicMember), requirements: allRequirements,
    settings: { ...safeSettings, hasWebhook: !!webhook, hasSigningSecret: !!signingSecret, pendingCount: normalizePendingItems(pendingItems).length },
    logs, actor, demo, embeddedAuth: process.env.HORUS_EMBEDDED_PREVIEW === "true", now: new Date().toISOString(),
  };
}
