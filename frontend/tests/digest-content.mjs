import assert from "node:assert/strict";
import { composeDigest, countPendingArchiveByTeam } from "../src/lib/digest.ts";

// 钉钉每日摘要：卡点 + 全部逾期（不限优先级） + 历史未归档各团队数量（不含需求详情；全局为 0 时隐藏）。
const today = "2026-10-21";
const team = { id: "platform", name: "平台组" };
const productTeam = { id: "product", name: "产品组" };
const dataTeam = { id: "data", name: "数据*组" };
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
assert.equal(digest.pendingArchiveCount, 0, "无历史未归档时计数为 0");
assert.deepEqual(digest.pendingArchiveTeams, []);
assert.equal(digest.merged.length, 4, "3 项逾期 + 2 项卡点，既是卡点又逾期的需求只出现一次");
assert.match(digest.markdown, /^## Horus 每日异常摘要 · 2026-10-21/);
assert.match(digest.markdown, /^> 2 项卡点 · 3 项逾期$/m);
assert.doesNotMatch(digest.markdown, /待归档/, "全局无历史未归档时完全隐藏待归档内容");
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

// 历史未归档不作为卡点或逾期明细推送，只按团队汇总数量（不带需求详情，不进入重试队列 merged）。
const historicalArchive = row(12, { title: "历史待归档不得推送详情", status: "released", blocked: true, blockReason: "旧卡点", expectedDate: "2026-09-01", releasedAt: "2026-10-01T00:00:00.000Z", archivedAt: null });
const archiveDigest = composeDigest([historicalArchive], [team], today, [], "https://horus.example.com");
assert.equal(archiveDigest.blockedCount, 0);
assert.equal(archiveDigest.overdueCount, 0);
assert.equal(archiveDigest.pendingArchiveCount, 1);
assert.equal(archiveDigest.merged.length, 0, "待归档不进入异常明细或失败重试列表");
assert.doesNotMatch(archiveDigest.markdown, /历史待归档不得推送详情|旧卡点|2026-09-01|林小满/);
assert.doesNotMatch(archiveDigest.markdown, /(^|[^史])待归档/, "文案需明确提示为「历史待归档」，避免与本周「待归档」混淆");
assert.match(archiveDigest.markdown, /^> 0 项卡点 · 0 项逾期 · 1 项历史待归档$/m);
assert.match(
  archiveDigest.markdown,
  /所有需求有序推进，暂无卡点或逾期。\n\n\*\*历史待归档\*\*：平台组 1 项\n\n\[打开 Horus 工作台\]\(https:\/\/horus\.example\.com\)$/,
  "历史待归档各团队数量位于异常区域下方、工作台链接上方",
);

// 多团队待归档统计口径：仅计入本周一 00:00（北京时间）前已上线且未归档的历史项，只列出 >0 的团队并按团队列表顺序展示。
// 2026-10-21（周三）所在自然周起点为 2026-10-19T00:00:00+08:00（即 2026-10-18T16:00:00.000Z）。
const mixedArchiveItems = [
  row(20, { teamId: "platform", title: "卡点进行中", blocked: true, blockReason: "联调受阻" }),
  // 平台组：2 项历史未归档（含 1 项无 releasedAt 用 enteredAt 兜底）+ 1 项本周刚上线待归档 + 1 项已归档
  row(21, { teamId: "platform", title: "历史甲", status: "released", releasedAt: "2026-10-18T15:59:59.999Z", archivedAt: null }),
  row(22, { teamId: "platform", title: "历史乙（旧数据兜底）", status: "released", releasedAt: null, enteredAt: "2026-10-10T02:00:00.000Z", archivedAt: null }),
  row(23, { teamId: "platform", title: "本周上线不计入", status: "released", releasedAt: "2026-10-18T16:00:00.000Z", archivedAt: null }),
  row(24, { teamId: "platform", title: "已归档不计入", status: "released", releasedAt: "2026-10-01T00:00:00.000Z", archivedAt: "2026-10-15T00:00:00.000Z" }),
  // 产品组：仅有本周待归档与已取消（历史未归档为 0，不得出现在团队明细中）
  row(25, { teamId: "product", title: "产品本周待归档", status: "released", releasedAt: "2026-10-20T03:00:00.000Z", archivedAt: null }),
  row(26, { teamId: "product", title: "产品已取消", status: "cancelled", releasedAt: null, enteredAt: "2026-10-01T00:00:00.000Z", archivedAt: "2026-10-02T00:00:00.000Z" }),
  // 数据*组：1 项历史未归档，且团队名中的 Markdown 字符需转义
  row(27, { teamId: "data", title: "数据历史待归档", status: "released", releasedAt: "2026-10-12T08:00:00.000Z", archivedAt: null }),
];
const allTeams = [team, productTeam, dataTeam];
assert.deepEqual(countPendingArchiveByTeam(mixedArchiveItems, allTeams, "2026-10-21T09:30:00+08:00"), [
  { teamId: "platform", name: "平台组", count: 2 },
  { teamId: "data", name: "数据*组", count: 1 },
]);
const multiTeamDigest = composeDigest(mixedArchiveItems, allTeams, today, pending, "https://horus.example.com");
assert.equal(multiTeamDigest.pendingArchiveCount, 3);
assert.match(multiTeamDigest.markdown, /^> 1 项卡点 · 0 项逾期 · 3 项历史待归档 · 含上次未送达摘要$/m);
assert.match(multiTeamDigest.markdown, /\*\*历史待归档\*\*：平台组 2 项 · 数据\\\*组 1 项/);
assert.doesNotMatch(multiTeamDigest.markdown, /产品组/, "待归档为 0 的团队不展示");
assert.doesNotMatch(multiTeamDigest.markdown, /历史甲|历史乙|本周上线不计入|数据历史待归档/, "任何待归档需求标题均不出现在通知中");

// 仅有本周待归档（无历史未归档）时，全局历史未归档为 0，完全隐藏待归档区块
const thisWeekOnlyDigest = composeDigest([
  row(28, { teamId: "platform", title: "本周待归档", status: "released", releasedAt: "2026-10-20T02:00:00.000Z", archivedAt: null }),
], allTeams, today, [], "");
assert.equal(thisWeekOnlyDigest.pendingArchiveCount, 0);
assert.doesNotMatch(thisWeekOnlyDigest.markdown, /待归档/);

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
