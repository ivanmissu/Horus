import { lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString()));
}
