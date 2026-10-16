# Horus · 研发进程，尽在掌握

Horus 是面向**小型研发团队**的轻量化需求看盘与里程碑跟踪工具。它不追求大而全的项目管理，而是把注意力集中在三件事上：

- **本周新建**：近 7 天（可配置 1–90 天）内新建的需求
- **卡点**：被阻塞、等待外部响应的需求
- **高优逾期**：高优先级且已过期未完成的需求

三者取并集后按团队分组折叠展示，让负责人和 PM 一眼看清「现在最该盯什么」。支持需求全生命周期推进、阶段模板自定义、成员与团队管理、钉钉每日异常摘要推送，以及移动端只读查看。

> 技术栈：Next.js App Router · React 19 · Drizzle ORM · MySQL 8.0 · Docker 单实例。生产默认强制登录，不灌演示数据。

## 功能概览

- **聚焦工作台**：统计卡片 + 多维筛选 + 按团队分组的焦点需求列表
- **团队详情**：阶段分布图（点击可筛选）、在途列表排序、归档历史查询
- **需求生命周期**：新建 / 编辑 / 向前跳阶段（禁止回退）/ 卡点标记与解除 / 末阶段自动归档 / 取消归档 / 操作留痕
- **阶段模板**：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标
- **成员与团队**：负责人预建账号、角色分配、PM 多团队绑定、停用成员、重置 PM 密码、编辑团队信息
- **通知设置**：钉钉 Webhook + 可选加签、北京时间每日定时发送、实时预览与发送日志
- **移动端**：首页与团队详情只读，390px 视口无横向滚动

## 界面截图

### 工作台（聚焦视图）

![Horus 工作台](docs/screenshots/dashboard.png)

### 团队详情（阶段分布 + 在途需求）

![Horus 团队详情](docs/screenshots/team-detail.png)

## Quick Start（本地开发）

要求：Node.js 22+、MySQL 8.0+。

```bash
# 1. 安装依赖
cd frontend
npm install

# 2. 准备数据库（MySQL 8.0）
#    创建数据库 horus 与用户 horus，然后设置连接地址
export DATABASE_URL='mysql://horus:change-me@127.0.0.1:3306/horus'

# 3. 同步表结构 + 初始化负责人（默认账号 admin，首次登录设密）
npm run db:push
npm run db:init

# 4. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

可选环境变量（详见 `frontend/README.md`）：

- `HORUS_DEMO_MODE=true`：仅用于本地/受控演示，自动灌入演示团队与需求并允许免登录；**生产禁止开启**
- `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME`：初始负责人账号 / 姓名（默认 `admin` / `团队负责人`）
- `HORUS_NEW_WINDOW_DAYS` 与 `NEXT_PUBLIC_NEW_WINDOW_DAYS`：「本周新建」窗口天数（默认 7，范围 1–90，两者保持一致）
- `HORUS_DB_CONNECTION_LIMIT`：MySQL 连接池大小（默认 10）
- `APP_URL`：钉钉摘要链接兜底地址

无数据库时仅预览界面布局：

```bash
HORUS_PREVIEW_MODE=true npm run dev -- --hostname 0.0.0.0 --port 3000
```

> 这是只读预览，使用内存示例数据，不连接 MySQL，写接口返回 503，不代表生产数据库健康。

验证命令：

```bash
npm run test:domain   # 领域纯函数
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run build         # 生产构建
```

## 生产环境部署（Docker Compose · 内网单机）

完整步骤见 [`docs/deployment-guide.md`](docs/deployment-guide.md)。下面是速览。

### 1. 服务器准备

- Linux x86_64，Docker Engine 24+ 与 Compose v2
- 2 vCPU / 2 GB 内存 / 5 GB 磁盘，宿主机端口 `3000` 空闲且内网可达
- 出站能访问 `https://oapi.dingtalk.com`（钉钉摘要推送）
- **不要**对外暴露 3306

### 2. 获取代码并配置

```bash
git clone <仓库地址> horus && cd horus
cp .env.example .env
# 编辑 .env：改掉 MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD（仅字母数字下划线）、
# APP_URL（同事实际打开的地址）、HORUS_PORT、HORUS_INIT_OWNER_USERNAME / NAME
# 保持 HORUS_DEMO_MODE=false
chmod 600 .env
```

### 3. 一键部署

```bash
chmod +x scripts/*.sh
./scripts/deploy.sh
```

脚本会依次：检查 Docker/Compose → 校验密码与演示模式 → 构建启动 → 轮询健康检查（最长 180 秒）。等价手工命令：

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true}
```

容器启动时自动完成：等待 MySQL → `drizzle-kit push` 同步 7 张表并校验齐全 → `db:init` 幂等创建初始负责人与通知设置默认行 → standalone 监听 `0.0.0.0:3000`。

### 4. 负责人首次登录

浏览器打开 `APP_URL`，输入负责人账号（默认 `admin`），系统识别为首次登录，设置 8–72 位密码。密码以 bcrypt 存库，会话仅存 SHA-256 摘要。忘密由负责人在页面「重置密码」，无自助找回。

### 5. 日常运维

```bash
docker compose ps / logs -f horus / restart horus
./scripts/backup.sh                 # 备份到 backups/*.sql.gz
./scripts/restore.sh <file> --yes   # 恢复（危险，先自动留底）
```

正式投产建议在现有网关 / Nginx 上挂 HTTPS 反向代理，并补齐 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 转发头（详见部署手册 9.3）。

### 数据与安全边界

- 单实例部署，**不要扩容** app 副本（调度器假设单进程 + 数据库抢占）
- `HORUS_DEMO_MODE=true` 仅用于演示，生产必须 `false`
- 不要使用 `docker compose down -v` 做日常停服（会删数据卷）
- 备份文件必须再拷贝到公司规定的备份位置，只留在应用宿主机不算完成备份

## 相关文档

- 需求文档：[`docs/specs/horus-design.md`](docs/specs/horus-design.md)
- 项目计划：[`docs/specs/horus-project-plan.md`](docs/specs/horus-project-plan.md)
- 生产部署手册：[`docs/deployment-guide.md`](docs/deployment-guide.md)
- M5 上线签收清单：[`docs/m5-uat-checklist.md`](docs/m5-uat-checklist.md)
- 前端说明：[`frontend/README.md`](frontend/README.md)

## License

本项目基于仓库根目录 [`LICENSE`](LICENSE) 发布。
PYEOF
echo written