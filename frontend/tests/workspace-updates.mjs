import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";
import { auditLogs, members, notificationLogs, notificationSettings, requirementEvents, requirementPool, requirements, sessions, teams } from "../src/db/schema.ts";
import { isHistoricalPendingArchive, startOfShanghaiWeek, todayString } from "../src/lib/domain.ts";

// Uses real writes and a disposable demo-mode database. Never run against production.
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to an isolated test database");
const suffix = Date.now().toString(36);
const teamIds = [], memberIds = [];
let browser, originalSettings, originalAuditMax = 0;
const errors = [];
const webhook = `https://oapi.dingtalk.com/robot/send?access_token=workspace-test-${suffix}`;
const secret = `SEC_workspace_test_${suffix}`;
const updatedWebhook = `https://oapi.dingtalk.com/robot/send?access_token=workspace-updated-${suffix}`;
const updatedSecret = `SEC_workspace_updated_${suffix}`;

async function request(path, { method = "GET", body, cookie = "", expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
  return { result, response };
}
async function post(action, values = {}, cookie = "", expected = 200) {
  return (await request("/api/workspace", { method: "POST", body: { action, ...values }, cookie, expected })).result;
}
const workspace = async (cookie = "") => (await request("/api/workspace", { cookie })).result;
async function login(username) {
  const { response } = await request("/api/auth", { method: "POST", body: { action: "login", username, password: `Horus-${randomBytes(12).toString("hex")}` } });
  return response.headers.get("set-cookie").split(";")[0];
}
async function makeMember(name, username, role, teamId) {
  await post("createMember", { name, username, role, teamIds: [teamId] });
  const member = (await workspace()).members.find(item => item.username === username);
  memberIds.push(member.id);
  return { ...member, cookie: await login(username) };
}
async function newPool(teamId, title, cookie) {
  return (await post("createPoolItem", { teamId, title, submitter: "原业务提报人", priority: "medium" }, cookie)).id;
}
const log = message => console.log(`PASS ${message}`);

try {
  const baseline = await workspace();
  assert.equal(baseline.demo, true, "start the test server with HORUS_DEMO_MODE=true and an isolated database");
  assert.equal(baseline.actor.role, "owner");
  originalSettings = (await db.select().from(notificationSettings).where(eq(notificationSettings.id, "default")))[0];
  assert.ok(originalSettings, "initialize notification settings in the isolated test database first");
  // Never let the scheduler deliver a real message while this suite is running.
  await db.update(notificationSettings).set({ enabled: false }).where(eq(notificationSettings.id, "default"));
  originalAuditMax = Math.max(0, ...(await db.select({ id: auditLogs.id }).from(auditLogs)).map(item => item.id));
  const logCount = (await db.select({ id: notificationLogs.id }).from(notificationLogs)).length;

  const visibleTeam = (await post("createTeam", { name: `__提醒测试_${suffix}` })).id;
  teamIds.push(visibleTeam);
  const hiddenTeam = (await post("createTeam", { name: `__不可见团队_${suffix}` })).id;
  teamIds.push(hiddenTeam);
  const pm = await makeMember(`测试PM${suffix}`, `pm_${suffix}`, "pm", visibleTeam);
  const observer = await makeMember(`测试业务${suffix}`, `obs_${suffix}`, "observer", visibleTeam);

  // Defaults apply on both creation routes, while an explicit name or empty string remains editable.
  const directDefault = (await post("createRequirement", { teamId: visibleTeam, title: `__默认负责人_${suffix}` }, pm.cookie)).id;
  const directCustom = (await post("createRequirement", { teamId: visibleTeam, title: `__自定义负责人_${suffix}`, owner: "自定义负责人" }, pm.cookie)).id;
  const directBlank = (await post("createRequirement", { teamId: visibleTeam, title: `__清空负责人_${suffix}`, owner: "" }, pm.cookie)).id;
  let pmData = await workspace(pm.cookie);
  assert.equal(pmData.requirements.find(r => r.id === directDefault).owner, pm.name);
  assert.equal(pmData.requirements.find(r => r.id === directCustom).owner, "自定义负责人");
  assert.equal(pmData.requirements.find(r => r.id === directBlank).owner, "");
  for (const [index, owner] of [undefined, "转入自定义", ""].entries()) {
    const title = `__转入负责人_${index}_${suffix}`;
    const poolId = await newPool(visibleTeam, title, observer.cookie);
    const convertedId = (await post("convertPoolItem", { id: poolId, title, expectedDate: todayString(), ...(owner === undefined ? {} : { owner }) }, pm.cookie)).id;
    pmData = await workspace(pm.cookie);
    assert.equal(pmData.requirements.find(r => r.id === convertedId).owner, owner === undefined ? pm.name : owner);
    assert.equal(pmData.pool.find(item => item.id === poolId).submitter, "原业务提报人");
  }
  const uiPoolId = await newPool(visibleTeam, `__浏览器转入_${suffix}`, observer.cookie);
  log("默认负责人、手动修改及需求池转入接口");

  // Create a known backlog in the PM's team; other states and another team must not affect its count.
  const historicTitles = [`__历史待归档甲_${suffix}`, `__历史待归档乙_${suffix}`];
  const historicIds = [];
  for (const title of historicTitles) historicIds.push((await post("createRequirement", { teamId: visibleTeam, title }, pm.cookie)).id);
  const currentId = (await post("createRequirement", { teamId: visibleTeam, title: `__本周上线_${suffix}` }, pm.cookie)).id;
  const archivedId = (await post("createRequirement", { teamId: visibleTeam, title: `__已归档_${suffix}` }, pm.cookie)).id;
  const hiddenId = (await post("createRequirement", { teamId: hiddenTeam, title: `__不可见历史_${suffix}` })).id;
  const historicalDate = new Date(startOfShanghaiWeek().getTime() - 86400000).toISOString();
  const thisWeek = new Date().toISOString();
  await db.update(requirements).set({ status: "released", stageId: "released", enteredAt: historicalDate, releasedAt: historicalDate, archivedAt: null }).where(inArray(requirements.id, [...historicIds, hiddenId]));
  await db.update(requirements).set({ status: "released", stageId: "released", enteredAt: thisWeek, releasedAt: thisWeek, archivedAt: null }).where(eq(requirements.id, currentId));
  await db.update(requirements).set({ status: "released", stageId: "released", enteredAt: historicalDate, releasedAt: historicalDate, archivedAt: thisWeek }).where(eq(requirements.id, archivedId));
  pmData = await workspace(pm.cookie);
  assert.equal(pmData.requirements.filter(r => isHistoricalPendingArchive(r, pmData.now)).length, 2);
  assert.ok(!pmData.requirements.some(r => r.id === hiddenId));
  const observerData = await workspace(observer.cookie);
  assert.equal(observerData.requirements.filter(r => isHistoricalPendingArchive(r, observerData.now)).length, 2);
  log("历史时间边界、已归档和团队可见范围");

  // The general payload is redacted; a separate, non-cacheable endpoint requires an owner.
  await post("saveNotifications", { enabled: false, time: "13:37", webhook, signingSecret: secret, appUrl: base });
  const credentialResponse = await request("/api/notification-settings");
  assert.deepEqual(credentialResponse.result, { webhook, signingSecret: secret });
  assert.match(credentialResponse.response.headers.get("cache-control"), /no-store/);
  assert.match(credentialResponse.response.headers.get("cache-control"), /private/);
  await request("/api/notification-settings", { cookie: pm.cookie, expected: 403 });
  await request("/api/notification-settings", { cookie: observer.cookie, expected: 403 });
  await post("saveNotifications", { enabled: false, time: "13:37", webhook, signingSecret: secret, appUrl: base }, pm.cookie, 403);
  for (const data of [await workspace(), await workspace(pm.cookie), await workspace(observer.cookie)]) {
    assert.equal("webhook" in data.settings, false);
    assert.equal("signingSecret" in data.settings, false);
    assert.ok(!JSON.stringify(data).includes(secret));
    assert.ok(!JSON.stringify(data).includes(webhook));
  }
  const settingsHtml = await (await fetch(`${base}/settings/notifications`)).text();
  assert.ok(!settingsHtml.includes(secret) && !settingsHtml.includes(webhook), "credentials must not appear in server-rendered HTML or RSC workspace data");
  log("密钥只经管理员专用、禁止缓存的接口返回");

  browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.TEST_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {}) });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  ownerPage.on("pageerror", error => errors.push(error.message));

  // Every desktop navigation item, including teams and management, gets the selected dot.
  const ownerData = await workspace();
  const ownerHistoryCount = ownerData.requirements.filter(r => isHistoricalPendingArchive(r, ownerData.now)).length;
  assert.ok(ownerHistoryCount >= 3, "owner can see the two test items and the hidden-team item");
  for (const path of ["/", "/pool", "/stats", "/requirements", "/archive", `/teams/${visibleTeam}`, "/settings/stages", "/settings/members", "/settings/notifications"]) {
    await ownerPage.goto(base + path, { waitUntil: "networkidle" });
    const selected = ownerPage.locator(".nav-item.active");
    assert.equal(await selected.count(), 1, path);
    assert.equal(await selected.getAttribute("aria-current"), "page", path);
    assert.equal(await selected.locator(".nav-active-dot").isVisible(), true, path);
    assert.equal(await ownerPage.locator(".archive-reminder").isVisible(), true, path);
    assert.match(await ownerPage.locator(".archive-reminder").innerText(), new RegExp(`有 ${ownerHistoryCount} 项历史需求尚未归档`), path);
  }
  await ownerPage.getByRole("button", { name: "收起导航" }).click();
  assert.equal(await ownerPage.locator(".nav-item.active .nav-active-dot").isVisible(), true, "compact navigation keeps the selected dot");
  await ownerPage.getByRole("button", { name: "展开导航" }).click();
  log("全站提醒与所有导航选中圆点（含收起状态）");

  // Settings must prefill both saved values, default to masked, survive refresh,
  // and update/clear without leaking to the shared workspace or DingTalk.
  await ownerPage.locator("#notify-webhook:not([disabled])").waitFor();
  assert.equal(await ownerPage.locator("#notify-webhook").inputValue(), webhook);
  assert.equal(await ownerPage.locator("#notify-secret").inputValue(), secret);
  assert.equal(await ownerPage.locator("#notify-webhook").getAttribute("type"), "password");
  assert.equal(await ownerPage.locator("#notify-secret").getAttribute("type"), "password");
  await ownerPage.getByRole("button", { name: "显示 Webhook" }).click();
  await ownerPage.getByRole("button", { name: "显示加签密钥" }).click();
  assert.equal(await ownerPage.locator("#notify-webhook").getAttribute("type"), "text");
  assert.equal(await ownerPage.locator("#notify-secret").getAttribute("type"), "text");
  await ownerPage.reload({ waitUntil: "networkidle" });
  await ownerPage.locator("#notify-secret:not([disabled])").waitFor();
  assert.equal(await ownerPage.locator("#notify-secret").inputValue(), secret);
  // Another administrator may update the saved credentials while this form is open.
  // Saving unrelated settings must not replace those newer values with stale prefills.
  await post("saveNotifications", { enabled: false, time: "13:37", webhook: updatedWebhook, signingSecret: updatedSecret, appUrl: base });
  await ownerPage.getByRole("button", { name: "保存配置" }).click();
  await ownerPage.waitForFunction(expected => document.querySelector("#notify-secret")?.value === expected, updatedSecret);
  assert.deepEqual((await request("/api/notification-settings")).result, { webhook: updatedWebhook, signingSecret: updatedSecret });
  // Manually changing the fields still updates them normally.
  await ownerPage.locator("#notify-webhook").fill(webhook);
  await ownerPage.locator("#notify-secret").fill(secret);
  await ownerPage.getByRole("button", { name: "保存配置" }).click();
  await ownerPage.locator(".toast.success").waitFor();
  await ownerPage.locator("#notify-secret:not([disabled])").waitFor();
  assert.deepEqual((await request("/api/notification-settings")).result, { webhook, signingSecret: secret });
  assert.equal(await ownerPage.locator("#notify-secret").inputValue(), secret);
  await ownerPage.locator("#notify-webhook").fill("");
  await ownerPage.locator("#notify-secret").fill("");
  await ownerPage.getByRole("button", { name: "保存配置" }).click();
  await ownerPage.waitForFunction(expected => document.querySelector("#notify-secret")?.value === expected, secret);
  assert.equal(await ownerPage.locator("#notify-webhook").inputValue(), webhook);
  await ownerPage.getByLabel("移除原有加签密钥").check();
  await ownerPage.getByRole("button", { name: "保存配置" }).click();
  await ownerPage.waitForFunction(() => !document.querySelector('input[type="checkbox"]:checked') && document.querySelector("#notify-secret")?.value === "");
  assert.equal((await request("/api/notification-settings")).result.signingSecret, "");
  await ownerPage.route("**/api/notification-settings", route => route.abort());
  await ownerPage.reload({ waitUntil: "networkidle" });
  await ownerPage.locator(".notification-credential-error").waitFor();
  assert.equal(await ownerPage.getByRole("button", { name: "保存配置" }).isDisabled(), true);
  await ownerPage.unroute("**/api/notification-settings");
  await ownerPage.getByRole("button", { name: "重新加载" }).click();
  await ownerPage.locator("#notify-webhook:not([disabled])").waitFor();
  assert.equal(await ownerPage.locator("#notify-webhook").inputValue(), webhook);
  log("Webhook 和加签密钥回显、显隐、保存、保留、移除和加载失败恢复");

  const observerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await observerContext.addCookies([{ name: "horus_session", value: observer.cookie.split("=")[1], url: base }]);
  const observerPage = await observerContext.newPage();
  await observerPage.clock.install();
  observerPage.on("pageerror", error => errors.push(error.message));
  await observerPage.goto(`${base}/pool`, { waitUntil: "networkidle" });
  assert.match(await observerPage.locator(".archive-reminder").innerText(), /有 2 项历史需求尚未归档/);
  assert.match(await observerPage.locator(".archive-reminder").innerText(), /联系对应团队的产品经理或空间管理员/);
  await observerPage.getByRole("button", { name: "查看待归档" }).click();
  await observerPage.waitForURL("**/?focus=history#workbench-requirements");
  await observerPage.locator(".focus-tab.active").filter({ hasText: "历史未归档" }).waitFor();
  assert.equal(await observerPage.locator(".requirement-table tbody tr").count(), 2);
  await observerPage.locator(".requirement-table tbody tr").filter({ hasText: historicTitles[0] }).click();
  await observerPage.getByRole("dialog").waitFor();
  assert.equal(await observerPage.getByRole("button", { name: "归档需求" }).count(), 0);
  await observerPage.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  log("只读用户可见提醒但不能越权归档");

  const pmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await pmContext.addCookies([{ name: "horus_session", value: pm.cookie.split("=")[1], url: base }]);
  const pmPage = await pmContext.newPage();
  pmPage.on("pageerror", error => errors.push(error.message));
  await pmPage.goto(`${base}/pool`, { waitUntil: "networkidle" });
  await pmPage.locator(".pool-table tbody tr").filter({ hasText: `__浏览器转入_${suffix}` }).getByRole("button", { name: "转为需求" }).click();
  assert.equal(await pmPage.locator("#convert-owner").inputValue(), pm.name);
  await pmPage.locator("#convert-owner").fill("手动修改转入负责人");
  await pmPage.locator("#convert-date").click();
  await pmPage.locator('[data-ui-portal="date"]').getByRole("button", { name: "今天", exact: true }).click();
  await pmPage.getByRole("button", { name: "确认转入" }).click();
  await pmPage.getByRole("dialog", { name: `__浏览器转入_${suffix}` }).waitFor();
  const convertedData = await workspace(pm.cookie);
  const convertedPool = convertedData.pool.find(item => item.id === uiPoolId);
  assert.equal(convertedPool.status, "accepted");
  assert.equal(convertedData.requirements.find(r => r.id === convertedPool.requirementId).owner, "手动修改转入负责人");
  await pmPage.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await pmPage.getByRole("button", { name: "查看待归档" }).click();
  await pmPage.waitForURL("**/?focus=history#workbench-requirements");
  await pmPage.locator(".focus-tab.active").filter({ hasText: "历史未归档" }).waitFor();
  await pmPage.getByRole("button", { name: "新建需求", exact: true }).click();
  assert.equal(await pmPage.locator("#new-owner").inputValue(), pm.name);
  await pmPage.locator("#new-owner").fill("浏览器手动负责人");
  await pmPage.locator("#new-title").fill(`__浏览器新建_${suffix}`);
  await pmPage.locator("#new-date").click();
  await pmPage.locator('[data-ui-portal="date"]').getByRole("button", { name: "今天", exact: true }).click();
  await pmPage.getByRole("button", { name: "创建需求", exact: true }).click();
  await pmPage.getByRole("dialog", { name: `__浏览器新建_${suffix}` }).waitFor();
  assert.equal((await workspace(pm.cookie)).requirements.find(r => r.title === `__浏览器新建_${suffix}`).owner, "浏览器手动负责人");
  await pmPage.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  log("浏览器表单默认当前用户且可修改");

  // A reminder click on the workbench resets searches and focus, so all counted
  // items are actually reachable. It disappears after the last visible item is archived.
  await pmPage.locator(".focus-tab").filter({ hasText: "全部在途" }).click();
  await pmPage.getByRole("textbox", { name: "搜索需求、负责人" }).fill("不会匹配的关键词");
  await pmPage.getByRole("button", { name: "查看待归档" }).click();
  await pmPage.locator(".focus-tab.active").filter({ hasText: "历史未归档" }).waitFor();
  assert.equal(await pmPage.getByRole("textbox", { name: "搜索需求、负责人" }).inputValue(), "");
  assert.equal(await pmPage.locator(".requirement-table tbody tr").count(), 2);
  for (const [index, title] of historicTitles.entries()) {
    await pmPage.locator(".requirement-table tbody tr").filter({ hasText: title }).click();
    await pmPage.getByRole("dialog", { name: title }).getByRole("button", { name: "归档需求" }).click();
    await pmPage.getByRole("button", { name: "确认归档" }).click();
    await pmPage.getByRole("dialog", { name: title }).getByText("已顺利交付，已归档").waitFor();
    await pmPage.getByRole("dialog", { name: title }).getByRole("button", { name: "关闭", exact: true }).click();
    if (index === 0) assert.match(await pmPage.locator(".archive-reminder").innerText(), /有 1 项历史需求尚未归档/);
    // A different user's already-open page synchronizes on the minute timer,
    // and also when returning to a previously hidden tab.
    if (index === 0) {
      await observerPage.clock.fastForward(60_000);
      await observerPage.locator(".archive-reminder").getByText("有 1 项历史需求尚未归档").waitFor();
    } else {
      await observerPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    }
  }
  await pmPage.locator(".archive-reminder").waitFor({ state: "detached" });
  await observerPage.locator(".archive-reminder").waitFor({ state: "detached" });
  assert.equal((await workspace(pm.cookie)).requirements.filter(r => historicIds.includes(r.id) && r.archivedAt).length, 2);
  assert.equal((await db.select({ id: notificationLogs.id }).from(notificationLogs)).length, logCount, "archive reminder must not send to DingTalk");
  log("归档后计数更新并自动消失，不产生钉钉推送");

  const mobile = await ownerContext.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  assert.equal(await mobile.evaluate(() => document.body.scrollWidth), 390);
  await mobile.getByRole("button", { name: "打开导航" }).click();
  assert.equal(await mobile.locator(".nav-item.active .nav-active-dot").isVisible(), true);
  assert.deepEqual(errors, []);
  log("移动端布局和浏览器运行时错误检查");
  console.log("WORKSPACE UPDATE TESTS PASSED");
} finally {
  if (browser) await browser.close();
  if (originalSettings) await db.update(notificationSettings).set(originalSettings).where(eq(notificationSettings.id, "default"));
  if (teamIds.length) {
    await db.transaction(async tx => {
      const rows = await tx.select({ id: requirements.id }).from(requirements).where(inArray(requirements.teamId, teamIds));
      const requirementIds = rows.map(item => item.id);
      const newAudit = (await tx.select().from(auditLogs)).filter(item => item.id > originalAuditMax && (
        requirementIds.includes(item.requirementId) || memberIds.includes(item.actorId) ||
        teamIds.includes(item.detail?.teamId) || memberIds.includes(item.detail?.memberId) ||
        item.action === "saveNotifications" && item.detail?.time === "13:37"
      ));
      if (newAudit.length) await tx.delete(auditLogs).where(inArray(auditLogs.id, newAudit.map(item => item.id)));
      await tx.delete(requirementEvents).where(inArray(requirementEvents.teamId, teamIds));
      await tx.delete(requirementPool).where(inArray(requirementPool.teamId, teamIds));
      await tx.delete(requirements).where(inArray(requirements.teamId, teamIds));
      if (memberIds.length) {
        await tx.delete(sessions).where(inArray(sessions.memberId, memberIds));
        await tx.delete(members).where(inArray(members.id, memberIds));
      }
      await tx.delete(teams).where(inArray(teams.id, teamIds));
    });
  }
  await pool.end();
}
