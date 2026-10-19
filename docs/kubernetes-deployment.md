# Kubernetes 部署（外部 MySQL + 挂载 .env）

## 配置加载机制（先读）

外部挂载 `.env` 用于**配置与镜像分离**：同一个镜像可以通过不同的配置文件部署到不同环境，不必为数据库地址或服务端业务配置重新构建镜像。

这里的“运行时配置”指**容器启动时加载**，不是每次请求读取文件，也不是热更新：

```text
K8s 挂载 Secret 中的 .env
    ↓
容器入口用 dotenv 读取文件，将配置注入子进程环境
    ↓
等待 MySQL → 同步表结构 → 初始化负责人
    ↓
启动 Next.js（继承同一份配置）
```

| 配置类型 | 示例 | 修改后的生效方式 |
| --- | --- | --- |
| 服务端配置 | `DATABASE_URL`、`APP_URL`、`HORUS_NEW_WINDOW_DAYS`、`HORUS_DB_CONNECTION_LIMIT` | 更新 Secret，再重启 Deployment；无需重建镜像 |
| 初始化配置 | `HORUS_INIT_OWNER_USERNAME`、`HORUS_INIT_OWNER_NAME` | 同上，但仅用于首次创建负责人，已有账号不会被覆盖 |
| 客户端构建期配置 | `NEXT_PUBLIC_NEW_WINDOW_DAYS` | 构建时传入新值，重新构建并推送镜像，再更新 Deployment 镜像 |

**修改本地 `.env` 不会自动更新集群 Secret；修改 Secret 也不会让已运行的进程重新加载配置。** 即使挂载文件随后被 K8s 更新，仍需按第 4 节重启。

## 1. 镜像

在仓库根目录执行，替换镜像仓库与版本，并修改 `deploy/k8s/horus.yaml` 的 `image`（私有仓库自行配置 imagePullSecrets）：

```bash
docker build --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 -t <registry>/horus:<tag> ./frontend
docker push <registry>/horus:<tag>
```

保持 **1 副本 + Recreate**，不要启用 HPA，避免调度器与启动建表并发。升级会短暂停机。

## 2. 外部配置文件

在集群外受保护的位置创建 `/secure/horus/.env`：

```dotenv
DATABASE_URL=mysql://horus:replace_me@mysql.example.internal:3306/horus
HORUS_DEMO_MODE=false
HORUS_INIT_OWNER_USERNAME=admin
HORUS_INIT_OWNER_NAME="团队负责人"
APP_URL=https://horus.example.com
HORUS_NEW_WINDOW_DAYS=7
HORUS_DB_CONNECTION_LIMIT=10
```

- MySQL 8.0 地址必须从 Pod 可达；提前建库与账号并授权建表/改表。密码的 URL 特殊字符须百分号编码。
- 不需要 Compose 的 `MYSQL_*` / `HORUS_PORT`；默认监听 `0.0.0.0:3000`。
- 禁止生产开启 `HORUS_PREVIEW_MODE` / `HORUS_DEMO_MODE`。真实配置不要提交到 Git。
- `NEXT_PUBLIC_*` 是构建期值，挂载不会修改客户端 bundle；`HORUS_NEW_WINDOW_DAYS` 在容器启动时读取，无需重建镜像。

通过 Secret 保存含密码的文件：

```bash
chmod 600 /secure/horus/.env
kubectl create namespace horus
kubectl -n horus create secret generic horus-env --from-file=.env=/secure/horus/.env
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus
```

Secret 只读挂载至 `/etc/horus/.env`。镜像先用 dotenv 解析，再启动等待 MySQL、同步表结构、初始化负责人及 Next.js。**不通过 shell source 执行配置内容**。支持引号、中文和空格；已有环境变量优先于文件（包括镜像默认的 `PORT`、`TZ` 等）。

通用默认路径为 `/app/.env`，可通过 `HORUS_ENV_FILE` 指定绝对路径。显式指定文件缺失/不可读会启动失败；默认文件不存在则继续使用环境变量，兼容现有 Compose 与 `docker -e`。

Secret 默认是编码而非加密，生产应配置静态加密及最小权限 RBAC。

## 3. 心跳与访问

`GET /api/health` 无需登录，始终返回 HTTP 200、`{"ok":true}` 和 `Cache-Control: no-store`，不导入数据库模块、不创建连接、不执行 SQL。

示例的 startup/liveness/readiness 均使用此接口。**readiness 只表示 HTTP 进程可响应，不代表数据库或业务健康**。启动初始化仍访问数据库，完成后才启动 HTTP；startupProbe 预留约 5 分钟，大库可调高阈值。正常业务和原有定时任务仍访问数据库，与心跳无关。

```bash
kubectl -n horus port-forward service/horus 3000:3000
# 另一个终端
curl -fsS http://127.0.0.1:3000/api/health
```

对外使用现有 Ingress/网关指向 `horus:3000`，配置 HTTPS 与 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`，并让 `APP_URL` 与正式域名一致。不要公开数据库端口。

## 4. 更新配置

### 4.1 修改服务端配置（无需重建镜像）

先编辑外部文件 `/secure/horus/.env`，然后将其重新写入 Secret 并重启：


```bash
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus rollout restart deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=360s
```

配置仅在启动时加载，修改 Secret 后必须重启。示例采用 Recreate 策略，重启期间会短暂停机。验证时除心跳外，还应登录并检查业务页面，因为心跳不验证数据库连接。

### 4.2 修改客户端构建期配置（需要重建镜像）

例如调整客户端“本周新建”窗口的兜底值：

```bash
# 替换仓库地址和新版本标签，不要把占位符原样执行
IMAGE=<registry>/horus:<new-tag>
docker build --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=14 -t "$IMAGE" ./frontend
docker push "$IMAGE"
```

将外部 `.env` 中的 `HORUS_NEW_WINDOW_DAYS` 同步设为 `14`，按 4.1 的命令更新 Secret；随后把 `deploy/k8s/horus.yaml` 的 `image` 改为上述新镜像地址并执行：

```bash
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=360s
```

若同时更新配置和镜像，可先更新 Secret，再直接应用新镜像，不必在两者之间额外执行一次 `rollout restart`。仅在挂载文件中修改 `NEXT_PUBLIC_*` 不能覆盖已构建的客户端代码。

### 4.3 常见配置问题

- **修改了本地文件但未生效**：先更新集群 Secret，再重启 Deployment。
- **Secret 已更新但应用仍使用旧值**：应用不支持配置热加载，检查是否已重启、Pod 是否完成替换。
- **重启后仍使用其他值**：检查 Deployment 的 `env` / `envFrom` 以及镜像默认环境变量，它们优先于文件；例如当前镜像默认 `PORT=3000`、`TZ=Asia/Shanghai`，若需覆盖请显式设置容器环境变量，并同步调整端口相关配置。
- **启动报配置文件不存在或不可读**：检查 `HORUS_ENV_FILE` 是否与挂载路径一致，以及 Secret 键名 `.env` 和文件权限是否正确。
- **修改初始负责人配置但已有账号未变化**：初始化是幂等的，不会重命名已有负责人，请通过应用的账号管理功能处理。

升级或重启会再次同步表结构与初始化，请先备份。数据库升级/回滚注意事项见[部署手册](deployment-guide.md)。示例不创建 MySQL、Ingress 或数据库备份，由现有基础设施提供。
