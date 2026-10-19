import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { GET } from "../src/app/api/health/route.ts";
const require = createRequire(import.meta.url);
const { loadEnv } = require("../load-env.cjs");
const dir = mkdtempSync(join(tmpdir(), "horus-env-"));
try {
  const path = join(dir, ".env");
  writeFileSync(path, 'DATABASE_URL=mysql://test/db\nHORUS_INIT_OWNER_NAME="团队 负责人"\nAPP_URL=https://example.com\nLITERAL=$(touch /tmp/not-executed)\n');
  const env = { HORUS_ENV_FILE: path, APP_URL: "https://override.example.com" };
  loadEnv(env);
  assert.equal(env.DATABASE_URL, "mysql://test/db");
  assert.equal(env.HORUS_INIT_OWNER_NAME, "团队 负责人");
  assert.equal(env.APP_URL, "https://override.example.com");
  assert.equal(env.LITERAL, "$(touch /tmp/not-executed)");
  assert.throws(() => loadEnv({ HORUS_ENV_FILE: join(dir, "missing") }), /ENOENT/);
  const source = readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  for (let i = 0; i < 3; i++) {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true });
  }
  console.log("Deployment configuration and DB-independent heartbeat tests passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
