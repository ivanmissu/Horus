# Horus 生产部署与运维手册

- 适用版本：V1（Next.js 全栈单体 + MySQL 8.0，单实例容器）
- 关联文档：[需求文档](./specs/horus-design.md)、[项目计划](./specs/horus-project-plan.md)
- 时区：应用与数据库均按 `Asia/Shanghai`（UTC+8）运行。逾期判断和钉钉 09:30 调度不依赖数据库时区转换，时间以 ISO-8601 UTC 字符串保存。

本手册覆盖首次部署、负责人账号初始化、钉钉机器人、备份恢复和版本升级。不要在生产环境开启 `HORUS_DEMO_MODE`。

---

## 1. 部署前检查

| 项 | 要求 |
| --- | --- |
| 运行时 | Docker Engine 24+ 与 Docker Compose v2 |
| 资源 | 2 vCPU / 2 GB 内存足够（数据量为百级需求） |
| 出网 | 构建机可访问 npm registry；运行中的应用容器可访问 `https://oapi.dingtalk.com` |
| 端口 | 默认宿主机 `3000`。MySQL 不映射到宿主机，只在 compose 网络内可达 |
| 密码 | `MYSQL_PASSWORD` 使用字母、数字、下划线，避免 `@ : / # ? $` 空格，以免写进 `DATABASE_URL` 或健康检查时被截断 |

内网机器若不能在构建时访问公网，在有网环境执行 `docker compose build` 后 `docker save horus:local mysql:8.0`，再把 tar 包拷到内网 `docker load`。字体已打进 npm 包，运行时不请求 Google Fonts。

上线前在生产宿主机确认钉钉可达：

```bash
curl -I https://oapi.dingtalk.com
```

---

## 2. 首次部署

在仓库根目录：

```bash
cp .env.example .env
# 编辑 .env：修改两个数据库密码、APP_URL、负责人账号名
docker compose up -d --build
docker compose ps
```

`horus-app` 启动时会：

1. 等待 MySQL 接受查询（最多 90 秒）；
2. 执行 `drizzle-kit push --force` 同步 7 张表；
3. 执行 `db:init`，幂等创建初始负责人和通知设置行；
4. 监听 `0.0.0.0:3000`。

健康检查通过后：

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true}
```

浏览器打开 `APP_URL`。未登录会跳到 `/login`，登录页不出现演示账号。

### 2.1 负责人首次设密

`db:init` 默认创建账号 `admin`（可用 `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME` 覆盖），密码留空。

1. 打开 `/login`，输入负责人账号。
2. 系统识别为首次登录，设置 8–72 位密码。
3. 密码以 bcrypt（成本因子 12）保存。服务端会话只存 SHA-256 摘要。

再次执行 `db:init` 不会重置已有负责人密码。若账号建错且尚未投产，可在备份后清空库卷重来（见第 6 节）。

### 2.2 初始化团队与 PM

用负责人账号：

1. 「成员与团队」创建 3–5 个团队，按需改名称、简介、颜色。
2. 在「阶段模板」按团队增删、改名、调序。删除仍有需求的阶段时必须指定迁移目标。
3. 预建不超过 3 个 PM 账号并绑定团队。把账号告诉对应 PM，让他们首次登录自行设密。
4. PM 遗忘密码时，负责人点「重置密码」。该操作清空密码哈希并注销其全部会话，下次登录重新设密。停用成员同样立即下线。

没有自助注册，也没有找回密码。

---

## 3. 钉钉每日异常摘要

1. 在内部群添加自定义机器人。安全设置二选一：
   - 加签：把 `SEC` 密钥填到 Horus「加签密钥」；
   - 自定义关键词：关键词设为 `Horus`。
2. Webhook 必须是 `https://oapi.dingtalk.com/robot/send?access_token=…`。接口不会把已保存的 Webhook 或密钥返回给浏览器。
3. 「系统访问链接」填内网同事打得开的地址（与 `APP_URL` 一致），摘要底部用它跳回工作台。
4. 推送时间默认 `09:30`，时区固定为北京时间。保存后点「立即发送测试」，到群里核对排版和链接。测试发送不占用当日定时名额。
5. 打开「每日异常摘要」。应用进程需保持在线；调度每分钟检查一次。

发送规则：

- 内容只含卡点与高优逾期，不是全量需求。
- 到达设定时间后，用数据库条件更新抢占当天执行权。多进程或重启重叠时，同一天只会有一个实例发出定时摘要。
- 推送失败会写失败日志，并把摘要放进待重试列表。次日定时发送时去重合并，不在页面弹错误。
- 失败详情只记录「机器人返回错误代码」或「网络连接失败」，不写 Webhook。

---

## 4. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | 无，必填 | 仅 MySQL 容器使用 |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | `horus` / `horus` / 必填 | 应用账号，权限限于业务库 |
| `DATABASE_URL` | compose 内自动拼装 | 本地 `npm run dev` 时指向 `127.0.0.1` |
| `HORUS_DEMO_MODE` | `false` | 只有显式 `true` 才灌演示数据并允许免登录。生产禁止 |
| `HORUS_INIT_OWNER_USERNAME` | `admin` | 仅在还没有 `owner` 行时使用 |
| `HORUS_INIT_OWNER_NAME` | `团队负责人` | 同上 |
| `APP_URL` | `http://localhost:3000` | 钉钉链接兜底 |
| `HORUS_NEW_WINDOW_DAYS` | `7` | 「本周新建」滚动窗口，1–90。运行时生效，并下发给页面 |
| `NEXT_PUBLIC_NEW_WINDOW_DAYS` | `7` | 镜像构建参数，作为客户端兜底。改窗口后请与上一行保持一致并重新构建 |
| `HORUS_PORT` | `3000` | 宿主机映射端口 |
| `HORUS_DB_CONNECTION_LIMIT` | `10` | MySQL 连接池 |
| `TZ` | `Asia/Shanghai` | 容器日志时区。业务时钟在代码里写死上海时区 |

---

## 5. 备份与恢复

备份不需要把 3306 暴露到宿主机。在仓库根目录执行（密码来自容器环境变量，不会出现在命令行参数里）：

```bash
mkdir -p backups
docker compose exec -T mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --databases "$MYSQL_DATABASE"' > "backups/horus-$(date +%F).sql"
```

恢复前先停应用，避免恢复过程中继续写入：

```bash
docker compose stop horus
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < backups/horus-2026-10-16.sql
docker compose start horus
```

恢复目标与需求文档一致：数据量小，能把库找回来即可。建议每天把 `backups/` 拷到现有 MySQL 备份目录，不要只留在应用宿主机磁盘上。

根账号应急入口：

```bash
docker compose exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD"
```

---

## 6. 升级

1. 按第 5 节备份。
2. 拉取新版本代码。若本周改过 `HORUS_NEW_WINDOW_DAYS`，同步 `.env` 里的 `NEXT_PUBLIC_NEW_WINDOW_DAYS`。
3. 重新构建并启动：

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:${HORUS_PORT:-3000}/api/health
```

启动脚本会再次 `drizzle-kit push --force`。无结构差异时这是空操作。`--force` 会自动接受 Drizzle 判定为可能丢数据的语句（例如删列）。升级前看 schema diff；不能接受自动删列时，先停在旧版本，手工迁移后再升级。

`db:init` 每次启动都会跑，但不会覆盖已有负责人或已保存的钉钉配置。

回滚：用上一版镜像重新 `up`，再用第 5 节的 SQL 恢复。不要只回滚应用、留下不兼容的新表结构。

---

## 7. 故障排查

| 现象 | 处理 |
| --- | --- |
| `horus-app` 一直重启，日志是 `DATABASE_URL is required` | `.env` 未放到仓库根目录，或 `MYSQL_PASSWORD` 为空 |
| 日志停在 `Waiting for MySQL` | `docker compose logs mysql`。常见原因是 root 密码含特殊字符，或数据卷是用另一套密码初始化的。空库可 `docker compose down` 后删除卷重建（会丢数据） |
| `/api/health` 500 | 应用已起来但查库失败。核对 compose 注入的 `DATABASE_URL` 主机名是 `mysql` 不是 `127.0.0.1` |
| 登录页出现演示账号 | `HORUS_DEMO_MODE=true`。生产立刻改回 `false` 并重建容器。演示模式会在空库灌入虚拟团队 |
| 09:30 没有群消息 | 容器当时必须在线；「每日异常摘要」已开启；Webhook 已保存；当天 `last_run_date` 未被提前占住。看「推送记录」。失败项会在次日合并 |
| 同一天收到两条定时摘要 | 不应发生。定时路径在发信前用条件更新抢占 `last_run_date`。手动「立即发送测试」不占这个名额，可以和定时各发一条 |
| 页面「本周新建」天数和预期不符 | 看运行中的 `HORUS_NEW_WINDOW_DAYS`。它会随 `/api/workspace` 下发。改完后重启容器即可，不必为了这一项单独改前端代码 |

查看日志：

```bash
docker compose logs -f horus
docker compose logs --tail 100 mysql
```

---

## 8. 本地开发（非容器）

需要 Node.js 22+ 和一台 MySQL 8.0。库和账号建好后：

```bash
cd frontend
cp .env.example .env
npm install
npm run db:push
npm run db:init
npm run dev
```

验证：

```bash
npm run test:domain
npm run typecheck
npm run lint
npm run build
```

`npm run test:digest` 需要可用的 `DATABASE_URL`，它只插入临时通知行并验证抢占，不调用钉钉。`npm run test:acceptance` 还需要以 `HORUS_DEMO_MODE=true` 启动应用，并安装 Playwright Chromium。不要对生产库跑验收脚本。
