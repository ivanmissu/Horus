import "dotenv/config";
import { pool } from "./index.ts";
import { backfillRequirementEvents, fillLifecycleTimestamps } from "./backfill-events.ts";

try {
  const result = await backfillRequirementEvents();
  await fillLifecycleTimestamps();
  console.info(`Lifecycle events ready: ${result.requirements} requirements scanned, ${result.events} events considered (duplicates ignored).`);
} finally {
  await pool.end();
}
