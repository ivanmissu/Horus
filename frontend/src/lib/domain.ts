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
/**
 * 「本周新建」= created in the current natural week (Monday 00:00 Asia/Shanghai)
 * and still active. Released, cancelled and archived requirements are excluded.
 */
export function isNew(r: Pick<Requirement, "status" | "createdAt">, now: string | Date = new Date()) {
  const created = new Date(r.createdAt).getTime();
  const current = new Date(now).getTime();
  return r.status === "active" && created >= startOfShanghaiWeek(now).getTime() && created <= current;
}
/**
 * 逾期（不限优先级）: still in flight but already past the expected date.
 * Released/cancelled requirements never count, and a missing expected date is never a violation.
 */
export function isAnyOverdue(r: Pick<Requirement, "status" | "expectedDate">, now: string | Date = new Date()) {
  return r.status === "active" && !!r.expectedDate && r.expectedDate < todayString(now);
}
/** 高优逾期: the high-priority subset of {@link isAnyOverdue}. */
export function isOverdue(r: Pick<Requirement, "status" | "priority" | "expectedDate">, now: string | Date = new Date()) {
  return r.priority === "high" && isAnyOverdue(r, now);
}
/** Union of the three highlight rules; the workbench itself lists every unarchived requirement. */
export function isFocused(r: Pick<Requirement, "status" | "createdAt" | "blocked" | "priority" | "expectedDate">, now: string | Date = new Date()) {
  return r.status === "active" && (isNew(r, now) || r.blocked || isAnyOverdue(r, now));
}
export function daysSince(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 86400000));
}
export function daysOverdue(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.round((new Date(todayString(now)).getTime() - new Date(value).getTime()) / 86400000));
}
export function requirementCode(id: number) { return `HR-${1000 + id}`; }
/** 角色：owner 负责人（全局维护）、pm 产品经理（维护绑定团队）、observer 观察员（仅查看绑定团队）。 */
export const ROLE_LABELS: Record<string, string> = { owner: "团队负责人", pm: "产品经理", observer: "观察员" };
export function roleLabel(role: string) { return ROLE_LABELS[role] ?? role; }
/** 可查看某团队的数据：负责人全部；产品经理与观察员仅限绑定团队。 */
export function canViewTeam(actor: { role: string; teamIds: string[] }, teamId: string) {
  return actor.role === "owner" || actor.teamIds.includes(teamId);
}
/** 可维护某团队需求：仅负责人与绑定该团队的产品经理；观察员永远不可。 */
export function canMaintain(actor: { role: string; teamIds: string[] }, teamId: string) {
  return actor.role === "owner" || (actor.role === "pm" && actor.teamIds.includes(teamId));
}
/** 是否有任一团队可新建需求。 */
export function canCreateRequirement(actor: { role: string; teamIds: string[] }) {
  return actor.role === "owner" || (actor.role === "pm" && actor.teamIds.length > 0);
}
export { DAY_MS, SHANGHAI_OFFSET_MS };
