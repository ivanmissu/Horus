import assert from "node:assert/strict";
import { canCreateRequirement, canMaintain, canViewTeam, roleLabel } from "../src/lib/domain.ts";

const owner = { role: "owner", teamIds: [] };
const pm = { role: "pm", teamIds: ["platform"] };
const observer = { role: "observer", teamIds: ["platform"] };
const unboundPm = { role: "pm", teamIds: [] };

// 负责人：全部团队可查看、可维护、可新建
assert.equal(canViewTeam(owner, "data"), true);
assert.equal(canMaintain(owner, "data"), true);
assert.equal(canCreateRequirement(owner), true);

// 产品经理：只能查看、维护绑定团队
assert.equal(canViewTeam(pm, "platform"), true);
assert.equal(canViewTeam(pm, "data"), false);
assert.equal(canMaintain(pm, "platform"), true);
assert.equal(canMaintain(pm, "data"), false);
assert.equal(canCreateRequirement(pm), true);
assert.equal(canCreateRequirement(unboundPm), false);

// 观察员：只能查看绑定团队，任何团队都不能维护、不能新建
assert.equal(canViewTeam(observer, "platform"), true);
assert.equal(canViewTeam(observer, "data"), false);
assert.equal(canMaintain(observer, "platform"), false);
assert.equal(canMaintain(observer, "data"), false);
assert.equal(canCreateRequirement(observer), false);

assert.equal(roleLabel("observer"), "观察员");
assert.equal(roleLabel("pm"), "产品经理");
assert.equal(roleLabel("owner"), "团队负责人");

console.log("ROLE PERMISSION TESTS PASSED");
