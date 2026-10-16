import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { teams, members, requirements, auditLogs, notificationSettings, sessions } from "@/db/schema";
import { loadWorkspace } from "@/lib/data";
import { getActor, AppError, assertOwner, assertTeam } from "@/lib/auth";
import { DEFAULT_STAGES } from "@/lib/domain";
import { sendDigest, validateWebhook } from "@/lib/notifications";
import type { Stage } from "@/lib/types";

export const dynamic = "force-dynamic";
function text(value: unknown, label: string, required = false, max = 2000) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new AppError(`请填写${label}`);
  if (result.length > max) throw new AppError(`${label}不能超过 ${max} 个字符`);
  return result;
}
function date(value: unknown) {
  if (!value) return null;
  const result = text(value, "期望上线日期");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(new Date(result).getTime()) || new Date(result).toISOString().slice(0, 10) !== result) throw new AppError("期望上线日期无效");
  return result;
}
function priority(value: unknown): "high" | "medium" | "low" {
  if (value !== "high" && value !== "medium" && value !== "low") throw new AppError("请选择正确的优先级");
  return value;
}
function fail(error: unknown) {
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Horus request failed", error);
  return NextResponse.json({ error: "暂时无法完成操作，请稍后重试" }, { status: 500 });
}
export async function GET() {
  try { return NextResponse.json(await loadWorkspace(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host") && new URL(origin).host !== request.headers.get("x-forwarded-host")) throw new AppError("不允许跨站操作", 403);
    const { actor } = await getActor();
    const body: Record<string, unknown> = await request.json();
    const action = text(body.action, "操作类型", true);
    const now = new Date().toISOString();
    let result: Record<string, unknown> = {};

    if (action === "createRequirement") {
      const teamId = text(body.teamId, "所属团队", true);
      assertTeam(actor, teamId);
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team) throw new AppError("团队不存在", 404);
      const values = { teamId, title: text(body.title, "需求标题", true, 120), description: text(body.description, "需求描述"), priority: priority(body.priority || "medium"), owner: text(body.owner, "负责人", false, 40), expectedDate: date(body.expectedDate), stageId: team.stages[0].id, createdBy: actor.id, updatedBy: actor.id };
      result = await db.transaction(async tx => {
        const [created] = await tx.insert(requirements).values(values).$returningId();
        await tx.insert(auditLogs).values({ actorId: actor.id, requirementId: created.id, action, detail: values });
        return { id: created.id };
      });
    } else if (["updateRequirement", "advance", "block", "cancel"].includes(action)) {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) throw new AppError("需求编号无效");
      await db.transaction(async tx => {
        const [current] = await tx.select().from(requirements).where(eq(requirements.id, id)).for("update");
        if (!current) throw new AppError("需求不存在", 404);
        assertTeam(actor, current.teamId);
        if (current.status !== "active") throw new AppError("已归档需求为只读记录");
        let patch: Partial<typeof requirements.$inferInsert> = { updatedAt: now, updatedBy: actor.id };
        if (action === "updateRequirement") {
          patch = { ...patch, title: text(body.title, "需求标题", true, 120), description: text(body.description, "需求描述"), priority: priority(body.priority), owner: text(body.owner, "负责人", false, 40), expectedDate: date(body.expectedDate) };
        } else if (action === "advance") {
          const [team] = await tx.select().from(teams).where(eq(teams.id, current.teamId));
          const target = team.stages.findIndex(s => s.id === body.stageId);
          const previous = team.stages.findIndex(s => s.id === current.stageId);
          if (target < 0 || target <= previous) throw new AppError("阶段只能向前推进，不允许回退或重复推进");
          patch.stageId = team.stages[target].id;
          patch.enteredAt = now;
          if (target === team.stages.length - 1) Object.assign(patch, { status: "released", archivedAt: now, blocked: false, blockReason: "" });
        } else if (action === "block") {
          if (typeof body.blocked !== "boolean") throw new AppError("卡点状态无效");
          patch.blocked = body.blocked;
          patch.blockReason = body.blocked ? text(body.blockReason, "卡点原因", true, 500) : "";
        } else Object.assign(patch, { status: "cancelled", archivedAt: now, blocked: false, blockReason: "" });
        await tx.update(requirements).set(patch).where(eq(requirements.id, id));
        await tx.insert(auditLogs).values({ actorId: actor.id, requirementId: id, action, detail: patch });
      });
    } else if (action === "createTeam") {
      assertOwner(actor);
      const colors = ["purple", "blue", "teal", "orange"];
      const color = text(body.color, "团队颜色") || "purple";
      if (!colors.includes(color)) throw new AppError("团队颜色无效");
      const values = { id: randomUUID(), name: text(body.name, "团队名称", true, 30), description: text(body.description, "团队介绍", false, 200), color, icon: color === "blue" ? "layers" : color === "teal" ? "chart" : color === "orange" ? "server" : "code", stages: DEFAULT_STAGES };
      const duplicate = await db.select().from(teams).where(eq(teams.name, values.name));
      if (duplicate.length) throw new AppError("该团队名称已存在");
      await db.transaction(async tx => {
        await tx.insert(teams).values(values);
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { teamId: values.id, name: values.name } });
      });
      result.id = values.id;
    } else if (action === "updateTeam") {
      assertOwner(actor);
      const id = text(body.id, "团队", true, 64);
      const name = text(body.name, "团队名称", true, 30);
      const description = text(body.description, "团队介绍", false, 200);
      const colors = ["purple", "blue", "teal", "orange"];
      const color = text(body.color, "团队颜色") || "purple";
      if (!colors.includes(color)) throw new AppError("团队颜色无效");
      const icon = color === "blue" ? "layers" : color === "teal" ? "chart" : color === "orange" ? "server" : "code";
      await db.transaction(async tx => {
        const [team] = await tx.select().from(teams).where(eq(teams.id, id)).for("update");
        if (!team) throw new AppError("团队不存在", 404);
        const [duplicate] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.name, name), ne(teams.id, id)));
        if (duplicate) throw new AppError("该团队名称已存在");
        await tx.update(teams).set({ name, description, color, icon }).where(eq(teams.id, id));
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { teamId: id, before: { name: team.name, description: team.description, color: team.color }, after: { name, description, color } } });
      });
    } else if (action === "updateTemplate") {
      assertOwner(actor);
      const teamId = text(body.teamId, "团队", true);
      if (!Array.isArray(body.stages) || body.stages.length < 2 || body.stages.length > 15) throw new AppError("阶段模板需要包含 2–15 个阶段");
      const stages: Stage[] = body.stages.map((raw: unknown) => {
        if (!raw || typeof raw !== "object") throw new AppError("阶段数据无效");
        const item = raw as Record<string, unknown>;
        return { id: text(item.id, "阶段 ID", true, 60), name: text(item.name, "阶段名称", true, 20) };
      });
      if (new Set(stages.map(s => s.id)).size !== stages.length || new Set(stages.map(s => s.name)).size !== stages.length) throw new AppError("阶段名称或标识不能重复");
      const migrations = (body.migrations && typeof body.migrations === "object" ? body.migrations : {}) as Record<string, string>;
      await db.transaction(async tx => {
        const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
        if (!team) throw new AppError("团队不存在", 404);
        const existing = await tx.select().from(requirements).where(eq(requirements.teamId, teamId));
        for (const requirement of existing) {
          if (stages.some(s => s.id === requirement.stageId)) continue;
          const target = migrations[requirement.stageId];
          if (!target || !stages.some(s => s.id === target)) throw new AppError("被删除的阶段仍有关联需求，请为其选择迁移目标");
          const release = target === stages[stages.length - 1].id && requirement.status === "active";
          await tx.update(requirements).set({ stageId: target, enteredAt: now, updatedAt: now, updatedBy: actor.id, ...(release ? { status: "released" as const, archivedAt: now, blocked: false, blockReason: "" } : {}) }).where(eq(requirements.id, requirement.id));
          await tx.insert(auditLogs).values({ actorId: actor.id, requirementId: requirement.id, action: "migrateStage", detail: { from: requirement.stageId, to: target } });
        }
        await tx.update(teams).set({ stages }).where(eq(teams.id, teamId));
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { teamId, stages, migrations } });
      });
    } else if (action === "toggleMember") {
      assertOwner(actor);
      const id = text(body.id, "成员 ID", true, 64);
      if (id === actor.id || id === "owner") throw new AppError("不能停用当前负责人账号");
      await db.transaction(async tx => {
        const [member] = await tx.select().from(members).where(eq(members.id, id)).for("update");
        if (!member) throw new AppError("成员不存在", 404);
        const active = !member.active;
        await tx.update(members).set({ active }).where(eq(members.id, id));
        if (!active) await tx.delete(sessions).where(eq(sessions.memberId, id));
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { memberId: id, active } });
      });
    } else if (action === "resetMemberPassword") {
      assertOwner(actor);
      const id = text(body.id, "成员 ID", true, 64);
      if (id === actor.id || id === "owner") throw new AppError("不能重置当前负责人账号的密码");
      await db.transaction(async tx => {
        const [member] = await tx.select().from(members).where(eq(members.id, id)).for("update");
        if (!member) throw new AppError("成员不存在", 404);
        if (member.role !== "pm") throw new AppError("仅支持重置产品经理账号密码");
        await tx.update(members).set({ passwordHash: null }).where(eq(members.id, id));
        await tx.delete(sessions).where(eq(sessions.memberId, id));
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { memberId: id, username: member.username } });
      });
    } else if (action === "createMember" || action === "updateMember") {
      assertOwner(actor);
      const name = text(body.name, "成员姓名", true, 40);
      const role = body.role === "owner" ? "owner" as const : body.role === "pm" ? "pm" as const : null;
      if (!role) throw new AppError("角色无效");
      if (!Array.isArray(body.teamIds) || body.teamIds.some(id => typeof id !== "string")) throw new AppError("请选择绑定团队");
      const allTeams = await db.select({ id: teams.id }).from(teams);
      const teamIds = [...new Set(body.teamIds as string[])];
      if (teamIds.some(id => !allTeams.some(t => t.id === id))) throw new AppError("绑定团队不存在");
      const id = action === "createMember" ? randomUUID() : text(body.id, "成员 ID", true, 64);
      if ((id === actor.id || id === "owner") && role !== "owner") throw new AppError("不能修改当前负责人角色");
      await db.transaction(async tx => {
        if (action === "createMember") {
          const username = text(body.username, "登录账号", true, 32);
          if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new AppError("账号需为 3–32 位字母、数字、下划线或短横线");
          const [duplicate] = await tx.select().from(members).where(eq(members.username, username));
          if (duplicate) throw new AppError("此登录账号已存在");
          await tx.insert(members).values({ id, name, username, role, teamIds: role === "owner" ? [] : teamIds });
        } else {
          const [existing] = await tx.select({ id: members.id }).from(members).where(eq(members.id, id)).for("update");
          if (!existing) throw new AppError("成员不存在", 404);
          await tx.update(members).set({ name, role, teamIds: role === "owner" ? [] : teamIds }).where(eq(members.id, id));
        }
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { memberId: id, name, role, teamIds: role === "owner" ? [] : teamIds } });
      });
    } else if (action === "saveNotifications") {
      assertOwner(actor);
      const [current] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, "default"));
      const webhook = text(body.webhook, "Webhook", false, 2000) || current.webhook;
      if (webhook) validateWebhook(webhook);
      const time = text(body.time, "推送时间", true);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new AppError("推送时间无效");
      const enabled = body.enabled === true;
      if (enabled && !webhook) throw new AppError("开启自动推送前，请填写 Webhook");
      const appUrl = text(body.appUrl, "系统链接", false, 1000);
      if (webhook && !appUrl) throw new AppError("请填写摘要中的系统访问链接");
      if (appUrl) {
        try { if (!["http:", "https:"].includes(new URL(appUrl).protocol)) throw new Error(); }
        catch { throw new AppError("请填写有效的系统访问链接"); }
      }
      const signingSecret = body.clearSigningSecret === true ? "" : text(body.signingSecret, "签名密钥", false, 500) || current.signingSecret;
      await db.transaction(async tx => {
        await tx.update(notificationSettings).set({ enabled, time, webhook, signingSecret, appUrl }).where(eq(notificationSettings.id, "default"));
        await tx.insert(auditLogs).values({ actorId: actor.id, action, detail: { enabled, time } });
      });
    } else if (action === "sendNotification") {
      assertOwner(actor);
      result = await sendDigest();
    } else throw new AppError("不支持的操作类型");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return fail(error); }
}
