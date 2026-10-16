import { db } from "@/db";
import { teams, members, requirements, notificationSettings, notificationLogs } from "@/db/schema";
import { asc, desc } from "drizzle-orm";
import { getActor, publicMember } from "./auth";
import type { WorkspaceData } from "./types";

export async function loadWorkspace(): Promise<WorkspaceData> {
  const { actor, demo } = await getActor();
  const [allTeams, allMembers, allRequirements, [settings], logs] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.createdAt)),
    db.select().from(members).orderBy(asc(members.createdAt)),
    db.select().from(requirements).orderBy(asc(requirements.id)),
    db.select().from(notificationSettings).limit(1),
    actor.role === "owner" ? db.select().from(notificationLogs).orderBy(desc(notificationLogs.createdAt)).limit(20) : Promise.resolve([]),
  ]);
  const { webhook, signingSecret, pendingItems, ...safeSettings } = settings;
  return {
    teams: allTeams, members: allMembers.map(publicMember), requirements: allRequirements,
    settings: { ...safeSettings, hasWebhook: !!webhook, hasSigningSecret: !!signingSecret, pendingCount: pendingItems.length },
    logs, actor, demo, now: new Date().toISOString(),
  };
}
