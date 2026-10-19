const fs = require("node:fs");
const dotenv = require("dotenv");

function loadEnv(env = process.env) {
  const path = env.HORUS_ENV_FILE || "/app/.env";
  let content;
  try {
    content = fs.readFileSync(path);
  } catch (error) {
    // Existing Compose / docker -e deployments do not need a mounted file.
    if (error.code === "ENOENT" && !env.HORUS_ENV_FILE) return;
    throw error;
  }
  const parsed = dotenv.parse(content);
  // Explicit container environment takes precedence, like dotenv / Next.js.
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
}

module.exports = { loadEnv };
