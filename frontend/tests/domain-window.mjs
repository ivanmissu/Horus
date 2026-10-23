import assert from "node:assert/strict";
import {
  addMonths,
  canArchive,
  creationTimeForCycle,
  cycleOf,
  DEFAULT_PRIORITY,
  DEFAULT_REQUIREMENT_CYCLE,
  isScheduled,
  launchCycleOf,
  nextWeekMorning,
  daysOverdue,
  isAnyOverdue,
  isOverdue,
  PRIORITY_LABELS,
  dateRangeLabel,
  endOfShanghaiWeek,
  isArchived,
  isFocused,
  isInFlight,
  isNew,
  shanghaiClock,
  startOfShanghaiMonth,
  startOfShanghaiWeek,
  todayString,
} from "../src/lib/domain.ts";

const iso = value => new Date(value).toISOString();

// 2026-10-21 12:00 Asia/Shanghai = Wednesday of the week starting 10-19.
const wednesday = "2026-10-21T04:00:00.000Z";
assert.equal(iso(startOfShanghaiWeek(wednesday)), "2026-10-18T16:00:00.000Z");
assert.equal(iso(startOfShanghaiWeek("2026-10-18T15:59:59.999Z")), "2026-10-11T16:00:00.000Z", "Sunday 23:59 belongs to the previous week");
assert.equal(iso(startOfShanghaiWeek("2026-10-18T16:00:00.000Z")), "2026-10-18T16:00:00.000Z", "Monday 00:00 starts the new week");
assert.equal(iso(startOfShanghaiWeek("2026-10-25T15:59:59.999Z")), "2026-10-18T16:00:00.000Z");
assert.equal(iso(startOfShanghaiWeek("2026-10-25T16:00:00.000Z")), "2026-10-25T16:00:00.000Z");
assert.equal(iso(startOfShanghaiMonth(wednesday)), "2026-09-30T16:00:00.000Z");
assert.equal(iso(addMonths(startOfShanghaiMonth(wednesday), -1)), "2026-08-31T16:00:00.000Z");
assert.equal(dateRangeLabel("2026-10-19", "2026-10-25"), "10.19 – 10.25");
assert.equal(todayString(endOfShanghaiWeek(wednesday)), "2026-10-25", "natural week ends on Sunday");
assert.equal(todayString(endOfShanghaiWeek("2026-10-25T15:59:59.999Z")), "2026-10-25", "Sunday itself is the last day of its week");
assert.equal(
  dateRangeLabel(todayString(startOfShanghaiWeek(wednesday)), todayString(endOfShanghaiWeek(wednesday))),
  "10.19 – 10.25",
  "本周新建窗口 spans the full natural week (Monday..Sunday), not Monday..today",
);

const active = (createdAt, status = "active") => ({ status, createdAt, blocked: false, priority: "low", expectedDate: null });
assert.equal(isNew(active("2026-10-18T16:00:00.000Z"), wednesday), true, "Monday 00:00 counts as this week");
assert.equal(isNew(active("2026-10-18T15:59:59.999Z"), wednesday), false, "last Sunday does not count");
assert.equal(isNew(active("2026-10-21T04:00:00.001Z"), wednesday), false, "future timestamps do not count");
assert.equal(isNew(active("2026-10-19T02:00:00.000Z", "released"), wednesday), false, "released requirements are not 本周新建");
assert.equal(isNew(active("2026-10-19T02:00:00.000Z", "cancelled"), wednesday), false, "cancelled requirements are not 本周新建");

// 逾期（全部优先级）与「高优逾期」是两条口径：钉钉摘要用前者，工作台高亮用后者。
const dated = (priority, expectedDate, status = "active") => ({ status, createdAt: "2026-10-01T00:00:00.000Z", blocked: false, priority, expectedDate });
assert.equal(isAnyOverdue(dated("high", "2026-10-20"), wednesday), true);
assert.equal(isAnyOverdue(dated("medium", "2026-10-20"), wednesday), true, "中优先级逾期同样计入全部逾期");
assert.equal(isAnyOverdue(dated("low", "2026-10-20"), wednesday), true, "低优先级逾期同样计入全部逾期");
assert.equal(isOverdue(dated("medium", "2026-10-20"), wednesday), false, "高优逾期仍只统计高优先级");
assert.equal(isOverdue(dated("high", "2026-10-21"), wednesday), false, "期望日当天不算逾期");
assert.equal(isAnyOverdue(dated("high", null), wednesday), false, "未填期望上线/完成日期不算错");
assert.equal(isAnyOverdue(dated("high", "2026-10-20", "released"), wednesday), false, "已上线的需求不再计入逾期");
assert.equal(isAnyOverdue(dated("high", "2026-10-20", "cancelled"), wednesday), false, "已取消的需求不再计入逾期");
assert.equal(daysOverdue("2026-10-10", wednesday), 11);
assert.deepEqual(PRIORITY_LABELS, { high: "高", medium: "中", low: "低" });
assert.equal(DEFAULT_PRIORITY, "high", "新增需求的默认优先级为高");

assert.equal(isFocused({ status: "active", createdAt: "2026-10-01T00:00:00.000Z", blocked: true, priority: "low", expectedDate: null }, wednesday), true);
assert.equal(isFocused({ status: "active", createdAt: "2026-09-01T00:00:00.000Z", blocked: false, priority: "medium", expectedDate: "2026-10-20" }, wednesday), true, "非高优的逾期需求也属于工作台高亮范围");
assert.equal(isFocused({ status: "active", createdAt: "2026-10-18T15:59:59.999Z", blocked: false, priority: "low", expectedDate: null }, wednesday), false);
assert.equal(isFocused({ status: "active", createdAt: "2026-10-18T16:00:00.000Z", blocked: false, priority: "low", expectedDate: null }, wednesday), true);

assert.equal(isArchived({ archivedAt: "2026-10-16T00:00:00.000Z" }), true);
assert.equal(isArchived({ archivedAt: null }), false);
assert.equal(isInFlight({ archivedAt: null }), true);
assert.equal(canArchive({ status: "released", archivedAt: null }), true);
assert.equal(canArchive({ status: "released", archivedAt: "2026-10-16T00:00:00.000Z" }), false);
assert.equal(canArchive({ status: "active", archivedAt: null }), false);
assert.equal(shanghaiClock("2026-10-16T01:30:00.000Z"), "09:30");
assert.match(shanghaiClock(), /^\d{2}:\d{2}$/);
// 需求周期：本周 = 当前时间，下周 = 下周一 09:00（北京时间）。
assert.equal(DEFAULT_REQUIREMENT_CYCLE, "this");
assert.equal(iso(nextWeekMorning(wednesday)), "2026-10-26T01:00:00.000Z", "下周一 09:00 Asia/Shanghai");
assert.equal(iso(creationTimeForCycle("this", wednesday)), iso(wednesday));
assert.equal(iso(creationTimeForCycle("next", wednesday)), "2026-10-26T01:00:00.000Z");
assert.equal(isScheduled({ createdAt: "2026-10-26T01:00:00.000Z" }, wednesday), true);
assert.equal(isScheduled({ createdAt: "2026-10-19T02:00:00.000Z" }, wednesday), false);

const cycleReq = createdAt => ({ createdAt });
assert.equal(cycleOf(cycleReq("2026-10-14T02:00:00.000Z"), wednesday), "last");
assert.equal(cycleOf(cycleReq("2026-10-18T15:59:59.999Z"), wednesday), "last", "上周日仍属于上周");
assert.equal(cycleOf(cycleReq("2026-10-18T16:00:00.000Z"), wednesday), "this");
assert.equal(cycleOf(cycleReq("2026-10-25T15:59:59.999Z"), wednesday), "this");
assert.equal(cycleOf(cycleReq("2026-10-25T16:00:00.000Z"), wednesday), "next");
assert.equal(cycleOf(cycleReq("2026-10-01T00:00:00.000Z"), wednesday), null, "更早的需求不属于三档之一");

const launchReq = expectedDate => ({ expectedDate });
assert.equal(launchCycleOf(launchReq("2026-10-19"), wednesday), "this");
assert.equal(launchCycleOf(launchReq("2026-10-25"), wednesday), "this", "周日是本周最后一天");
assert.equal(launchCycleOf(launchReq("2026-10-26"), wednesday), "next");
assert.equal(launchCycleOf(launchReq("2026-11-01"), wednesday), "next");
assert.equal(launchCycleOf(launchReq("2026-11-02"), wednesday), null);
assert.equal(launchCycleOf(launchReq(null), wednesday), null);

// 下周待启动的需求尚未进入流程：不命中逾期与工作台高亮。
const scheduled = { status: "active", createdAt: "2026-10-26T01:00:00.000Z", blocked: true, priority: "high", expectedDate: "2026-10-20" };
assert.equal(isAnyOverdue(scheduled, wednesday), false, "下周待启动不参与逾期");
assert.equal(isOverdue(scheduled, wednesday), false);
assert.equal(isFocused(scheduled, wednesday), false, "下周待启动不进入风险高亮");

console.log("DOMAIN NATURAL-WEEK TESTS PASSED");
