import assert from "node:assert/strict";
import { composeDigest } from "../src/lib/digest.ts";

// 钉钉每日摘要：卡点 + 全部逾期（不限优先级）。工作台仍按「高优逾期」高亮，推送口径更宽。
const today = "2026-10-21";
const team = { id: "platform", name: "平台组" };
const row = (id, patch) => ({
  id, teamId: "platform", title: `需求 ${id}`, status: "active", blocked: false, blockReason: "",
  priority: "medium", expectedDate: null, owner: "林小满", ...patch,
});

const requirements = [
  // 1: 卡点 + 高优逾期，两条原因都要出现在同一行
  row(1, { blocked: true, blockReason: "等待安全团队确认", priority: "high", expectedDate: "2026-10-18" }),
  // 2: 中优先级逾期，过去不会被推送，现在必须出现
  row(2, { priority: "medium", expectedDate: "2026-10-10" }),
  // 3: 低优先级逾期
  row(3, { priority: "low", expectedDate: "2026-10-20" }),
  // 4: 高优但未到期
  row(4, { priority: "high", expectedDate: "2026-10-30" }),
  // 5: 逾期但已上线（不再属于在途异常）
  row(5, { status: "released", priority: "high", expectedDate: "2026-09-30" }),
  // 6: 未填期望上线/完成日期，不算逾期
  row(6, { priority: "high", expectedDate: null }),
  // 7: 仅卡点
  row(7, { blocked: true, blockReason: "等待第三方接口", priority: "low", expectedDate: "2026-11-02" }),
];

const digest = composeDigest(requirements, [team], today, [], "https://horus.example.com");

assert.equal(digest.blockedCount, 2, "卡点计数只看当前标记");
assert.equal(digest.overdueCount, 3, "逾期计数不限优先级");
assert.equal(digest.merged.length, 4, "3 项逾期 + 2 项卡点，既是卡点又逾期的需求只出现一次");
assert.match(digest.markdown, /^## Horus 每日异常摘要 · 2026-10-21/);
assert.match(digest.markdown, /> 2 项卡点 · 3 项逾期/);
assert.doesNotMatch(digest.markdown, /高优逾期/, "摘要不再把逾期收窄成高优逾期");

const line = title => digest.merged.find(item => item.includes(title));
assert.match(line("需求 1"), /卡点：等待安全团队确认；逾期 3 天 · 优先级：高（期望上线\/完成 2026-10-18）/);
assert.match(line("需求 2"), /逾期 11 天 · 优先级：中（期望上线\/完成 2026-10-10）/);
assert.match(line("需求 3"), /逾期 1 天 · 优先级：低（期望上线\/完成 2026-10-20）/);
assert.match(line("需求 7"), /^- \*\*需求 7\*\* · 平台组\n {2}卡点：等待第三方接口 · 负责人：林小满$/m);
assert.ok(!line("需求 4") && !line("需求 5") && !line("需求 6"), "未到期、已上线、未填日期的需求都不推送");
assert.match(digest.markdown, /\[打开 Horus 工作台\]\(https:\/\/horus\.example\.com\)/);

// 优先级用简短标签，避免「高优先级 · 优先级：高优先级」这类重复表述
assert.equal(digest.overdueCount, 3);
assert.match(line("需求 3"), /优先级：低/, "低优先级逾期同样进入摘要");

// 上次未送达的内容合并进来，并保持去重
const pending = ["- **需求 2** · 平台组\n  逾期 11 天 · 优先级：中（期望上线/完成 2026-10-10） · 负责人：林小满", "- **遗留需求** · 平台组\n  卡点：等待排期 · 负责人：张铭"];
const retry = composeDigest(requirements, [team], today, pending, "");
assert.equal(retry.merged.length, 5, "遗留行与今日行合并去重");
assert.match(retry.markdown, /含上次未送达摘要/);
assert.match(retry.markdown, /遗留需求/);

// 一切正常时的兜底文案与注入防护
const clean = composeDigest([row(8, { title: "上线 *公告* 文案", priority: "high", expectedDate: "2026-10-01" })], [team], today, [], "");
assert.match(clean.markdown, /上线 \\\*公告\\\* 文案/, "Markdown 控制字符需转义");
const empty = composeDigest([], [team], today, [], "");
assert.match(empty.markdown, /0 项卡点 · 0 项逾期/);
assert.match(empty.markdown, /所有需求有序推进，暂无卡点或逾期。/);

// 下周待启动的卡点/逾期不进入摘要，直到下周一 09:00 的创建时间生效。
const upcoming = composeDigest([
  row(9, { blocked: true, blockReason: "下周才启动", createdAt: "2026-10-26T01:00:00.000Z" }),
  row(10, { priority: "high", expectedDate: "2026-10-01", createdAt: "2026-10-26T01:00:00.000Z" }),
], [team], today, [], "");
assert.equal(upcoming.blockedCount, 0, "下周待启动不计入卡点");
assert.equal(upcoming.overdueCount, 0, "下周待启动不计入逾期");
assert.equal(upcoming.merged.length, 0);
// 本周创建的需求照常推送。
const current = composeDigest([row(11, { blocked: true, blockReason: "本周卡点", createdAt: "2026-10-20T01:00:00.000Z" })], [team], today, [], "");
assert.equal(current.blockedCount, 1);

console.log("DIGEST CONTENT TESTS PASSED");
