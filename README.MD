# Horus · 研发进程，尽在掌握

Horus 是面向**小型研发团队**的轻量化需求看盘与里程碑跟踪工具，把注意力集中在三件事上：

- **本周新建**：本周一 00:00（北京时间）起新建且未取消的需求（含已上线与已归档；处于「需求评审」阶段时显示「新建」标记）
- **卡点**：被阻塞、等待外部响应的需求
- **逾期**：已过期望上线/完成日期仍未收尾的需求，其中高优先级单列为「高优逾期」

工作台按团队分组展示在途需求（含本周已上线待归档）；本周一前上线但未归档的需求单列在「历史未归档」，并在 Horus 各页面醒目提醒，直到归档。提醒按当前账号可见团队统计，只读用户可联系产品经理或管理员归档，不发送钉钉。逾期上线会保留「已上线」状态并额外标记；未归档的逾期上线计入「全部逾期」及其中的「高优逾期」。

> 技术栈：Next.js App Router · React 19 · Drizzle ORM · MySQL 8.0 / PostgreSQL（含 Supabase）双数据库，`DATABASE_URL` 自动选择驱动。

## 功能概览

- **工作台**：统计卡片 + 多维筛选 + 按团队分组的全部在途需求列表（三类风险高亮）
- **需求统计**：按自然周/自然月统计新建、上线、逾期上线（全优及高优子集）、取消、卡点、归档、存量与期末高优逾期，支持团队对比和历史趋势
- **需求池**：进入研发流程之前的漏斗，记录业务期望与待评估需求（优先级仍为高/中/低）。业务负责人可录入与修改绑定团队的条目，产品经理与空间管理员给出「不采纳 / 重新评估 / 一键转为正式需求」的筛选结论；转入后来源记为「需求池转入」并保留双向关联。需求池**不参与**工作台统计、需求统计与钉钉摘要
- **团队详情**：阶段分布图（点击可筛选）、在途列表排序、历史未归档与归档历史查询
- **需求生命周期**：新建（负责人默认当前录入人、优先级默认高，均可修改；期望上线/完成日期必填且不早于当天）/ 编辑 / 向前跳阶段（禁止回退）/ 卡点标记与解除 / 标记上线 / 归档与取消归档，全程操作留痕
- **阶段模板**：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标
- **成员与团队**：空间管理员预建账号、角色分配（空间管理员 / 产品经理 / 业务负责人）、PM 与业务负责人多团队绑定、停用成员、重置成员密码；业务负责人仅可查看绑定团队，不能修改数据，也看不到空间管理菜单
- **通知**：钉钉 Webhook + 可选加签，北京时间每日定时推送卡点与**全部逾期**（不限优先级）摘要，实时预览与发送日志；已保存的机器人地址和加签密钥仅向空间管理员回显，默认隐藏
- **移动端**：首页与团队详情只读，390px 视口无横向滚动

## 界面截图

![Horus 工作台](docs/screenshots/workbench.png)

![Horus 需求统计](docs/screenshots/stats.png)

## Quick Start（本地开发）

要求：Node.js 22+，以及 MySQL 8.0+ 或 PostgreSQL 15+。

```bash
cd frontend
npm install

# 任选一个数据库（下面演示 MySQL；PostgreSQL/Supabase 用 postgresql://）
export DATABASE_URL='mysql://horus:change-me@127.0.0.1:3306/horus'

# 同步表结构 + 初始化空间管理员（默认账号 admin，首次登录设密）
npm run db:push && npm run db:init
#    不想用 Drizzle 建表时，改为在空库上跑仓库自带的 ./scripts/init-sql.sh

npm run dev        # 访问 http://localhost:3000
```

- 其余可选环境变量（初始空间管理员账号、「本周新建」窗口天数、连接池大小、钉钉 `APP_URL` 等）及无数据库的界面预览模式（`HORUS_PREVIEW_MODE=true`）：见 [`frontend/README.md`](frontend/README.md)
- `HORUS_DEMO_MODE=true` 仅用于本地/受控演示（自动灌演示数据、免登录），**生产禁止开启**
- 验证命令：`npm run test:domain` / `npm run typecheck` / `npm run lint` / `npm run build`

## 生产部署

生产默认强制登录、不灌演示数据。三条路线任选其一，完整步骤、配置清单与故障排查见对应文档：

| 部署路线 | 文档 |
| --- | --- |
| Vercel + Supabase PostgreSQL | [`docs/vercel-supabase-deployment.md`](docs/vercel-supabase-deployment.md) |
| Kubernetes · 外部 MySQL（主推，挂 .env / 纯 env 两条配置路线） | [`docs/kubernetes-deployment.md`](docs/kubernetes-deployment.md) |
| Docker Compose · 内网单机 | [`docs/deployment-guide.md`](docs/deployment-guide.md) |

关键约束：

- K8s 部署**只跑 1 个副本，不要扩容、不要 HPA**（定时摘要调度假设单实例）。
- Compose 部署的数据在 `horus-mysql` 卷里，**日常停服不要 `docker compose down -v`**（会删卷）。
- 其他变体：纯 Docker 命令部署见 [`docs/docker-standalone-deployment.md`](docs/docker-standalone-deployment.md)，K8s 纯环境变量（Secret + ConfigMap）写法见 [`docs/kubernetes-env-deployment.md`](docs/kubernetes-env-deployment.md)。

## 相关文档

- 全部文档索引：[`docs/README.md`](docs/README.md)
- 环境变量参考（全路线统一）：[`docs/environment-variables.md`](docs/environment-variables.md)
- 需求文档：[`docs/specs/horus-design.md`](docs/specs/horus-design.md)
- 项目计划：[`docs/specs/horus-project-plan.md`](docs/specs/horus-project-plan.md)
- M5 上线签收清单：[`docs/m5-uat-checklist.md`](docs/m5-uat-checklist.md)
- 前端说明：[`frontend/README.md`](frontend/README.md)

## License

本项目基于仓库根目录 [`LICENSE`](LICENSE) 发布。
