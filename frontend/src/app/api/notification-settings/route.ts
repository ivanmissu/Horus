import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationSettings } from "@/db/schema";
import { AppError, assertOwner, getActor } from "@/lib/auth";
import { isPreviewMode } from "@/lib/preview";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };

/** Credentials are fetched only on the settings page, and only for a space administrator. */
export async function GET() {
  try {
    const { actor } = await getActor();
    assertOwner(actor);
    if (isPreviewMode()) return NextResponse.json({ webhook: "", signingSecret: "" }, { headers: privateHeaders });
    const [settings] = await db.select({ webhook: notificationSettings.webhook, signingSecret: notificationSettings.signingSecret })
      .from(notificationSettings).where(eq(notificationSettings.id, "default")).limit(1);
    if (!settings) throw new AppError("通知设置尚未初始化，请联系管理员执行数据库初始化", 503);
    return NextResponse.json(settings, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    console.error("Horus notification settings could not be loaded");
    return NextResponse.json({ error: "通知配置暂时无法加载，请稍后重试" }, { status: 500, headers: privateHeaders });
  }
}
