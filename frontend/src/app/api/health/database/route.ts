import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { normalizePostgresConnectionString } from "@/db/dialect";
import { members, sessions } from "@/db/schema";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function sslModeInfo() {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return { sslMode: "unset", normalizedSslMode: "unset" };
    const rawUrl = new URL(connectionString);
    const normalizedUrl = new URL(normalizePostgresConnectionString(connectionString));
    return {
      sslMode: rawUrl.searchParams.get("sslmode")?.toLowerCase() || "unset",
      normalizedSslMode: normalizedUrl.searchParams.get("sslmode")?.toLowerCase() || "unset",
    };
  } catch {
    return { sslMode: "invalid-url", normalizedSslMode: "invalid-url" };
  }
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const value = error as { code?: unknown; cause?: unknown };
  const cause = value.cause && typeof value.cause === "object"
    ? value.cause as { code?: unknown }
    : undefined;
  const code = typeof value.code === "string" ? value.code : cause?.code;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "UNKNOWN";
}

// Read-only readiness probe for the tables used during sign-in.
// It returns only a generic status and a sanitized driver/SQLSTATE code.
export async function GET() {
  try {
    await db.select({ id: sessions.id }).from(sessions).limit(1);
    await db.select({ id: members.id })
      .from(members)
      .where(and(eq(members.username, process.env.HORUS_INIT_OWNER_USERNAME || "admin"), eq(members.active, true)))
      .limit(1);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    const code = safeErrorCode(error);
    console.error("Horus database readiness check failed", { code });
    return Response.json({ ok: false, code, ...sslModeInfo() }, { status: 503, headers: noStore });
  }
}
