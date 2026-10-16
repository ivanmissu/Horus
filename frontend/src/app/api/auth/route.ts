import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { members, sessions } from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { AppError, hashToken } from "@/lib/auth";

const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: NextRequest) {
  try {
    await ensureSeed();
    const body = await request.json();
    const jar = await cookies();
    if (body.action === "logout") {
      const token = jar.get("horus_session")?.value;
      if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
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
      const [updated] = await db.update(members).set({ passwordHash }).where(and(eq(members.id, member.id), isNull(members.passwordHash))).returning();
      if (!updated) throw new AppError("此账号已设置密码，请重新登录", 409);
    } else if (!(await compare(password, member.passwordHash))) throw new AppError("账号或密码不正确", 401);
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 86400000);
    await db.insert(sessions).values({ id: hashToken(token), memberId: member.id, expiresAt: expires.toISOString() });
    jar.set("horus_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
    attempts.delete(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AppError ? error.message : "登录暂时不可用，请稍后重试" }, { status: error instanceof AppError ? error.status : 500 });
  }
}
