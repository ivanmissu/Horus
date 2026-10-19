export async function register() {
  // Vercel functions are invoked on demand and cannot keep a reliable process
  // timer alive. The in-process scheduler is reserved for persistent Node hosts.
  // Scheduled digest is intentionally disabled on the current Vercel deployment.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL !== "1" && process.env.HORUS_DISABLE_IN_PROCESS_SCHEDULER !== "true") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
