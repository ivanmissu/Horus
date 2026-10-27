import type { Requirement, Stage } from "./types";
export const DEFAULT_STAGES: Stage[] = [
  { id: "review", name: "需求评审" },
  { id: "design", name: "技术方案设计" },
  { id: "development", name: "开发完成" },
  { id: "integration", name: "联调完成" },
  { id: "qa", name: "提测" },
  { id: "approved", name: "测试通过" },
  { id: "staging", name: "预发布验证" },
  { id: "released", name: "正式上线" },
];
export const PRIORITIES = { high: "高优先级", medium: "中优先级", low: "低优先级" };
/** Compact priority label for one-line contexts (DingTalk digest, previews). */
export const PRIORITY_LABELS: Record<Requirement["priority"], string> = { high: "高", medium: "中", low: "低" };
/** Priority assumed by the 新建需求 form and by `createRequirement` when the client omits it. */
export const DEFAULT_PRIORITY: Requirement["priority"] = "high";
/**
 * 需求周期：创建时必选的本周/下周意向。
 * 「本周」立即创建；「下周」把创建时间落到下周一 09:00（北京时间），
 * 在此之前需求处于「下周待启动」，不计入本周新建/卡点/逾期等指标。
 */
export type RequirementCycle = "this" | "next";
export type CycleBucket = "last" | "this" | "next";
export const REQUIREMENT_CYCLES: Record<RequirementCycle, string> = { this: "本周", next: "下周" };
export const DEFAULT_REQUIREMENT_CYCLE: RequirementCycle = "this";
/** 需求周期筛选包含上周，因此比 {@link REQUIREMENT_CYCLES} 多一档。 */
export const CYCLE_FILTER_LABELS: Record<CycleBucket, string> = { last: "上周", this: "本周", next: "下周" };
/** 上线周期按期望上线/完成日期落在本周或下周判断。 */
export const LAUNCH_CYCLE_LABELS: Record<Exclude<CycleBucket, "last">, string> = { this: "本周", next: "下周" };
/** 下周一 09:00（北京时间）—— 选「下周」时的创建时间。 */
export function nextWeekMorning(now: string | Date = new Date()) {
  return new Date(`${todayString(addDays(startOfShanghaiWeek(now), 7))}T09:00:00+08:00`);
}
/** 需求创建时间：本周 = 当前时间，下周 = 下周一 09:00。 */
export function creationTimeForCycle(cycle: RequirementCycle | string, now: string | Date = new Date()) {
  return (cycle === "next" ? nextWeekMorning(now) : new Date(now)).toISOString();
}
/** 已排到下周、创建时间尚未到来：展示为「下周待启动」，不参与本周风险统计。 */
export function isScheduled(r: Pick<Requirement, "createdAt">, now: string | Date = new Date()) {
  return new Date(r.createdAt).getTime() > new Date(now).getTime();
}
/** 需求周期筛选：按创建时间所属自然周（周一 00:00 北京时间）分档。 */
export function cycleOf(r: Pick<Requirement, "createdAt">, now: string | Date = new Date()): CycleBucket | null {
  const created = new Date(r.createdAt).getTime();
  const weekStart = startOfShanghaiWeek(now).getTime();
  const week = 7 * DAY_MS;
  if (created >= weekStart + week) return "next";
  if (created >= weekStart) return "this";
  if (created >= weekStart - week) return "last";
  return null;
}
/** 上线周期筛选：期望上线/完成日期落在本周或下周一~周日。 */
export function launchCycleOf(r: Pick<Requirement, "expectedDate">, now: string | Date = new Date()) {
  if (!r.expectedDate) return null;
  const date = r.expectedDate.slice(0, 10);
  const weekStart = startOfShanghaiWeek(now);
  const thisStart = todayString(weekStart);
  const nextStart = todayString(addDays(weekStart, 7));
  const afterNext = todayString(addDays(weekStart, 14));
  if (date >= thisStart && date < nextStart) return "this" as const;
  if (date >= nextStart && date < afterNext) return "next" as const;
  return null;
}
const DAY_MS = 86400000;
/** Asia/Shanghai is UTC+8 all year, so fixed-offset arithmetic is safe. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
export function todayString(now: string | Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
export function shanghaiClock(now: string | Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = parts.find(part => part.type === "hour")?.value ?? "00";
  const minute = parts.find(part => part.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
/** 00:00 of the Shanghai calendar day containing `now`. */
export function startOfShanghaiDay(now: string | Date = new Date()) {
  return new Date(`${todayString(now)}T00:00:00+08:00`);
}
/** Monday 00:00 (Asia/Shanghai) of the natural week containing `now`. */
export function startOfShanghaiWeek(now: string | Date = new Date()) {
  const dayStart = startOfShanghaiDay(now);
  // getUTCDay() on the plain calendar date avoids local-machine timezone drift.
  const weekday = new Date(`${todayString(now)}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return new Date(dayStart.getTime() - ((weekday + 6) % 7) * DAY_MS);
}
/** Sunday of the natural week containing `now` (weeks run Monday..Sunday). */
export function endOfShanghaiWeek(now: string | Date = new Date()) {
  return addDays(startOfShanghaiWeek(now), 6);
}
/** First day 00:00 (Asia/Shanghai) of the natural month containing `now`. */
export function startOfShanghaiMonth(now: string | Date = new Date()) {
  return new Date(`${todayString(now).slice(0, 7)}-01T00:00:00+08:00`);
}
export function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}
export function addMonths(value: Date, months: number) {
  const ymd = todayString(value);
  const year = Number(ymd.slice(0, 4));
  const monthIndex = Number(ymd.slice(5, 7)) - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  return new Date(`${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-01T00:00:00+08:00`);
}
export function shortDate(value: string | null) {
  if (!value) return "未填期望上线/完成日期";
  const date = value.slice(0, 10).split("-");
  return `${date[1]}.${date[2]}`;
}
/** Inclusive display range from two Shanghai calendar dates (YYYY-MM-DD). */
export function dateRangeLabel(start: string, end: string) {
  return `${shortDate(start)} – ${shortDate(end)}`;
}
/** A requirement leaves every in-flight view only once it has been archived. */
export function isArchived(r: Pick<Requirement, "archivedAt">) {
  return !!r.archivedAt;
}
export function isInFlight(r: Pick<Requirement, "archivedAt">) {
  return !r.archivedAt;
}
/** Released requirements stay in the in-flight lists until an owner archives them manually. */
export function canArchive(r: Pick<Requirement, "status" | "archivedAt">) {
  return r.status === "released" && !r.archivedAt;
}
/** 实际上线时间；旧数据缺少 releasedAt 时用进入末阶段的 enteredAt 估算（与逾期上线、统计口径一致）。 */
export function releaseTimeOf(r: Pick<Requirement, "releasedAt" | "enteredAt">) {
  return r.releasedAt || r.enteredAt || null;
}
/**
 * 历史未归档：已上线未归档，且实际上线时间早于本周一 00:00（北京时间）。
 * 本周内上线的待归档仍留在主列表；到下周一自动转入历史。无上线时间可考时不判历史，避免误删主列表。
 */
export function isHistoricalPendingArchive(
  r: Pick<Requirement, "status" | "archivedAt" | "releasedAt" | "enteredAt">,
  now: string | Date = new Date(),
) {
  if (!canArchive(r)) return false;
  const releasedAt = releaseTimeOf(r);
  if (!releasedAt) return false;
  return new Date(releasedAt).getTime() < startOfShanghaiWeek(now).getTime();
}
/**
 * 主列表在途：未归档且非历史未归档（仍含下周待启动与本周已上线待归档）。
 * 工作台 / 团队详情 / 所有需求的主列表与相关在途计数用此口径；{@link isInFlight} 本身不变，统计页仍按未归档计存量。
 */
export function isMainInFlight(
  r: Pick<Requirement, "status" | "archivedAt" | "releasedAt" | "enteredAt">,
  now: string | Date = new Date(),
) {
  return isInFlight(r) && !isHistoricalPendingArchive(r, now);
}
/**
 * 「本周新建」= created in the current natural week (Monday 00:00 Asia/Shanghai .. now)
 * and not cancelled. Released and archived requirements stay included; cancelled
 * requirements are excluded from the workbench count (unlike statistics, which keeps them).
 */
export function isNew(r: Pick<Requirement, "status" | "createdAt">, now: string | Date = new Date()) {
  const created = new Date(r.createdAt).getTime();
  const current = new Date(now).getTime();
  return r.status !== "cancelled" && created >= startOfShanghaiWeek(now).getTime() && created <= current;
}
/** Only this-week active requirements still at the 「需求评审」 stage show the row/detail 「新建」 badge. */
export function showNewBadge(
  r: Pick<Requirement, "status" | "createdAt" | "stageId">,
  stages: Stage[] | undefined,
  now: string | Date = new Date(),
) {
  if (r.status !== "active" || !isNew(r, now)) return false;
  const stage = stages?.find(item => item.id === r.stageId);
  return stage ? stage.name === "需求评审" : r.stageId === "review";
}
/**
 * 逾期（不限优先级）: still in flight but already past the expected date.
 * Released/cancelled requirements never count, and a missing expected date is never a violation.
 */
export function isAnyOverdue(r: Pick<Requirement, "status" | "expectedDate" | "createdAt">, now: string | Date = new Date()) {
  // 下周待启动的需求还没有真正进入流程，不参与逾期判断。
  return r.status === "active" && !isScheduled(r, now) && !!r.expectedDate && r.expectedDate < todayString(now);
}
/** 已上线但实际上线日期晚于期望日期；旧数据缺少 releasedAt 时用进入末阶段的 enteredAt 估算。 */
export function isLateReleased(r: Pick<Requirement, "status" | "expectedDate" | "releasedAt" | "enteredAt">) {
  if (r.status !== "released" || !r.expectedDate) return false;
  const actualRelease = releaseTimeOf(r);
  if (!actualRelease) return false;
  return todayString(actualRelease) > r.expectedDate.slice(0, 10);
}
/** 高优逾期: the high-priority subset of {@link isAnyOverdue}, including late releases. */
export function isOverdue(r: Pick<Requirement, "status" | "priority" | "expectedDate" | "createdAt" | "releasedAt" | "enteredAt">, now: string | Date = new Date()) {
  return r.priority === "high" && (isAnyOverdue(r, now) || isLateReleased(r));
}
/** Workbench overdue scope: current overdue work plus unarchived requirements released late. */
export function isOverdueOrLateReleased(r: Pick<Requirement, "status" | "priority" | "expectedDate" | "createdAt" | "releasedAt" | "enteredAt">, now: string | Date = new Date()) {
  return isAnyOverdue(r, now) || isLateReleased(r);
}
/** Union of the three highlight rules; the workbench itself lists every unarchived requirement. */
export function isFocused(r: Pick<Requirement, "status" | "createdAt" | "blocked" | "priority" | "expectedDate" | "releasedAt" | "enteredAt">, now: string | Date = new Date()) {
  return isLateReleased(r) || (!isScheduled(r, now) && isNew(r, now)) || (r.status === "active" && !isScheduled(r, now) && (r.blocked || isAnyOverdue(r, now)));
}
export function daysSince(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 86400000));
}
export function daysOverdue(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.round((new Date(todayString(now)).getTime() - new Date(value).getTime()) / 86400000));
}
export function requirementCode(id: number) { return `HR-${1000 + id}`; }
/**
 * 需求编辑时校验期望上线/完成日期未被篡改：
 * - 未传 expectedDate（undefined）视为不修改，返回 true；
 * - 传入值与当前已保存值一致（空字符串与 null 等价）视为未修改，返回 true；
 * - 任何试图新增、清空或更改期望日期的请求均返回 false。
 */
export function isExpectedDateUnchanged(currentExpectedDate: string | null | undefined, incomingExpectedDate: unknown) {
  if (incomingExpectedDate === undefined) return true;
  const current = currentExpectedDate ?? null;
  if (incomingExpectedDate === null || incomingExpectedDate === "") return current === null;
  if (typeof incomingExpectedDate !== "string") return false;
  return incomingExpectedDate.trim() === current;
}
/** 角色：owner 空间管理员（全局维护）、pm 产品经理（维护绑定团队）、observer 业务负责人（仅查看绑定团队）。 */
export const ROLE_LABELS: Record<string, string> = { owner: "空间管理员", pm: "产品经理", observer: "业务负责人" };
export function roleLabel(role: string) { return ROLE_LABELS[role] ?? role; }
/** 可查看某团队的数据：空间管理员全部；产品经理与业务负责人仅限绑定团队。 */
export function canViewTeam(actor: { role: string; teamIds: string[] }, teamId: string) {
  return actor.role === "owner" || actor.teamIds.includes(teamId);
}
/** 可维护某团队需求：仅空间管理员与绑定该团队的产品经理；业务负责人永远不可。 */
export function canMaintain(actor: { role: string; teamIds: string[] }, teamId: string) {
  return actor.role === "owner" || (actor.role === "pm" && actor.teamIds.includes(teamId));
}
/** 是否有任一团队可新建需求。 */
export function canCreateRequirement(actor: { role: string; teamIds: string[] }) {
  return actor.role === "owner" || (actor.role === "pm" && actor.teamIds.length > 0);
}
export { DAY_MS, SHANGHAI_OFFSET_MS };
