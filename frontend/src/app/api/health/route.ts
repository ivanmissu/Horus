import { db } from "@/db";
import { sql } from "drizzle-orm";
import { isPreviewMode } from "@/lib/preview";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isPreviewMode()) return Response.json({ ok: true, mode: "read-only-preview" });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
