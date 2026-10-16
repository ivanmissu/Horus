import type { teams, members, requirements, notificationLogs, notificationSettings } from "@/db/schema";
export type { Stage } from "@/db/schema";
export type Team = typeof teams.$inferSelect;
export type Member = Omit<typeof members.$inferSelect, "passwordHash"> & { firstLogin: boolean };
export type Requirement = typeof requirements.$inferSelect;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NotificationSettings = Omit<typeof notificationSettings.$inferSelect, "webhook" | "signingSecret" | "pendingItems"> & { hasWebhook: boolean; hasSigningSecret: boolean; pendingCount: number };
export type WorkspaceData = {
  teams: Team[];
  members: Member[];
  requirements: Requirement[];
  settings: NotificationSettings;
  logs: NotificationLog[];
  actor: Member;
  demo: boolean;
  now: string;
};
export type FocusFilter = "all" | "new" | "blocked" | "overdue";
