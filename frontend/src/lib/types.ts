import type { teams, members, requirements, requirementPool, requirementEvents, notificationLogs, notificationSettings } from "@/db/schema";
export type { Stage, RequirementEventType, PoolItemStatus } from "@/db/schema";
export type Team = typeof teams.$inferSelect;
export type Member = Omit<typeof members.$inferSelect, "passwordHash"> & { firstLogin: boolean };
export type Requirement = typeof requirements.$inferSelect;
/** 需求池条目：尚未进入研发流程的业务期望 / 待评估需求。 */
export type PoolItem = typeof requirementPool.$inferSelect;
export type RequirementEvent = typeof requirementEvents.$inferSelect;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NotificationSettings = Omit<typeof notificationSettings.$inferSelect, "webhook" | "signingSecret" | "pendingItems"> & { hasWebhook: boolean; hasSigningSecret: boolean; pendingCount: number };
export type WorkspaceData = {
  teams: Team[];
  members: Member[];
  requirements: Requirement[];
  pool: PoolItem[];
  /** 需求池可浏览的团队（业务负责人可浏览全部团队），用于筛选与团队名称展示。 */
  poolTeams: Team[];
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
export type FocusFilter = "all" | "new" | "blocked" | "overdue" | "overdue-all" | "history";
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
  /** IDs of requirements counted in `released`, ordered by actual release time descending. */
  releasedIds: number[];
  cancelled: number;
  /** Distinct requirements blocked at least once during this bucket. */
  blocked: number;
  /** Released requirements archived during this bucket (cancellations are counted separately). */
  archived: number;
  /** High-priority active requirements past their expected date at the bucket end. */
  overdue: number;
  /** Requirements released in this bucket after their expected date (all priorities). */
  lateReleased: number;
  /** High-priority subset of `lateReleased`. */
  lateReleasedHigh: number;
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
  /** IDs of requirements counted in `released`, ordered by actual release time descending. */
  releasedIds: number[];
  cancelled: number;
  blocked: number;
  archived: number;
  overdue: number;
  lateReleased: number;
  lateReleasedHigh: number;
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
  /** Distinct requirements referenced by bucket or team `releasedIds`, ordered by actual release time descending. */
  releasedItems: Requirement[];
  /** In-scope non-cancelled requirements without an expected launch date; excluded from expectedRatio. */
  missingExpected: number;
  /** True when historical lifecycle or blocker data had to be reconstructed. */
  hasEstimates: boolean;
};
