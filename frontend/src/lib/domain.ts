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
export function todayString(now: string | Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
export function isNew(r: Requirement, now: string | Date = new Date()) {
  return r.status === "active" && new Date(now).getTime() - new Date(r.createdAt).getTime() < 7 * 86400000;
}
export function isOverdue(r: Requirement, now: string | Date = new Date()) {
  return r.status === "active" && r.priority === "high" && !!r.expectedDate && r.expectedDate < todayString(now);
}
export function isFocused(r: Requirement, now: string | Date = new Date()) {
  return r.status === "active" && (isNew(r, now) || r.blocked || isOverdue(r, now));
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
