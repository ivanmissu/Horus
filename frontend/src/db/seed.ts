import { eq, sql } from "drizzle-orm";
import { databaseDialect, db, pool } from "@/db";
import { teams, members, requirements, notificationSettings } from "@/db/schema";
import { creationTimeForCycle, DEFAULT_STAGES, startOfShanghaiWeek, todayString } from "@/lib/domain";

let seeded: Promise<void> | undefined;
export function ensureSeed() {
  if (!seeded) seeded = seed().catch(error => { seeded = undefined; throw error; });
  return seeded;
}
async function seed() {
  const connection: any = databaseDialect === "mysql" ? await (pool as any).getConnection() : undefined;
  let lockAcquired = false;
  let connectionHealthy = true;
  try {
    if (databaseDialect === "mysql") {
      const [lockResult] = await connection.query("select get_lock(?, 10) as acquired", ["horus_seed"]);
      const lockRows = lockResult as unknown as { acquired: number | null }[];
      if (!Array.isArray(lockRows) || Number(lockRows[0]?.acquired) !== 1) throw new Error("Unable to acquire MySQL seed lock");
      lockAcquired = true;
    }
    await db.transaction(async tx => {
      if (databaseDialect === "postgres") await tx.execute(sql`SELECT pg_advisory_xact_lock(22061015)`);
      const existing = await tx.select({ id: teams.id }).from(teams).limit(1);
      if (existing.length) return;
      // Keep a pre-existing production owner (id="owner"); give the seeded demo owner a separate ID.
      const [existingOwner] = await tx.select({ id: members.id }).from(members).where(eq(members.id, "owner")).limit(1);
      const demoOwnerId = existingOwner ? "demo-owner" : "owner";
      await tx.insert(teams).values([
        { id: "platform", name: "基础平台组", description: "构建稳定、高效、可复用的技术底座", color: "purple", icon: "code", stages: DEFAULT_STAGES },
        { id: "product", name: "业务产品组", description: "以用户体验为中心，持续交付业务价值", color: "blue", icon: "layers", stages: DEFAULT_STAGES },
        { id: "data", name: "数据智能组", description: "让数据连接业务，让洞察驱动决策", color: "teal", icon: "chart", stages: DEFAULT_STAGES },
        { id: "infra", name: "基础设施组", description: "保障每一次交付的可靠与高效", color: "orange", icon: "server", stages: DEFAULT_STAGES },
      ]);
      await tx.insert(members).values([
        { id: demoOwnerId, name: "陈予安", username: "chen", role: "owner", teamIds: [] },
        { id: "pm-lin", name: "林小满", username: "lin", role: "pm", teamIds: ["platform", "infra"] },
        { id: "pm-su", name: "苏晓", username: "su", role: "pm", teamIds: ["product"] },
        { id: "pm-zhou", name: "周亦舟", username: "zhou", role: "pm", teamIds: ["data"] },
      ]);
      const now = new Date();
      const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
      const due = (days: number) => todayString(new Date(now.getTime() + days * 86400000));
      const weekStart = startOfShanghaiWeek(now);
      const thisWeekCreated = new Date(Math.min(weekStart.getTime() + 2 * 3600000, now.getTime())).toISOString();
      const thisWeekDone = new Date(Math.min(weekStart.getTime() + 6 * 3600000, now.getTime())).toISOString();
      // 上周五上线、一直没归档的示例：演示「历史未归档」页签。
      const lastWeekDone = new Date(weekStart.getTime() - 3 * 86400000 + 6 * 3600000).toISOString();
      const lastWeekExpected = todayString(new Date(weekStart.getTime() - 5 * 86400000));
      type Item = [string, number, number, number, "high" | "medium" | "low", number | null, string, string?];
      const groups: Record<string, Item[]> = {
        platform: [
          ["统一身份认证 SSO 接入", 2, 2, 1, "high", 5, "林小满"],
          ["多租户权限模型升级", 12, 3, 5, "high", -2, "张铭", "等待安全团队确认权限边界，预计明日完成对齐"],
          ["开放平台 API 限流优化", 4, 1, 2, "medium", 7, "李思远"],
          ["消息中心推送链路改造", 5, 4, 2, "high", 2, "王一帆"],
          ["应用配置中心灰度发布", 1, 0, 1, "medium", 9, "林小满"],
          ["统一网关访问日志增强", 16, 5, 2, "medium", 4, "张铭"],
          ["文件服务断点续传", 14, 2, 3, "low", 12, "李思远"],
          ["开放接口文档自动生成", 9, 1, 2, "low", 11, "王一帆"],
          ["平台服务健康检查升级", 18, 6, 1, "medium", 1, "林小满"],
          ["应用密钥轮转机制", 10, 2, 3, "medium", 8, "张铭"],
          ["国际化资源包管理", 13, 0, 3, "low", null, "李思远"],
          ["服务间调用链路追踪", 15, 3, 2, "medium", 6, "王一帆"],
        ],
        product: [
          ["企业工作台全新改版", 3, 2, 2, "high", 6, "苏晓"],
          ["订单结算流程优化", 10, 4, 4, "high", -1, "赵可", "支付渠道回调协议尚未确认，等待渠道方回复"],
          ["客户标签批量管理", 6, 1, 3, "medium", 8, "苏晓"],
          ["移动端消息聚合", 1, 0, 1, "low", 10, "许诺"],
          ["企业客户导入体验优化", 12, 5, 2, "medium", 3, "赵可"],
          ["订单列表高级搜索", 15, 3, 2, "medium", 4, "许诺"],
          ["客户分层运营规则", 9, 1, 3, "low", 12, "苏晓"],
          ["电子合同签署接入", 16, 2, 4, "medium", 7, "赵可"],
          ["工作台快捷入口配置", 11, 6, 1, "low", 2, "许诺"],
        ],
        data: [
          ["经营数据看板 2.0", 4, 2, 3, "high", 5, "周亦舟"],
          ["用户行为埋点规范升级", 6, 3, 2, "medium", 3, "沈言", "依赖业务端补齐埋点字段，已同步相关负责人"],
          ["数据导出任务异步化", 2, 1, 1, "medium", 7, "周亦舟"],
          ["实时指标口径统一", 11, 5, 4, "high", -3, "沈言"],
          ["离线任务调度告警", 13, 2, 2, "medium", 6, "顾辰"],
          ["用户画像标签计算", 18, 4, 3, "medium", 5, "周亦舟"],
          ["数据质量自动巡检", 9, 0, 2, "low", null, "顾辰"],
          ["数据源连接管理", 15, 6, 1, "medium", 1, "沈言"],
        ],
        infra: [
          ["容器资源弹性伸缩", 2, 1, 1, "high", 10, "林小满"],
          ["CI/CD 构建缓存优化", 5, 2, 3, "medium", 4, "陆川"],
          ["生产环境日志链路升级", 13, 3, 5, "medium", 4, "陆川", "等待基础资源扩容审批，需协调运维资源"],
          ["镜像仓库清理策略", 10, 4, 2, "low", 6, "林小满"],
          ["预发布环境配置隔离", 14, 5, 2, "medium", 3, "陆川"],
        ],
      };
      for (const [teamId, items] of Object.entries(groups)) {
        const createdBy = teamId === "product" ? "pm-su" : teamId === "data" ? "pm-zhou" : "pm-lin";
        await tx.insert(requirements).values(items.map(([title, age, stage, dwell, priority, expected, owner, block]) => ({
          teamId, title, description: `推进${title}，完善现有能力与使用体验，提升团队交付质量。`, priority, owner,
          expectedDate: expected === null ? null : due(expected), stageId: DEFAULT_STAGES[stage].id,
          enteredAt: ago(dwell), createdAt: ago(age), updatedAt: ago(dwell), blocked: !!block, blockReason: block || "", createdBy, updatedBy: createdBy,
        })));
        const releasedThisWeek = teamId === "platform" || teamId === "product";
        const releaseTime = releasedThisWeek ? thisWeekDone : ago(4);
        const cancelThisWeek = teamId === "platform" || teamId === "product";
        const cancelTime = cancelThisWeek ? thisWeekDone : ago(5);
        await tx.insert(requirements).values([
          { teamId, title: `${teamId === "platform" ? "统一认证登录页优化" : teamId === "product" ? "客户详情页体验升级" : teamId === "data" ? "周报数据自动汇总" : "自动化部署流程升级"}`, description: "已通过上线验收，正式交付使用。", priority: "medium", owner: teamId === "product" ? "苏晓" : teamId === "data" ? "周亦舟" : "林小满", stageId: "released", status: "released", expectedDate: due(teamId === "platform" ? -6 : releasedThisWeek ? 2 : -4), enteredAt: releaseTime, releasedAt: releaseTime, createdAt: releasedThisWeek ? thisWeekCreated : ago(21), updatedAt: releaseTime, archivedAt: teamId === "platform" ? null : releaseTime, createdBy, updatedBy: createdBy },
          { teamId, title: `${teamId === "platform" ? "旧版网关兼容适配" : teamId === "product" ? "活动页面模板扩展" : teamId === "data" ? "旧版报表迁移" : "备用集群扩容"}`, description: "经团队评估，当前阶段暂不投入，保留记录以供后续参考。", priority: "low", owner: teamId === "product" ? "苏晓" : teamId === "data" ? "周亦舟" : "林小满", stageId: "design", status: "cancelled", enteredAt: teamId === "platform" ? thisWeekCreated : ago(8), cancelledAt: cancelTime, createdAt: teamId === "platform" ? thisWeekCreated : ago(24), updatedAt: cancelTime, archivedAt: cancelTime, createdBy, updatedBy: createdBy },
        ]);
      }
      // 下周待启动的示例：创建时间落在下周一 09:00，届时自动进入在途列表。
      const nextWeekStart = creationTimeForCycle("next", now);
      await tx.insert(requirements).values([
        { teamId: "platform", title: "服务网格接入预研", description: "下周启动服务网格接入的预研与方案评审。", priority: "medium", owner: "林小满", expectedDate: due(14), stageId: DEFAULT_STAGES[0].id, enteredAt: nextWeekStart, createdAt: nextWeekStart, updatedAt: nextWeekStart, createdBy: "pm-lin", updatedBy: "pm-lin" },
        { teamId: "product", title: "会员权益体系改版", description: "下周启动会员权益体系改版的方案设计。", priority: "high", owner: "苏晓", expectedDate: due(18), stageId: DEFAULT_STAGES[0].id, enteredAt: nextWeekStart, createdAt: nextWeekStart, updatedAt: nextWeekStart, createdBy: "pm-su", updatedBy: "pm-su" },
      ]);
      await tx.insert(requirements).values([
        { teamId: "product", title: "历史版本数据迁移", description: "上周已上线，等待确认后归档。", priority: "high", owner: "苏晓", expectedDate: lastWeekExpected, stageId: "released", status: "released", enteredAt: lastWeekDone, releasedAt: lastWeekDone, createdAt: ago(28), updatedAt: lastWeekDone, archivedAt: null, createdBy: "pm-su", updatedBy: "pm-su" },
      ]);
      // Production may already have settings; demo seeding must not reset user-configured notifications.
      const [existingSettings] = await tx.select({ id: notificationSettings.id }).from(notificationSettings).where(eq(notificationSettings.id, "default")).limit(1);
      if (!existingSettings) await tx.insert(notificationSettings).values({ id: "default" });
    });
  } catch (error) {
    connectionHealthy = false;
    throw error;
  } finally {
    if (connection && connectionHealthy && lockAcquired) {
      try {
        await connection.query("select release_lock(?)", ["horus_seed"]);
      } catch {
        connectionHealthy = false;
      }
    }
    if (connection) {
      if (connectionHealthy) connection.release();
      else connection.destroy();
    }
  }
}
