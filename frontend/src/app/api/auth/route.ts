import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { databaseDialect, db } from "@/db";
import { members, sessions } from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { AppError, hashToken } from "@/lib/auth";
import { purgeExpiredSessions } from "@/lib/sessions";
import { isPreviewMode } from "@/lib/preview";

const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: NextRequest) {
  try {
    if (isPreviewMode()) throw new AppError("只读预览不支持账号登录，请配置数据库", 503);
    if (process.env.HORUS_DEMO_MODE === "true") await ensureSeed();
    await purgeExpiredSessions();
    const body = await request.json();
    const jar = await cookies();
    if (body.action === "logout") {
      const bearer = process.env.HORUS_EMBEDDED_PREVIEW === "true"
        ? request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/i)?.[1] : undefined;
      for (const token of new Set([jar.get("horus_session")?.value, bearer].filter((value): value is string => !!value))) {
        await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
      }
      jar.delete("horus_session");
      return NextResponse.json({ ok: true });
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!username || username.length > 32) throw new AppError("请输入有效的登录账号");
    const key = `${request.headers.get("x-forwarded-for")?.split(",")[0] || "local"}:${username}`;
    if (attempts.size > 1000) for (const [id, entry] of attempts) if (entry.until < Date.now()) attempts.delete(id);
    const record = attempts.get(key);
    if (record && record.until > Date.now() && record.count >= 12) throw new AppError("尝试次数过多，请 15 分钟后重试", 429);
    attempts.set(key, { count: record && record.until > Date.now() ? record.count + 1 : 1, until: record && record.until > Date.now() ? record.until : Date.now() + 15 * 60000 });
    const [member] = await db.select().from(members).where(and(eq(members.username, username), eq(members.active, true)));
    if (!member) throw new AppError("账号不存在或已停用，请联系团队负责人", 401);
    if (body.action === "identify") return NextResponse.json({ firstLogin: !member.passwordHash, name: member.name });
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) throw new AppError("密码至少为 8 个字符，且不能超过 72 字节");
    if (!member.passwordHash) {
      const passwordHash = await hash(password, 12);
      const passwordUpdate = db.update(members).set({ passwordHash }).where(and(eq(members.id, member.id), isNull(members.passwordHash)));
      const updated = databaseDialect === "postgres"
        ? await (passwordUpdate as any).returning({ id: members.id })
        : await passwordUpdate;
      const saved = databaseDialect === "postgres" ? updated.length > 0 : Number(updated[0]?.affectedRows ?? 0) > 0;
      if (!saved) throw new AppError("此账号已设置密码，请重新登录", 409);
    } else if (!(await compare(password, member.passwordHash))) throw new AppError("账号或密码不正确", 401);
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 86400000);
    await db.insert(sessions).values({ id: hashToken(token), memberId: member.id, expiresAt: expires.toISOString() });
    // Arena's HTTPS preview is embedded cross-site. Lax cookies are not sent in
    // that iframe; a Secure, partitioned cookie keeps the preview session local
    // to its top-level site without weakening the normal first-party policy.
    const forwardedHost = request.headers.get("x-forwarded-host") || "";
    const host = request.headers.get("host") || "";
    const embeddedPreview = process.env.HORUS_EMBEDDED_PREVIEW === "true"
      || (process.env.NODE_ENV === "development" && [forwardedHost, host].some(value => /\.e2b\.app(?::\d+)?$/i.test(value)));
    // Match the browser-facing scheme. Intranet HTTP cannot store a Secure
    // cookie; behind HTTPS the reverse proxy must forward X-Forwarded-Proto.
    const externalProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const secure = embeddedPreview || externalProto === "https" || request.nextUrl.protocol === "https:";
    jar.set("horus_session", token, {
      httpOnly: true,
      secure,
      sameSite: embeddedPreview ? "none" : "lax",
      ...(embeddedPreview ? { partitioned: true } : {}),
      path: "/",
      expires,
    });
    attempts.delete(key);
    return NextResponse.json(
      { ok: true, ...(process.env.HORUS_EMBEDDED_PREVIEW === "true" ? { previewToken: token } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const databaseMissing = !process.env.DATABASE_URL;
    const message = error instanceof AppError
      ? error.message
      : databaseMissing
        ? "尚未配置数据库，请先设置 DATABASE_URL 并初始化数据表"
        : "登录暂时不可用，请稍后重试";
    const status = error instanceof AppError ? error.status : databaseMissing ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
