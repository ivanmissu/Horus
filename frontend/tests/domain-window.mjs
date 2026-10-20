import assert from "node:assert/strict";
import {
  addMonths,
  canArchive,
  dateRangeLabel,
  isArchived,
  isFocused,
  isInFlight,
  isNew,
  shanghaiClock,
  startOfShanghaiMonth,
  startOfShanghaiWeek,
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

const active = (createdAt, status = "active") => ({ status, createdAt, blocked: false, priority: "low", expectedDate: null });
assert.equal(isNew(active("2026-10-18T16:00:00.000Z"), wednesday), true, "Monday 00:00 counts as this week");
assert.equal(isNew(active("2026-10-18T15:59:59.999Z"), wednesday), false, "last Sunday does not count");
assert.equal(isNew(active("2026-10-21T04:00:00.001Z"), wednesday), false, "future timestamps do not count");
assert.equal(isNew(active("2026-10-19T02:00:00.000Z", "released"), wednesday), false, "released requirements are not 本周新建");
assert.equal(isNew(active("2026-10-19T02:00:00.000Z", "cancelled"), wednesday), false, "cancelled requirements are not 本周新建");

assert.equal(isFocused({ status: "active", createdAt: "2026-10-01T00:00:00.000Z", blocked: true, priority: "low", expectedDate: null }, wednesday), true);
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
console.log("DOMAIN NATURAL-WEEK TESTS PASSED");
