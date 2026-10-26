import type { teams, members, requirements, requirementEvents, notificationLogs, notificationSettings } from "@/db/schema";
export type { Stage, RequirementEventType } from "@/db/schema";
export type Team = typeof teams.$inferSelect;
export type Member = Omit<typeof members.$inferSelect, "passwordHash"> & { firstLogin: boolean };
export type Requirement = typeof requirements.$inferSelect;
export type RequirementEvent = typeof requirementEvents.$inferSelect;
/**
 * 期望上线/完成日期的一次调整，来源是审计日志里带 `dateChange` 的编辑记录。
 * 旧数据没有该字段，因此只展示本功能上线后的调整。
 */
export type RequirementDateChange = {
  /** 审计日志 ID，用作列表 key。 */
  id: number;
  requirementId: number;
  fromDate: string | null;
  toDate: string | null;
  reason: string;
  actorId: string;
  /** 加载时解析出的操作人姓名；账号不存在时回退为「系统」。 */
  actorName: string;
  createdAt: string;
};
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NotificationSettings = Omit<typeof notificationSettings.$inferSelect, "webhook" | "signingSecret" | "pendingItems"> & { hasWebhook: boolean; hasSigningSecret: boolean; pendingCount: number };
export type WorkspaceData = {
  teams: Team[];
  members: Member[];
  requirements: Requirement[];
  /** 期望日期调整记录（按修改时间倒序），用于详情历史与列表「日期调整」标记。 */
  dateChanges: RequirementDateChange[];
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
  /** In-scope non-cancelled requirements without an expected launch date; excluded from expectedRatio. */
  missingExpected: number;
  /** True when historical lifecycle or blocker data had to be reconstructed. */
  hasEstimates: boolean;
};
