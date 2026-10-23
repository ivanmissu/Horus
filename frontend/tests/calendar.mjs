import assert from "node:assert/strict";
import { buildMonthCells, canGoPreviousMonth, selectableFloor } from "../src/lib/calendar.ts";

// 期望上线/完成日期的可选范围：新建只能选今天及以后，编辑不早于已填日期。
// 日历格子完全由 YYYY-MM-DD 字符串推导，不受运行机器时区影响。
const october = buildMonthCells({ viewYear: 2026, viewMonth: 9, today: "2026-10-23", min: "2026-10-23" });
assert.equal(october.length, 42, "固定的六周网格，避免面板高度抖动");
assert.equal(october.filter(cell => cell.isCurrentMonth).length, 31, "2026 年 10 月有 31 天");
// 2026-10-01 是周四 → 周一开头的网格前置 9.28–9.30 三天
assert.deepEqual(october.slice(0, 3).map(cell => cell.iso), ["2026-09-28", "2026-09-29", "2026-09-30"]);
assert.ok(october.slice(0, 3).every(cell => cell.disabled && !cell.isCurrentMonth), "上月补位日同样早于下限");
assert.equal(october.find(cell => cell.iso === "2026-10-22").disabled, true, "昨天不可选");
assert.equal(october.find(cell => cell.iso === "2026-10-01").disabled, true);
assert.equal(october.find(cell => cell.iso === "2026-10-23").disabled, false, "今天起可选（含今天）");
assert.equal(october.find(cell => cell.iso === "2026-10-31").disabled, false);
assert.equal(october.filter(cell => cell.disabled).length, 25, "9.28–9.30 三个补位日 + 10.01–10.22 共 25 格被锁");
assert.equal(october.find(cell => cell.isToday).iso, "2026-10-23", "高亮的今天走北京时间口径");

// 未设下限（其他调用方）时不做任何限制
const free = buildMonthCells({ viewYear: 2026, viewMonth: 9, today: "2026-10-23" });
assert.equal(free.filter(cell => cell.disabled).length, 0);
assert.equal(free.find(cell => cell.iso === "2026-10-01").disabled, false);

// 选中态：编辑历史需求时，那个过去的日期仍是「已选中」而不是「被禁用」
const kept = buildMonthCells({ viewYear: 2026, viewMonth: 9, today: "2026-10-23", min: "2026-10-10", selected: "2026-10-10" });
for (let day = 1; day <= 9; day += 1) {
  const iso = `2026-10-${String(day).padStart(2, "0")}`;
  assert.equal(kept.find(cell => cell.iso === iso).disabled, true, `${iso} 早于当前已填日期，应锁定`);
}
assert.equal(kept.find(cell => cell.iso === "2026-10-09").disabled, true, "比当前已填日期更早的仍禁止");
assert.equal(kept.find(cell => cell.iso === "2026-10-10").disabled, false, "已填日期本身可以原样保留");
assert.equal(kept.find(cell => cell.iso === "2026-10-10").isSelected, true);
assert.equal(kept.find(cell => cell.iso === "2026-10-15").disabled, false, "今天以前、当前值以后的日期仍可调整");

// 翻页下限：当前月已无可选项时禁止继续往前翻
assert.equal(canGoPreviousMonth(2026, 9, "2026-10-23"), false, "停在含下限的那个月即可");
assert.equal(canGoPreviousMonth(2026, 10, "2026-10-23"), true, "11 月可以翻回 10 月挑 10.23 之后");
assert.equal(canGoPreviousMonth(2026, 9, null), true, "无下限不限制翻页");
assert.equal(canGoPreviousMonth(2027, 0, "2026-12-31"), true, "跨年翻月按月初比较");
assert.equal(canGoPreviousMonth(2026, 11, "2026-12-05"), false, "12 月是下限月时不能翻到 11 月");

// 编辑入口的下限取值
assert.equal(selectableFloor("2026-10-10", "2026-10-23"), "2026-10-10", "已填过去日期保留为下限");
assert.equal(selectableFloor("2026-11-02", "2026-10-23"), "2026-10-23", "已填未来日期不放松限制");
assert.equal(selectableFloor("2026-10-23", "2026-10-23"), "2026-10-23");
assert.equal(selectableFloor(null, "2026-10-23"), "2026-10-23", "未填过则按新建口径");
assert.equal(selectableFloor("", "2026-10-23"), "2026-10-23");

console.log("CALENDAR RANGE TESTS PASSED");
