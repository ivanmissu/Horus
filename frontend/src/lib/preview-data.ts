import { creationTimeForCycle, DEFAULT_STAGES, startOfShanghaiWeek, todayString } from "./domain";
import type { Member, Requirement, RequirementDateChange, Team, WorkspaceData } from "./types";

// No database or DingTalk traffic. Data is generated for a disposable read-only UI preview.
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
const due = (days: number) => todayString(new Date(now.getTime() + days * 86400000));
const weekStart = startOfShanghaiWeek(now);
const thisWeekCreated = new Date(Math.min(weekStart.getTime() + 2 * 3600000, now.getTime())).toISOString();
const thisWeekDone = new Date(Math.min(weekStart.getTime() + 6 * 3600000, now.getTime())).toISOString();

export const previewActor: Member = {
  id: "preview-owner", username: "preview", name: "预览负责人", role: "owner", teamIds: [],
  active: true, firstLogin: false, createdAt: ago(30),
};

const teamDetails = [
  ["platform", "基础平台组", "构建稳定、高效、可复用的技术底座", "purple", "code"],
  ["product", "业务产品组", "以用户体验为中心，持续交付业务价值", "blue", "layers"],
  ["data", "数据智能组", "让数据连接业务，让洞察驱动决策", "teal", "chart"],
  ["infra", "基础设施组", "保障每一次交付的可靠与高效", "orange", "server"],
] as const;

const teams: Team[] = teamDetails.map(([id, name, description, color, icon]) => ({
  id, name, description, color, icon, stages: DEFAULT_STAGES, createdAt: ago(30),
}));
const members: Member[] = [previewActor,
  { id: "pm-lin", username: "lin", name: "林小满", role: "pm", teamIds: ["platform", "infra"], active: true, firstLogin: false, createdAt: ago(25) },
  { id: "pm-su", username: "su", name: "苏晓", role: "pm", teamIds: ["product"], active: true, firstLogin: false, createdAt: ago(25) },
  { id: "pm-zhou", username: "zhou", name: "周亦舟", role: "pm", teamIds: ["data"], active: true, firstLogin: false, createdAt: ago(25) },
];

type Sample = [string, string, number, number, Requirement["priority"], number | null, string, string?];
const samples: Sample[] = [
  ["platform", "统一身份认证 SSO 接入", 2, 2, "high", 5, "林小满"],
  ["platform", "多租户权限模型升级", 12, 3, "high", -2, "张铭", "等待安全团队确认权限边界"],
  ["platform", "开放平台 API 限流优化", 4, 1, "medium", 7, "李思远"],
  ["platform", "消息中心推送链路改造", 5, 4, "high", 2, "王一帆"],
  ["platform", "应用配置中心灰度发布", 1, 0, "medium", 9, "林小满"],
  ["platform", "统一网关访问日志增强", 16, 5, "medium", 4, "张铭"],
  ["product", "企业工作台全新改版", 3, 2, "high", 6, "苏晓"],
  ["product", "订单结算流程优化", 10, 4, "high", -1, "赵可", "等待支付渠道回复"],
  ["product", "客户标签批量管理", 6, 1, "medium", 8, "苏晓"],
  ["product", "移动端消息聚合", 1, 0, "low", 10, "许诺"],
  ["product", "品牌官网视觉走查与设计交付", 7, 1, "low", -4, "许诺"],
  ["data", "经营数据看板 2.0", 4, 2, "high", 5, "周亦舟"],
  ["data", "用户行为埋点规范升级", 6, 3, "medium", 3, "沈言", "依赖业务端补齐埋点字段"],
  ["data", "实时指标口径统一", 11, 5, "high", -3, "沈言"],
  ["data", "数据质量自动巡检", 9, 0, "low", null, "顾辰"],
  ["infra", "容器资源弹性伸缩", 2, 1, "high", 10, "林小满"],
  ["infra", "CI/CD 构建缓存优化", 5, 2, "medium", 4, "陆川"],
  ["infra", "生产环境日志链路升级", 13, 3, "medium", 4, "陆川", "等待基础资源扩容审批"],
];
const requirements: Requirement[] = samples.map(([teamId, title, age, stage, priority, expected, owner, block], index) => ({
  id: index + 1, teamId, title, description: `推进${title}，提升团队交付质量。`, priority, owner,
  expectedDate: expected === null ? null : due(expected), stageId: DEFAULT_STAGES[stage].id,
  enteredAt: ago(Math.min(age, 2)), blocked: !!block, blockReason: block || "", status: "active",
  source: "手工录入", externalId: null, createdBy: "preview-owner", updatedBy: "preview-owner",
  createdAt: ago(age), updatedAt: ago(Math.min(age, 2)), releasedAt: null, cancelledAt: null, archivedAt: null,
}));
for (const [index, team] of teams.entries()) {
  const createdThisWeek = index <= 1;
  const finishTime = createdThisWeek ? thisWeekDone : ago(4);
  requirements.push({
    id: samples.length + index + 1, teamId: team.id, title: `${team.name}上线交付回顾`,
    description: "已通过上线验收，正式交付使用。", priority: "medium", owner: "林小满",
    expectedDate: due(index === 0 ? -6 : createdThisWeek ? 2 : -4), stageId: "released", enteredAt: finishTime, blocked: false, blockReason: "",
    status: "released", source: "手工录入", externalId: null, createdBy: "preview-owner",
    updatedBy: "preview-owner", createdAt: createdThisWeek ? thisWeekCreated : ago(21), updatedAt: finishTime, releasedAt: finishTime, cancelledAt: null,
    archivedAt: index === 0 ? null : finishTime,
  });
}
// Two cancelled requirements make the statistics page meaningful in preview mode.
[["platform", "旧版开放平台文档站下线", "medium"], ["product", "活动页旧模板清理", "low"]].forEach(([teamId, title, priority], index) => {
  const cancelledThisWeek = index === 0;
  const cancelTime = cancelledThisWeek ? thisWeekDone : ago(5 + index * 3);
  requirements.push({
    id: samples.length + teams.length + index + 1, teamId, title, description: "经团队评估不再投入，取消并归档保留记录。",
    priority: priority as Requirement["priority"], owner: index ? "苏晓" : "林小满", expectedDate: due(cancelledThisWeek ? 5 : -6),
    stageId: "design", enteredAt: cancelledThisWeek ? thisWeekCreated : ago(8), blocked: false, blockReason: "", status: "cancelled",
    source: "手工录入", externalId: null, createdBy: "preview-owner", updatedBy: "preview-owner",
    createdAt: cancelledThisWeek ? thisWeekCreated : ago(16 + index * 9), updatedAt: cancelTime, releasedAt: null,
    cancelledAt: cancelTime, archivedAt: cancelTime,
  });
});

// Two requirements scheduled for next Monday 09:00 (Asia/Shanghai) so the
// read-only preview shows the 「下周待启动」 section.
const nextWeekStart = creationTimeForCycle("next", now);
[["platform", "服务网格接入预研", "林小满", "medium"], ["product", "会员权益体系改版", "苏晓", "high"]].forEach(([teamId, title, owner, priority], index) => {
  requirements.push({
    id: samples.length + teams.length + 2 + index + 1, teamId, title, description: "下周启动，先完成方案评审。",
    priority: priority as Requirement["priority"], owner, expectedDate: due(14),
    stageId: DEFAULT_STAGES[0].id, enteredAt: nextWeekStart, blocked: false, blockReason: "", status: "active",
    source: "手工录入", externalId: null, createdBy: "preview-owner", updatedBy: "preview-owner",
    createdAt: nextWeekStart, updatedAt: nextWeekStart, releasedAt: null, cancelledAt: null, archivedAt: null,
  });
});

// A requirement released last Friday and never archived, so the preview
// shows the 「历史未归档」 tab (released before this Monday 00:00).
const lastWeekDone = new Date(weekStart.getTime() - 3 * 86400000 + 6 * 3600000).toISOString();
requirements.push({
  id: requirements.length + 1, teamId: "product", title: "历史版本数据迁移",
  description: "上周已上线，等待确认后归档。", priority: "high", owner: "苏晓",
  expectedDate: todayString(new Date(weekStart.getTime() - 5 * 86400000)), stageId: "released", enteredAt: lastWeekDone, blocked: false, blockReason: "",
  status: "released", source: "手工录入", externalId: null, createdBy: "preview-owner",
  updatedBy: "preview-owner", createdAt: ago(28), updatedAt: lastWeekDone, releasedAt: lastWeekDone, cancelledAt: null,
  archivedAt: null,
});

// 三条只读预览用的期望日期调整（含一条已归档需求），让详情历史与各列表的「日期调整」标记可见。
const dateChanges: RequirementDateChange[] = [
  { id: 1, requirementId: 2, fromDate: due(-5), toDate: due(-2), reason: "等待安全团队确认权限边界，与安全评审对齐后顺延 3 天", actorId: "pm-lin", actorName: "林小满", createdAt: ago(3) },
  { id: 2, requirementId: 8, fromDate: due(-6), toDate: due(-1), reason: "支付渠道回调协议尚未确认，等渠道方回复后调整上线时间", actorId: "pm-su", actorName: "苏晓", createdAt: ago(4) },
  { id: 3, requirementId: 20, fromDate: due(-1), toDate: due(2), reason: "按验收反馈补齐回归范围，与业务确认后延后 3 天上线", actorId: "pm-su", actorName: "苏晓", createdAt: ago(4) },
];

export function previewWorkspace(): WorkspaceData {
  return {
    teams, members, requirements, dateChanges, actor: previewActor, demo: true, preview: true,
    settings: { id: "default", enabled: false, time: "09:30", appUrl: "", lastRunDate: null,
      hasWebhook: false, hasSigningSecret: false, pendingCount: 0 },
    logs: [], now: new Date().toISOString(),
  };
}
