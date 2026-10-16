import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { members, sessions } from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import type { Member } from "./types";

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function publicMember(member: typeof members.$inferSelect): Member {
  const { passwordHash, ...safe } = member;
  return { ...safe, firstLogin: !passwordHash };
}
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function isDemoMode() { return process.env.HORUS_DEMO_MODE === "true"; }
export async function getActor(): Promise<{ actor: Member; demo: boolean }> {
  const demoMode = isDemoMode();
  if (demoMode) await ensureSeed();
  const token = (await cookies()).get("horus_session")?.value;
  if (token) {
    const [result] = await db.select({ member: members }).from(sessions)
      .innerJoin(members, eq(sessions.memberId, members.id))
      .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date().toISOString()), eq(members.active, true)));
    if (!result) throw new AppError("登录已过期或账号已停用，请重新登录", 401);
    return { actor: publicMember(result.member), demo: false };
  }
  if (!demoMode) throw new AppError("请先登录", 401);
  const [owner] = await db.select().from(members).where(and(eq(members.id, "owner"), eq(members.active, true)));
  if (!owner) throw new AppError("请先登录", 401);
  return { actor: publicMember(owner), demo: true };
}
export function assertOwner(actor: Member) {
  if (actor.role !== "owner") throw new AppError("此操作仅限团队负责人", 403);
}
export function assertTeam(actor: Member, teamId: string) {
  if (actor.role !== "owner" && !actor.teamIds.includes(teamId)) throw new AppError("你没有维护该团队的权限", 403);
}
