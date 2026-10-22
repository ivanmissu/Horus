import assert from "node:assert/strict";
import { buildStats } from "../src/lib/stats.ts";
import { buildBackfillEvents, deriveEventsFromRequirements } from "../src/lib/events.ts";

const now = "2026-10-21T04:00:00.000Z"; // Wednesday 12:00 Asia/Shanghai
const requirements = [];
function add(values) {
  const id = requirements.length + 1;
  requirements.push({
    id, teamId: "platform", title: `需求 ${id}`, description: "", priority: "medium", owner: "",
    expectedDate: null, stageId: "review", enteredAt: values.createdAt, blocked: false, blockReason: "",
    status: "active", source: "手工录入", externalId: null, createdBy: null, updatedBy: null,
    createdAt: values.createdAt, updatedAt: values.createdAt, releasedAt: null, cancelledAt: null, archivedAt: null,
    ...values,
  });
}
add({ createdAt: "2026-10-20T02:00:00.000Z" }); // 1: created this week
add({ createdAt: "2026-10-01T02:00:00.000Z", status: "released", releasedAt: "2026-10-19T02:00:00.000Z", stageId: "released" }); // 2: released this week
add({ teamId: "product", createdAt: "2026-09-01T02:00:00.000Z", status: "cancelled", cancelledAt: "2026-10-13T02:00:00.000Z", archivedAt: "2026-10-13T02:00:00.000Z", stageId: "design" }); // 3: cancelled last week
add({ teamId: "product", createdAt: "2026-09-20T02:00:00.000Z", priority: "high", expectedDate: "2026-10-10" }); // 4: overdue
add({ createdAt: "2026-10-18T15:59:59.999Z" }); // 5: last week, blocked last week only
add({ teamId: "data", createdAt: "2026-10-18T16:00:00.000Z", blocked: true, blockReason: "等待联调" }); // 6: this week, blocked now

const events = [
  { requirementId: 2, type: "released", createdAt: "2026-10-19T02:00:00.000Z", estimated: false },
  { requirementId: 3, type: "cancelled", createdAt: "2026-10-13T02:00:00.000Z", estimated: false },
  { requirementId: 5, type: "blocked", createdAt: "2026-10-14T02:00:00.000Z", estimated: false },
  { requirementId: 5, type: "unblocked", createdAt: "2026-10-15T02:00:00.000Z", estimated: false },
  { requirementId: 6, type: "blocked", createdAt: "2026-10-20T02:00:00.000Z", estimated: false },
];
const teams = [
  { id: "platform", name: "基础平台组", color: "purple" },
  { id: "product", name: "业务产品组", color: "blue" },
  { id: "data", name: "数据智能组", color: "teal" },
];

const weekly = buildStats({ requirements, events, teams, now, granularity: "week", periods: 12 });
assert.equal(weekly.buckets.length, 12);
assert.equal(weekly.current.key, "2026-10-19");
assert.equal(weekly.current.created, 2, "this week: Monday 00:00 included, last Sunday excluded");
assert.equal(weekly.current.released, 1);
assert.equal(weekly.current.cancelled, 0);
assert.equal(weekly.current.blocked, 1, "blocked counts distinct requirements, not events");
assert.equal(weekly.current.stock, 5, "cancelled requirement is archived and leaves in-flight stock");
assert.equal(weekly.current.overdue, 1);
assert.equal(weekly.current.net, 2);
assert.equal(weekly.previous.key, "2026-10-12");
assert.equal(weekly.previous.created, 1);
assert.equal(weekly.previous.cancelled, 1);
assert.equal(weekly.previous.blocked, 1);
assert.equal(weekly.previous.net, 0);
assert.equal(weekly.range.created, 6);
assert.equal(weekly.range.released, 1);
assert.equal(weekly.range.cancelled, 1);
assert.equal(weekly.range.blocked, 2, "both blocked requirements are distinct in the range");
assert.equal(weekly.range.archived, 0, "cancellations are not counted as archives");
assert.equal(weekly.range.stock, 5);
assert.equal(weekly.teams.find(team => team.teamId === "platform").created, 3);
assert.equal(weekly.teams.find(team => team.teamId === "product").created, 2);
assert.equal(weekly.teams.find(team => team.teamId === "data").created, 1);
assert.equal(weekly.hasEstimates, false);

// 预期达成率（按期望上线日归集）：req4 期望 2026-10-10、未上线 → 上周已到期未达成
assert.equal(weekly.missingExpected, 4, "cancelled requirement is excluded from the missing-expected count");
assert.equal(weekly.current.expectedDue, 0);
assert.equal(weekly.current.expectedMet, 0);
assert.equal(weekly.current.expectedRatio, null);
assert.equal(weekly.buckets.find(bucket => bucket.key === "2026-10-05").expectedDue, 1);
assert.equal(weekly.buckets.find(bucket => bucket.key === "2026-10-05").expectedMet, 0);
assert.equal(weekly.buckets.find(bucket => bucket.key === "2026-10-05").expectedRatio, 0);
assert.equal(weekly.range.expectedDue, 1);
assert.equal(weekly.range.expectedMet, 0);
assert.equal(weekly.range.expectedRatio, 0);
assert.equal(weekly.teams.find(team => team.teamId === "product").expectedDue, 1);
assert.equal(weekly.teams.find(team => team.teamId === "product").expectedRatio, 0);

const monthly = buildStats({ requirements, events, teams, now, granularity: "month", periods: 6 });
assert.equal(monthly.buckets.length, 6);
assert.equal(monthly.current.key, "2026-10");
assert.equal(monthly.current.created, 4);
assert.equal(monthly.current.released, 1);
assert.equal(monthly.current.cancelled, 1);
assert.equal(monthly.current.blocked, 2);
assert.equal(monthly.current.overdue, 1);

const filtered = buildStats({ requirements, events, teams, now, granularity: "week", periods: 12, teamId: "product" });
assert.equal(filtered.buckets.reduce((total, bucket) => total + bucket.created, 0), 2);
assert.equal(filtered.teams.length, 1);
assert.equal(filtered.teams[0].teamId, "product");

const legacy = [{ ...requirements[3], releasedAt: null, status: "released", enteredAt: "2026-10-19T02:00:00.000Z" }];
const derived = deriveEventsFromRequirements([...requirements, ...legacy]);
assert.equal(derived.find(event => event.requirementId === 6 && event.type === "blocked").estimated, true);
assert.equal(derived.find(event => event.requirementId === 2 && event.type === "released").estimated, false);

// ── 预期达成率口径边界 ────────────────────────────────────────────────────
const expRequirements = [];
function addExp(values) {
  const id = expRequirements.length + 1;
  expRequirements.push({
    id, teamId: "platform", title: `预期需求 ${id}`, description: "", priority: "medium", owner: "",
    expectedDate: null, stageId: "review", enteredAt: values.createdAt, blocked: false, blockReason: "",
    status: "active", source: "手工录入", externalId: null, createdBy: null, updatedBy: null,
    createdAt: values.createdAt, updatedAt: values.createdAt, releasedAt: null, cancelledAt: null, archivedAt: null,
    ...values,
  });
}
addExp({ expectedDate: "2026-10-20", status: "released", stageId: "released", releasedAt: "2026-10-19T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 按期上线
addExp({ expectedDate: "2026-10-20", status: "released", stageId: "released", releasedAt: "2026-10-21T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 晚于期望日上线
addExp({ expectedDate: "2026-10-20", createdAt: "2026-10-01T02:00:00.000Z" }); // 期望日已过仍未上线
addExp({ expectedDate: "2026-10-21", status: "released", stageId: "released", releasedAt: "2026-10-20T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 期望日当天到期，提前一天上线
addExp({ expectedDate: "2026-10-25", status: "released", stageId: "released", releasedAt: "2026-10-19T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 提前上线但期望日未到 → 暂不计入
addExp({ expectedDate: "2026-10-25", createdAt: "2026-10-01T02:00:00.000Z" }); // 期望日未到 → 暂不计入
addExp({ expectedDate: "2026-10-20", status: "cancelled", stageId: "design", cancelledAt: "2026-10-19T02:00:00.000Z", archivedAt: "2026-10-19T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 已取消 → 完全排除
addExp({ createdAt: "2026-10-01T02:00:00.000Z" }); // 未填期望日期 → 只计未填数
addExp({ expectedDate: "2026-09-30", createdAt: "2026-09-01T02:00:00.000Z" }); // 上上周期望日到期，未上线
addExp({ expectedDate: "2026-05-01", createdAt: "2026-04-01T02:00:00.000Z" }); // 期望日早于可见区间 → 不计入
addExp({ status: "cancelled", cancelledAt: "2026-10-19T02:00:00.000Z", archivedAt: "2026-10-19T02:00:00.000Z", createdAt: "2026-10-01T02:00:00.000Z" }); // 已取消且未填期望日期 → 不计未填数

const expStats = buildStats({ requirements: expRequirements, events: [], teams: [{ id: "platform", name: "基础平台组", color: "purple" }], now, granularity: "week", periods: 12 });
assert.equal(expStats.current.key, "2026-10-19");
assert.equal(expStats.current.expectedDue, 4, "due this week: A/B/C/D; early release E waits until 10-25");
assert.equal(expStats.current.expectedMet, 2, "A shipped before expected, D shipped before its due date today");
assert.ok(Math.abs(expStats.current.expectedRatio - 0.5) < 1e-9);
assert.equal(expStats.buckets.find(bucket => bucket.key === "2026-09-28").expectedDue, 1);
assert.equal(expStats.buckets.find(bucket => bucket.key === "2026-09-28").expectedMet, 0);
assert.equal(expStats.buckets.find(bucket => bucket.key === "2026-09-28").expectedRatio, 0);
assert.equal(expStats.buckets.find(bucket => bucket.key === "2026-10-12").expectedRatio, null, "nothing due → null ratio");
assert.equal(expStats.range.expectedDue, 5, "cancelled G and out-of-range J are excluded");
assert.equal(expStats.range.expectedMet, 2);
assert.ok(Math.abs(expStats.range.expectedRatio - 0.4) < 1e-9);
assert.equal(expStats.missingExpected, 1, "only H lacks an expected date among non-cancelled requirements");
assert.equal(derived.filter(event => event.type === "created").length, 7);

const backfilled = buildBackfillEvents(
  [{ ...requirements[3], status: "released", releasedAt: null, enteredAt: "2026-10-19T02:00:00.000Z" }],
  [{ requirementId: 4, action: "advance", detail: { status: "released" }, createdAt: "2026-10-19T02:00:00.000Z" }],
);
const exactRelease = backfilled.find(event => event.requirementId === 4 && event.type === "released");
assert.equal(exactRelease.estimated, false, "exact audit actions win over field estimates");
assert.equal(exactRelease.createdAt, "2026-10-19T02:00:00.000Z");
assert.equal(backfilled.filter(event => event.requirementId === 4 && event.type === "released").length, 1);

const estimateFlag = buildStats({
  requirements: [{ ...requirements[3], releasedAt: null, status: "released", enteredAt: "2026-10-19T02:00:00.000Z" }],
  events: [], teams, now, granularity: "week", periods: 12,
});
assert.equal(estimateFlag.hasEstimates, true);
assert.equal(estimateFlag.current.released, 1, "releasedAt falls back to enteredAt for legacy rows");

console.log("STATISTICS BUCKET TESTS PASSED");
