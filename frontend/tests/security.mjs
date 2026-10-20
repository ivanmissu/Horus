import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const apiResponse = await fetch(`${base}/api/workspace`, { redirect: "manual" });
assert.equal(apiResponse.status, 401, "workspace API must reject anonymous requests when demo mode is off");
const apiBody = await apiResponse.json();
assert.equal(apiBody.error, "请先登录");

const statsResponse = await fetch(`${base}/api/stats?granularity=week`, { redirect: "manual" });
assert.equal(statsResponse.status, 401, "statistics API must reject anonymous requests");
assert.equal((await statsResponse.json()).error, "请先登录");

const rootResponse = await fetch(base, { redirect: "manual" });
assert.ok([307, 308].includes(rootResponse.status), `expected login redirect, got ${rootResponse.status}`);
assert.ok(rootResponse.headers.get("location")?.endsWith("/login"), "anonymous page request must redirect to /login");

const loginResponse = await fetch(`${base}/login`);
assert.equal(loginResponse.status, 200);
const loginHtml = await loginResponse.text();
assert.ok(loginHtml.includes("login-page"), "login page should render");
assert.ok(!loginHtml.includes("login-demo"), "login page must not show demo shortcuts by default");
assert.ok(!loginHtml.includes("团队负责人 · chen"), "demo accounts must not appear in secure mode");
console.log("SECURE DEFAULT AUTHENTICATION TESTS PASSED");
