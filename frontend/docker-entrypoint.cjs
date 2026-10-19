// Load the mounted dotenv before ANY database initialization or Next.js startup.
// Do not source dotenv as shell: values are data, not executable commands.
const { spawn } = require("node:child_process");
const { loadEnv } = require("./load-env.cjs");

try {
  loadEnv();
} catch (error) {
  console.error(`Cannot load Horus configuration: ${error.message}`);
  process.exit(1);
}

const child = spawn("/usr/local/bin/docker-entrypoint.sh", process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", error => {
  console.error(`Cannot start Horus: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === "SIGTERM" ? 143 : 130));
});
