import assert from "node:assert/strict";
import { canCreatePoolItem, canDecidePoolTeam, canMaintain, canMaintainPoolTeam, canViewPoolTeam, poolStatusLabel } from "../src/lib/domain.ts";

// 需求池权限矩阵：可见范围、维护范围与「筛选结论」权限是三件不同的事。
const owner = { role: "owner", teamIds: [] };
const pm = { role: "pm", teamIds: ["platform"] };
const observer = { role: "observer", teamIds: ["platform"] };
const unboundPm = { role: "pm", teamIds: [] };

// 空间管理员：全部团队可见 / 可维护 / 可给出结论。
assert.equal(canViewPoolTeam(owner, "data"), true);
assert.equal(canMaintainPoolTeam(owner, "data"), true);
assert.equal(canDecidePoolTeam(owner, "data"), true);
assert.equal(canCreatePoolItem(owner), true);

// 产品经理：仅绑定团队可见、可给出筛选结论；需求池只读，不能新建或编辑条目。
assert.equal(canViewPoolTeam(pm, "platform"), true);
assert.equal(canViewPoolTeam(pm, "data"), false);
assert.equal(canMaintainPoolTeam(pm, "platform"), false);
assert.equal(canMaintainPoolTeam(pm, "data"), false);
assert.equal(canDecidePoolTeam(pm, "platform"), true);
assert.equal(canDecidePoolTeam(pm, "data"), false);
assert.equal(canCreatePoolItem(pm), false);
assert.equal(canCreatePoolItem(unboundPm), false);

// 业务负责人：可浏览全部团队的池子，但只能维护自己绑定团队的条目（新建 / 编辑），
// 且筛选结论（不采纳 / 转为正式需求 / 重新评估）仅限产品经理与空间管理员。
assert.equal(canViewPoolTeam(observer, "platform"), true);
assert.equal(canViewPoolTeam(observer, "data"), true);
assert.equal(canMaintainPoolTeam(observer, "platform"), true);
assert.equal(canMaintainPoolTeam(observer, "data"), false);
assert.equal(canDecidePoolTeam(observer, "platform"), false);
assert.equal(canDecidePoolTeam(observer, "data"), false);
assert.equal(canCreatePoolItem(observer), true);

// 需求池的写入权限不能泄漏到需求管理流程：业务负责人对需求仍然只读。
assert.equal(canMaintain(observer, "platform"), false);

assert.equal(poolStatusLabel("pending"), "待评估");
assert.equal(poolStatusLabel("accepted"), "已采纳");
assert.equal(poolStatusLabel("rejected"), "不采纳");

console.log("REQUIREMENT POOL PERMISSION TESTS PASSED");
