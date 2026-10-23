import type { teams, members, requirements, requirementEvents, notificationLogs, notificationSettings } from "@/db/schema";
export type { Stage, RequirementEventType } from "@/db/schema";
export type Team = typeof teams.$inferSelect;
export type Member = Omit<typeof members.$inferSelect, "passwordHash"> & { firstLogin: boolean };
export type Requirement = typeof requirements.$inferSelect;
export type RequirementEvent = typeof requirementEvents.$inferSelect;
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
  /** Explicit read-only, database-free local preview. Never enabled in production. */
  preview?: boolean;
  /** JS-readable session transport, enabled only in Arena's disposable iframe preview. */
  embeddedAuth?: boolean;
  now: string;
};
export type FocusFilter = "all" | "new" | "blocked" | "overdue" | "overdue-all";
export type StatsGranularity = "week" | "month";
export type StatsBucket = {
  key: string;
  label: string;
  shortLabel: string;
  /** Inclusive start, ISO timestamp (Monday 00:00 or first day of month, Asia/Shanghai). */
  start: string;
  /** Exclusive end, ISO timestamp. The current bucket ends in the future. */
  end: string;
  current: boolean;
  created: number;
  released: number;
  cancelled: number;
  /** Distinct requirements blocked at least once during this bucket. */
  blocked: number;
  /** Released requirements archived during this bucket (cancellations are counted separately). */
  archived: number;
  /** High-priority active requirements past their expected date at the bucket end. */
  overdue: number;
  /** Unarchived requirements (active + released awaiting archive) at the bucket end. */
  stock: number;
  /** created - cancelled - archived within the bucket. */
  net: number;
  /** released / created, or null when nothing was created. */
  releaseRatio: number | null;
  /** Non-cancelled requirements whose expected launch date falls in the bucket and has already arrived (as of the bucket end / now). */
  expectedDue: number;
  /** Of `expectedDue`, those actually launched on or before their expected launch date (launch day itself counts). */
  expectedMet: number;
  /** expectedMet / expectedDue, or null when nothing is due yet. */
  expectedRatio: number | null;
};
export type StatsTeamRow = {
  teamId: string;
  name: string;
  color: string;
  created: number;
  released: number;
  cancelled: number;
  blocked: number;
  archived: number;
  overdue: number;
  stock: number;
  /** On-time launch metrics over the visible range, per team. */
  expectedDue: number;
  expectedMet: number;
  expectedRatio: number | null;
};
export type StatsData = {
  granularity: StatsGranularity;
  periods: number;
  generatedAt: string;
  from: string;
  to: string;
  current: StatsBucket;
  previous: StatsBucket | null;
  buckets: StatsBucket[];
  /** Aggregate flows across the whole visible range, with stock/overdue as of now. */
  range: StatsBucket;
  teams: StatsTeamRow[];
  /** In-scope non-cancelled requirements without an expected launch date; excluded from expectedRatio. */
  missingExpected: number;
  /** True when historical lifecycle or blocker data had to be reconstructed. */
  hasEstimates: boolean;
};
