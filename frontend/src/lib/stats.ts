import { addDays, addMonths, shortDate, startOfShanghaiMonth, startOfShanghaiWeek, todayString } from "./domain.ts";
import type { DerivedEvent } from "./events";
import type { Requirement, RequirementEventType, StatsBucket, StatsData, StatsGranularity, StatsTeamRow, Team } from "./types";

export type StatsEvent = Pick<DerivedEvent, "requirementId" | "type" | "createdAt" | "estimated">;
export const STATS_WEEKS = 12;
export const STATS_MONTHS = 6;
export function statsPeriods(granularity: StatsGranularity) {
  return granularity === "week" ? STATS_WEEKS : STATS_MONTHS;
}

export type StatsInput = {
  requirements: Requirement[];
  events: StatsEvent[];
  teams: Pick<Team, "id" | "name" | "color">[];
  now: string | Date;
  granularity: StatsGranularity;
  periods?: number;
  teamId?: string;
};

type Point = {
  requirement: Requirement;
  created: number;
  released: number | null;
  cancelled: number | null;
  archived: number | null;
};
type Interval = [number, number];

const finite = (value: string | null | undefined) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

function periodStarts(granularity: StatsGranularity, periods: number, nowMs: number) {
  const currentStart = granularity === "week" ? startOfShanghaiWeek(new Date(nowMs)) : startOfShanghaiMonth(new Date(nowMs));
  const starts: Date[] = [];
  for (let index = periods - 1; index >= 0; index -= 1) {
    starts.push(granularity === "week" ? addDays(currentStart, -7 * index) : addMonths(currentStart, -index));
  }
  return starts;
}

function naturalBuckets(granularity: StatsGranularity, periods: number, nowMs: number) {
  const starts = periodStarts(granularity, periods, nowMs);
  return starts.map((start, index) => {
    const next = index + 1 < starts.length
      ? starts[index + 1]
      : granularity === "week" ? addDays(start, 7) : addMonths(start, 1);
    const startYmd = todayString(start);
    const endYmd = todayString(new Date(next.getTime() - 1));
    const isCurrent = index === starts.length - 1;
    const endMs = next.getTime();
    return {
      key: granularity === "week" ? startYmd : startYmd.slice(0, 7),
      label: granularity === "week" ? `${shortDate(startYmd)} – ${shortDate(endYmd)}` : `${startYmd.slice(0, 4)} 年 ${Number(startYmd.slice(5, 7))} 月`,
      shortLabel: granularity === "week" ? shortDate(startYmd) : `${Number(startYmd.slice(5, 7))} 月`,
      start: start.toISOString(),
      end: next.toISOString(),
      startMs: start.getTime(),
      asOfMs: isCurrent ? nowMs : endMs - 1,
      current: isCurrent,
    };
  });
}

function lifecyclePoints(requirements: Requirement[]) {
  let hasEstimates = false;
  const points: Point[] = requirements.map(requirement => {
    const created = finite(requirement.createdAt) ?? 0;
    const released = finite(requirement.releasedAt) ?? (requirement.status === "released" ? finite(requirement.enteredAt) : null);
    const cancelled = finite(requirement.cancelledAt) ?? (requirement.status === "cancelled" ? finite(requirement.archivedAt) : null);
    if (requirement.status === "released" && !requirement.releasedAt) hasEstimates = true;
    if (requirement.status === "cancelled" && !requirement.cancelledAt) hasEstimates = true;
    return { requirement, created, released, cancelled, archived: finite(requirement.archivedAt) };
  });
  return { points, hasEstimates };
}

function blockIntervals(points: Point[], events: StatsEvent[], nowMs: number) {
  let hasEstimates = false;
  const byRequirement = new Map<number, StatsEvent[]>();
  for (const event of events) {
    if (event.type !== "blocked" && event.type !== "unblocked") continue;
    const list = byRequirement.get(event.requirementId) ?? [];
    list.push(event);
    byRequirement.set(event.requirementId, list);
  }
  const intervals = new Map<number, Interval[]>();
  for (const point of points) {
    const history = [...(byRequirement.get(point.requirement.id) ?? [])]
      .map(event => ({ type: event.type, time: finite(event.createdAt) }))
      .filter((event): event is { type: RequirementEventType; time: number } => event.time !== null)
      .sort((a, b) => a.time - b.time);
    const result: Interval[] = [];
    let openedAt: number | null = null;
    for (const event of history) {
      if (event.type === "blocked") {
        if (openedAt === null) openedAt = event.time;
      } else if (openedAt !== null) {
        if (event.time > openedAt) result.push([openedAt, event.time]);
        openedAt = null;
      }
    }
    if (openedAt !== null && nowMs > openedAt) result.push([openedAt, nowMs]);
    // Legacy rows only carry the current boolean flag. Approximate the start
    // with updatedAt so historical bars are useful until real events exist.
    if (!history.length && point.requirement.blocked) {
      const fallback = finite(point.requirement.updatedAt) ?? point.created;
      const start = Math.min(fallback, nowMs);
      if (nowMs > start) result.push([start, nowMs]);
      hasEstimates = true;
    }
    const stop = Math.min(nowMs, point.released ?? Infinity, point.cancelled ?? Infinity);
    intervals.set(point.requirement.id, result
      .map(([start, end]) => [start, Math.min(end, stop)] as Interval)
      .filter(([start, end]) => end > start));
  }
  return { intervals, hasEstimates };
}

type WindowMetrics = Omit<StatsBucket, "key" | "label" | "shortLabel" | "start" | "end" | "current">;

function windowMetrics(startMs: number, asOfMs: number, points: Point[], intervals: Map<number, Interval[]>): WindowMetrics {
  let created = 0;
  let released = 0;
  let cancelled = 0;
  let blocked = 0;
  let archived = 0;
  let overdue = 0;
  let stock = 0;
  const asOfDate = todayString(new Date(asOfMs));
  for (const point of points) {
    const inWindow = (time: number | null) => time !== null && time >= startMs && time <= asOfMs;
    if (inWindow(point.created)) created += 1;
    if (inWindow(point.released)) released += 1;
    if (inWindow(point.cancelled)) cancelled += 1;
    if (inWindow(point.archived) && point.requirement.status !== "cancelled") archived += 1;
    if ((intervals.get(point.requirement.id) ?? []).some(([start, end]) => start <= asOfMs && end > startMs)) blocked += 1;
    if (point.created <= asOfMs && (point.archived === null || point.archived > asOfMs)) stock += 1;
    const activeAtEnd = point.created <= asOfMs
      && (point.released === null || point.released > asOfMs)
      && (point.cancelled === null || point.cancelled > asOfMs);
    if (activeAtEnd && point.requirement.priority === "high" && point.requirement.expectedDate && point.requirement.expectedDate < asOfDate) overdue += 1;
  }
  return { created, released, cancelled, blocked, archived, overdue, stock, net: created - cancelled - archived, releaseRatio: created ? released / created : null };
}

function toBucket(
  meta: { key: string; label: string; shortLabel: string; start: string; end: string; current: boolean },
  metrics: WindowMetrics,
): StatsBucket {
  return { ...meta, ...metrics };
}

export function buildStats(input: StatsInput): StatsData {
  const nowMs = new Date(input.now).getTime();
  const granularity = input.granularity;
  const periods = Math.max(1, Math.min(52, input.periods ?? statsPeriods(granularity)));
  const teams = input.teamId ? input.teams.filter(team => team.id === input.teamId) : input.teams;
  const requirements = input.teamId ? input.requirements.filter(item => item.teamId === input.teamId) : input.requirements;
  const { points, hasEstimates: lifecycleEstimates } = lifecyclePoints(requirements);
  const { intervals, hasEstimates: blockEstimates } = blockIntervals(points, input.events, nowMs);
  const metas = naturalBuckets(granularity, periods, nowMs);
  const buckets = metas.map(meta => toBucket(
    { key: meta.key, label: meta.label, shortLabel: meta.shortLabel, start: meta.start, end: meta.end, current: meta.current },
    windowMetrics(meta.startMs, meta.asOfMs, points, intervals),
  ));
  const rangeStart = metas[0]?.startMs ?? nowMs;
  const rangeMetrics = windowMetrics(rangeStart, nowMs, points, intervals);
  const range = toBucket({
    key: "range",
    label: `近 ${periods} ${granularity === "week" ? "周" : "个月"}`,
    shortLabel: `近 ${periods} ${granularity === "week" ? "周" : "个月"}`,
    start: new Date(rangeStart).toISOString(),
    end: new Date(nowMs).toISOString(),
    current: false,
  }, rangeMetrics);
  const teamRows: StatsTeamRow[] = teams.map(team => {
    const metrics = windowMetrics(rangeStart, nowMs, points.filter(point => point.requirement.teamId === team.id), intervals);
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      created: metrics.created,
      released: metrics.released,
      cancelled: metrics.cancelled,
      blocked: metrics.blocked,
      archived: metrics.archived,
      overdue: metrics.overdue,
      stock: metrics.stock,
    };
  }).sort((a, b) => b.created - a.created || a.name.localeCompare(b.name, "zh-CN"));
  return {
    granularity,
    periods,
    generatedAt: new Date(nowMs).toISOString(),
    from: new Date(rangeStart).toISOString(),
    to: new Date(nowMs).toISOString(),
    current: buckets[buckets.length - 1],
    previous: buckets.length > 1 ? buckets[buckets.length - 2] : null,
    buckets,
    range,
    teams: teamRows,
    hasEstimates: lifecycleEstimates || blockEstimates || input.events.some(event => event.estimated),
  };
}
