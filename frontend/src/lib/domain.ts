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
const DEFAULT_NEW_WINDOW_DAYS = 7;
export function todayString(now: string | Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
export function shanghaiClock(now: string | Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = parts.find(part => part.type === "hour")?.value ?? "00";
  const minute = parts.find(part => part.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
export function parseNewWindowDays(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (parsed < 1 || parsed > 90) return undefined;
  return parsed;
}
/** Runtime `HORUS_NEW_WINDOW_DAYS` wins; `NEXT_PUBLIC_NEW_WINDOW_DAYS` is the build-time fallback. */
export function newWindowDays() {
  return parseNewWindowDays(process.env.HORUS_NEW_WINDOW_DAYS) ?? parseNewWindowDays(process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS) ?? DEFAULT_NEW_WINDOW_DAYS;
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
export function isNew(r: Requirement, now: string | Date = new Date(), windowDays = newWindowDays()) {
  const days = parseNewWindowDays(windowDays) ?? DEFAULT_NEW_WINDOW_DAYS;
  return r.status === "active" && new Date(now).getTime() - new Date(r.createdAt).getTime() < days * 86400000;
}
export function isOverdue(r: Requirement, now: string | Date = new Date()) {
  return r.status === "active" && r.priority === "high" && !!r.expectedDate && r.expectedDate < todayString(now);
}
export function isFocused(r: Requirement, now: string | Date = new Date(), windowDays = newWindowDays()) {
  return r.status === "active" && (isNew(r, now, windowDays) || r.blocked || isOverdue(r, now));
}
export function daysSince(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 86400000));
}
export function daysOverdue(value: string, now: string | Date = new Date()) {
  return Math.max(0, Math.round((new Date(todayString(now)).getTime() - new Date(value).getTime()) / 86400000));
}
export function shortDate(value: string | null) {
  if (!value) return "未填期望上线";
  const date = value.slice(0, 10).split("-");
  return `${date[1]}.${date[2]}`;
}
export function requirementCode(id: number) { return `HR-${1000 + id}`; }
export function canMaintain(actor: { role: string; teamIds: string[] }, teamId: string) {
  return actor.role === "owner" || actor.teamIds.includes(teamId);
}
