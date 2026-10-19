# Horus Kubernetes 部署文档（纯环境变量版 · 不挂载配置文件）

> 本文档是 **纯 `env` 注入版**：配置全部通过 Kubernetes 的 `env` / `envFrom`（Secret + ConfigMap）注入容器，**不创建、不挂载任何 `.env` 文件**，也不需要把 `deploy/k8s/horus.yaml` 改来改去才能改配置。
>
> 仓库已有的另一版 [`kubernetes-deployment.md`](./kubernetes-deployment.md) 是「Secret 挂载 `.env` 文件版」。两版二选一即可，不要混用：纯 env 版**绝对不要**设置 `HORUS_ENV_FILE`（见 §6.4），文件版则必须设置。应用代码对两版都兼容——区别只在配置来源。

- 适用版本：V1（Next.js 全栈单体 + MySQL 8.0）
- 配置来源：`DATABASE_URL` 等全部来自容器环境变量（镜像入口 `load-env.cjs` 在找不到 `/app/.env` 且未设置 `HORUS_ENV_FILE` 时，直接沿用环境变量启动，与现有 Compose / `docker -e` 行为一致）
- 时区：镜像已内置 `TZ=Asia/Shanghai`、`PORT=3000`、`NODE_ENV=production`（见 `frontend/Dockerfile` runner 阶段），业务时间以 ISO-8601 UTC 字符串存 `VARCHAR`，不依赖数据库时区转换

---

## 0. 先说清三件事（避免踩坑）

### 0.1 部署长什么样

```text
用户浏览器 ──HTTPS──► Ingress / 网关 ──► Service horus:3000 ──► Pod horus（Next.js，:3000，1 副本）
                                                                    │
                                                                    └──► MySQL 8.0（:3306，二选一，见第 3 节）
                                                                           ├─ 方式 A：外部 MySQL（公司 DBA / 云 RDS，生产推荐）
                                                                           └─ 方式 B：集群内 MySQL（StatefulSet + PVC，适合测试/小规模）
Pod horus ──出站 443──► https://oapi.dingtalk.com（每日异常摘要推送，可选功能）
```

| 组件 | 说明 |
|---|---|
| `horus` Deployment | 1 副本，`Recreate` 策略。镜像启动时自动：等 MySQL → 同步 7 张表 → 创建初始负责人 → 启动 Next.js |
| `horus` Service | ClusterIP `3000`，只做集群内入口；公网/内网入口靠 Ingress 或网关转发 |
| MySQL 8.0 | 业务数据唯一持久化位置。Pod 本地不存任何业务数据，删 Pod 不丢数据，删数据库/PVC 才丢 |
| Secret `horus-secret` | 只放敏感项（目前就是 `DATABASE_URL`，集群内 MySQL 时再加 MySQL 的密码项） |
| ConfigMap `horus-config` | 放非敏感项（`APP_URL`、初始负责人账号等），改起来不用碰 Secret |

### 0.2 要不要手工初始化 SQL？——**常规部署不需要**

这是最常见的疑问，直接给结论：

| 场景 | 要不要跑 SQL | 说明 |
|---|---|---|
| **常规部署（推荐）** | **只建库 + 建账号 + 授权，不跑任何建表 SQL** | 容器每次启动自动执行：等 MySQL 就绪（最长 90 秒）→ `drizzle-kit push` 同步表结构 → 校验 7 张表齐全 → 幂等创建初始负责人和通知设置默认行。细节见第 7 节启动流程 |
| DBA 不允许应用账号有建表/改表权限 | DBA 在**空库**上手工依次执行 `deploy/mysql/01-schema.sql`、`deploy/mysql/02-init-owner.sql`，再收紧应用账号权限 | `01-schema.sql` 是**一次性**建表脚本，重复执行会因表/索引已存在报错，**不要对已有数据的库重跑**；`02-init-owner.sql` 幂等可重跑。应用启动时仍会再跑一遍结构同步与负责人初始化，与手工结果幂等不冲突。完整步骤见附录 A |
| 看到仓库里有 `deploy/mysql/*.sql` 就想全跑一遍 | **不要** | 那两个文件是给 DBA 评审/人工初始化用的，不是部署必经步骤。常规部署跑了也不会立刻坏（表会被重复创建而报错中断），但徒增困惑 |
| 想灌演示数据 | 不要跑任何 SQL | 演示数据只在 `HORUS_DEMO_MODE=true` 时由应用自动灌入，**生产严禁开启**（会免登录、灌假团队/需求） |

7 张业务表（启动后可用 `SHOW TABLES;` 核对）：

```text
horus_teams  horus_members  horus_requirements  horus_sessions
horus_audit_logs  horus_notification_settings  horus_notification_logs
```

### 0.3 三条生产红线

1. **只跑 1 个副本，禁止扩容、禁止 HPA。** 定时摘要调度（`frontend/src/lib/scheduler.ts`）和启动时的表结构同步都假设单实例；清单写死 `replicas: 1` + `Recreate`，升级时会有短暂中断（秒级到一分钟），这是预期行为。
2. **`HORUS_DEMO_MODE` 生产必须 `false`，不要设置 `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW`。** 后两者是本地预览/沙箱专用，生产设置了也没有正收益。
3. **不要把 MySQL 的 3306 暴露到公网/办公网。** 外部 MySQL 靠防火墙/白名单只放行 Pod 出口；集群内 MySQL 干脆不建对外 Service。

---

## 1. 前置条件与检查

| 项 | 要求 | 检查命令 |
|---|---|---|
| Kubernetes 集群 | 任意主流发行版（k8s 1.25+ 均可），能创建 namespace、Secret、ConfigMap、Deployment、Service；（方式 B 还需要）StatefulSet、PVC | `kubectl version` |
| kubectl context | 指向**目标集群**，且有上述权限 | 见下方 |
| 镜像仓库 | 集群节点可拉取（Harbor / 云厂商 ACR·ECR·GCR / Docker Hub 私有仓等）；私有仓需准备拉取凭证 | 节点上能 `crictl pull` 或先部署一个测试 Pod 验证 |
| 构建机 | 装 Docker（或 Buildx），能推镜像；CPU 架构与集群节点一致，不一致时用 `--platform` 交叉构建 | `docker version`、`docker buildx version` |
| MySQL（方式 A） | MySQL **8.0**（用了 `utf8mb4_0900_ai_ci` 排序规则，5.7 不行），Pod 网络可达其 3306 | 见 §3.1 第 4 步连通性测试 |
| 域名与证书（对外时） | 一个正式域名 + TLS 证书（Ingress 控制器 + cert-manager 或现成网关均可） | — |
| 出站网络（可选） | Pod 能访问 `https://oapi.dingtalk.com:443`，仅钉钉摘要需要 | 见 §10.3 联调 |

先确认操作的是目标集群，别把测试命令打到生产：

```bash
kubectl config current-context          # 确认集群名对得上
kubectl cluster-info                    # 确认 API Server 地址
kubectl get nodes -o wide               # 确认节点 Ready、记下节点架构（一般 amd64）
kubectl get storageclass                # 方式 B 需要：记下默认 StorageClass 名字
kubectl get ingressclass                # 对外暴露时需要：记下 IngressClass 名字（如 nginx）
```

本文所有命令默认在**仓库根目录**执行，namespace 统一用 `horus`。文中占位符约定：

| 占位符 | 含义 | 示例 |
|---|---|---|
| `<registry>` | 你的镜像仓库地址 | `harbor.example.com`、`registry.cn-hangzhou.aliyuncs.com` |
| `<tag>` | 每个版本一个新 tag，**不要复用 `latest`** | `20261019-1`、`v1.0.1` |
| `<mysql-host>` | 外部 MySQL 的 Pod 可达地址 | `mysql.example.internal`、RDS 内网地址 |
| `<正式域名>` | 用户实际打开的域名 | `horus.example.com` |

---

## 2. 第一步：构建并推送镜像

构建上下文是 `./frontend`（Dockerfile 在里面），在仓库根目录执行：

```bash
export REGISTRY=<registry>                       # 例如 harbor.example.com
export IMAGE="$REGISTRY/horus/horus:<tag>"       # 例如 harbor.example.com/horus/horus:20261019-1

docker login "$REGISTRY"

docker build \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t "$IMAGE" \
  ./frontend

docker push "$IMAGE"
```

本机与节点架构不一致时（典型：Apple Silicon Mac → amd64 集群），改用 Buildx 一条命令构建并推送：

```bash
docker buildx build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t "$IMAGE" --push ./frontend
```

⚠️ **构建期变量只有一个**：`NEXT_PUBLIC_NEW_WINDOW_DAYS`（「本周新建」窗口的客户端兜底值，默认 `7`，范围 1–90）会被写进前端 bundle，**改它必须重新构建镜像**；其余配置全是运行时 env，不用重构建。运行时还有个同义的 `HORUS_NEW_WINDOW_DAYS`（服务端下发给页面，优先级更高），两者请保持一致，见 §11。

推完记下完整的 `$IMAGE`，第 6 节要用。可以顺手在集群里验一下节点能拉到：

```bash
kubectl run pull-test --rm -it --restart=Never --image="$IMAGE" --image-pull-policy=Always -- echo ok
# 输出 ok 并自动删除 Pod 即为拉取成功；报 ImagePullBackOff 先解决仓库权限/网络，别往下走
```

---

## 3. 第二步：准备 MySQL（二选一）

### 3.1 方式 A：外部 MySQL（生产推荐）

适合：公司已有 DBA 维护的 MySQL、云 RDS/云数据库、或独立数据库服务器。

**第 1 步：让 DBA（或你自己用 root）建库、建账号、授权。** 字符集必须是 `utf8mb4`；`<允许访问的来源>` 按 DBA 策略收紧（固定出口 IP / 网段 / `%`，能收紧就别用 `%`）；密码建议只用字母、数字、下划线（理由见 §5.2）：

```sql
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'horus'@'<允许访问的来源>' IDENTIFIED BY '<强密码>';
GRANT ALL PRIVILEGES ON horus.* TO 'horus'@'<允许访问的来源>';
FLUSH PRIVILEGES;
```

- `GRANT ALL ON horus.*` 包含了建表/改表权限，这是常规部署必需的（启动要同步表结构）；走附录 A 的 DBA 人工初始化路线时，初始化后可按 DBA 规范收紧为仅 DML，但**每次升级若有表结构变更，仍需临时恢复 DDL 权限或由 DBA 先执行变更**。
- 只需要建**空库**，不要往里导任何 SQL（原因见 §0.2）。

**第 2 步：确认 Pod 网络到 MySQL 通。** 防火墙/安全组/白名单放行集群 Pod 的实际出口地址访问 `<mysql-host>:3306`（NAT 场景下是节点出口 IP，不是 Pod IP）。验证方法在建好 namespace 后做（第 4 节建完 namespace 回来执行）：

```bash
# 用一次性 MySQL 客户端 Pod 测连通 + 账号可用（密码会提示输入，不落命令行历史）
kubectl -n horus run mysql-client --rm -it --restart=Never --image=mysql:8.0 -- \
  mysql -h <mysql-host> -P 3306 -u horus -p -e "SELECT VERSION(); SHOW DATABASES LIKE 'horus';"
```

能返回版本号和 `horus` 库即可。常见失败：`Can't connect` = 网络/防火墙没放行；`Access denied` = 来源主机不匹配或密码错；`Unknown database` = 第 1 步的建库没在这台实例上执行。

### 3.2 方式 B：集群内 MySQL（测试/小规模自包含）

适合：没有外部 MySQL、想一套清单自包含的场景。代价是数据库运维（备份、磁盘、高可用）要你自己扛，**重要生产数据更推荐方式 A**。

**第 1 步：建 namespace 和 MySQL 密码 Secret。** 注意这里有**两套**密码：root 密码（运维进库用）和应用密码（Horus 连库用），都只用字母、数字、下划线：

```bash
kubectl create namespace horus

kubectl -n horus create secret generic horus-mysql-secret \
  --from-literal=MYSQL_ROOT_PASSWORD='<root强密码>' \
  --from-literal=MYSQL_PASSWORD='<应用强密码>'
```

**第 2 步：一条命令部署 MySQL（StatefulSet + PVC + Service）。** 直接把下面整段粘贴执行（不需要保存成文件）。说明在命令后：

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: horus-mysql
  namespace: horus
spec:
  selector:
    app: horus-mysql
  ports:
    - name: mysql
      port: 3306
      targetPort: 3306
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: horus-mysql
  namespace: horus
spec:
  serviceName: horus-mysql
  replicas: 1
  selector:
    matchLabels:
      app: horus-mysql
  template:
    metadata:
      labels:
        app: horus-mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          args:
            - --character-set-server=utf8mb4
            - --collation-server=utf8mb4_0900_ai_ci
            - --default-time-zone=+08:00
          ports:
            - name: mysql
              containerPort: 3306
          env:
            - name: MYSQL_DATABASE
              value: horus
            - name: MYSQL_USER
              value: horus
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: horus-mysql-secret
                  key: MYSQL_ROOT_PASSWORD
            - name: MYSQL_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: horus-mysql-secret
                  key: MYSQL_PASSWORD
            - name: TZ
              value: Asia/Shanghai
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
          readinessProbe:
            exec:
              command: ["sh", "-c", "mysqladmin ping -h 127.0.0.1 -u\"$MYSQL_USER\" -p\"$MYSQL_PASSWORD\" --silent"]
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 12
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 1Gi
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        # storageClassName: <你的StorageClass>   # 无默认 StorageClass 时取消注释并填写
        resources:
          requests:
            storage: 10Gi
EOF
```

要点：

- 官方 `mysql:8.0` 镜像首次启动时，会按 `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` **自动建好 `horus` 库和 `horus` 账号并授权**，等价于方式 A 的第 1 步，不需要你再执行任何 SQL。后续改 Secret 里的密码**不会**自动同步到库里已有账号（镜像只在数据目录为空时初始化），改密码请进库 `ALTER USER` 后再改 Secret。
- 数据存在 PVC 里（`data-horus-mysql-0`），删 Pod、删 StatefulSet 都不丢；**删 PVC = 删全部数据**。
- 这个 Service 只在集群内可达（ClusterIP），没有对外暴露 3306，符合 §0.3 红线。

**第 3 步：等 MySQL 就绪并验收。**

```bash
kubectl -n horus rollout status statefulset/horus-mysql --timeout=300s
kubectl -n horus get pod,pvc,service | grep mysql

# 进库确认库和账号已自动建好（能查到 horus 库即可，表等 Horus 启动后自动建）
kubectl -n horus exec -it statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SHOW DATABASES;"'
```

### 3.3 两种方式怎么选

| | 方式 A 外部 MySQL | 方式 B 集群内 MySQL |
|---|---|---|
| 数据可靠性 | DBA/RDS 负责（主从、备份、磁盘） | 自己负责，单副本 + 单 PVC，无高可用 |
| 运维成本 | 低，Horus 侧只管一个连接串 | 高，版本升级/备份/磁盘告警都要自己管 |
| 适用 | **生产首选** | 测试、演示、小团队自包含部署 |
| 后续章节差异 | `DATABASE_URL` 主机写 `<mysql-host>` | `DATABASE_URL` 主机写 `horus-mysql` |

---

## 4. 第三步：建 namespace（方式 A 在此建）

方式 B 已在 §3.2 建过，跳过。方式 A 执行：

```bash
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
kubectl get namespace horus
```

然后回 §3.1 第 2 步把 MySQL 连通性测掉，通了再往下。

---

## 5. 第四步：准备配置（Secret + ConfigMap）

纯 env 版把配置拆两处：**敏感的进 Secret，不敏感的进 ConfigMap**，Deployment 通过 `envFrom` 一次性全部注入。以后改配置就是改这两处再重启（第 10 节），不碰镜像、不碰 YAML 文件。

### 5.1 环境变量全表（先看懂再填）

#### 运行时必填

| 变量 | 示例 | 说明 |
|---|---|---|
| `DATABASE_URL` | `mysql://horus:<密码>@<mysql-host>:3306/horus` | 唯一真正必填项。缺了它容器直接报错 `DATABASE_URL is required` 退出。主机名必须是 **Pod 可达地址**：方式 A 写 `<mysql-host>`，方式 B 写 `horus-mysql`；**绝不能写 `localhost`/`127.0.0.1`**（容器里的 localhost 是它自己） |

#### 运行时推荐（本文清单会全部显式写出，便于排障时一眼看全）

| 变量 | 默认 | 说明 |
|---|---|---|
| `HORUS_DEMO_MODE` | `false` | 生产必须 `false`。`true` 会灌演示团队/需求并允许免登录体验，仅本地演示用 |
| `APP_URL` | — | 用户实际打开的正式地址，如 `https://horus.example.com`。用于钉钉摘要里的跳转链接兜底（页面「通知设置」里填的链接优先于它）。必须与实际访问域名一致，不要写 `localhost` |
| `HORUS_INIT_OWNER_USERNAME` | `admin` | 初始负责人**登录账号**，3–32 位字母/数字/`.`/`_`/`-`。仅首次创建负责人时有效，已有账号后改它不会改名 |
| `HORUS_INIT_OWNER_NAME` | `团队负责人` | 初始负责人姓名，1–40 字符。同上，仅首次有效 |
| `HORUS_NEW_WINDOW_DAYS` | `7` | 「本周新建」窗口天数，范围 1–90。运行时读取，改后重启生效不用重建镜像；与构建期 `NEXT_PUBLIC_NEW_WINDOW_DAYS` 保持一致 |
| `HORUS_DB_CONNECTION_LIMIT` | `10` | MySQL 连接池大小。单实例小团队保持 10 即可，不要盲目调大（还要看 MySQL 侧 `max_connections`） |
| `TZ` | `Asia/Shanghai` | 镜像已内置此默认值，清单里显式写出只是为了醒目；可删 |

#### 构建期（只在第 2 节 `docker build` 时用，不要塞进运行时 env 指望它生效）

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_NEW_WINDOW_DAYS` | `7` | 写进前端 bundle 的兜底值。运行时在 ConfigMap 里同名设置**不会**改掉已构建的客户端代码，所以本文清单运行时不再写它，只靠 `HORUS_NEW_WINDOW_DAYS` 下发。二者取值保持一致即可 |

#### 镜像已内置、不要乱改

| 变量 | 镜像值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 应用监听端口。改了它必须同步改 Deployment 探针和 Service 的 `targetPort`，没特殊需求别动 |
| `HOSTNAME` | 镜像里是 `0.0.0.0`，入口脚本启动前还会再强制设为 `0.0.0.0` | 别在 env 里给它赋别的值 |
| `NODE_ENV` | `production` | 别动，改了会影响登录/Cookie 等生产行为 |

#### K8s 纯 env 版不要出现的变量

| 变量 | 为什么不要 |
|---|---|
| `HORUS_ENV_FILE` | 这是「挂载 `.env` 文件版」才设的。纯 env 版一旦设了它而文件不存在，容器直接启动失败（入口逻辑：显式指定文件缺失即报错） |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` / `HORUS_PORT` | 前四个是 **MySQL 容器自己的**变量（方式 B 已写在 StatefulSet 里），不是 Horus 应用的；`HORUS_PORT` 是 Compose 宿主机映射端口概念。把它们塞进 Horus 的 ConfigMap 只会造成误解 |
| `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW` | 本地只读预览 / 沙箱内嵌预览专用，生产不要设置 |

### 5.2 `DATABASE_URL` 的密码编码（最容易卡住的一步）

`DATABASE_URL` 是标准 URL：`mysql://<用户>:<密码>@<主机>:3306/<库名>`。如果密码里含 URL 特殊字符，又不做百分号编码，连接串会被截断/解析错位，报的多半是「密码错误」假象。所以：

- **首选办法**：密码只用字母、数字、下划线，从源头避开编码问题（生成命令：`openssl rand -hex 24`，天然纯十六进制）。
- 已有含特殊字符的密码：按下面对照表替换后再拼 URL（应用侧会 `decodeURIComponent` 还原，所以编码是安全的）：

| 字符 | `@` | `:` | `/` | `?` | `#` | `%` | 空格 |
|---|---|---|---|---|---|---|---|
| 编码 | `%40` | `%3A` | `%2F` | `%3F` | `%23` | `%25` | `%20` |

懒人命令（把明文密码转成编码后的串）：

```bash
python3 -c "import urllib.parse,getpass; print(urllib.parse.quote(getpass.getpass('DB password: '), safe=''))"
# 输入密码不回显，输出即为可拼进 DATABASE_URL 的编码后密码
```

### 5.3 创建 Secret 与 ConfigMap

先拼好你的连接串（方式 A 替换 `<mysql-host>` 和密码；方式 B 主机固定 `horus-mysql`、密码与 §3.2 的 `MYSQL_PASSWORD` 相同）：

```bash
export DATABASE_URL='mysql://horus:<编码后密码>@<mysql-host>:3306/horus'
# 方式 B 示例：export DATABASE_URL='mysql://horus:<应用密码>@horus-mysql:3306/horus'
```

创建 Secret（只有敏感项进 Secret；用 `create ... --dry-run | apply` 的写法保证可重复执行、幂等更新）：

```bash
kubectl -n horus create secret generic horus-secret \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

创建 ConfigMap（非敏感项；`APP_URL` 先写正式域名，还没定域名可先写 `http://localhost:3000`，第 8 节暴露后再改）：

```bash
kubectl -n horus create configmap horus-config \
  --from-literal=HORUS_DEMO_MODE=false \
  --from-literal=HORUS_INIT_OWNER_USERNAME=admin \
  --from-literal=HORUS_INIT_OWNER_NAME='团队负责人' \
  --from-literal=APP_URL='https://<正式域名>' \
  --from-literal=HORUS_NEW_WINDOW_DAYS=7 \
  --from-literal=HORUS_DB_CONNECTION_LIMIT=10 \
  --from-literal=TZ=Asia/Shanghai \
  --dry-run=client -o yaml | kubectl apply -f -
```

验收（**不要**把 Secret 内容明文打印到终端/截图/工单里，只看键名）：

```bash
kubectl -n horus get secret horus-secret configmap horus-config
kubectl -n horus get secret horus-secret -o jsonpath='{.data}' | python3 -c "import sys,json; print(list(json.load(sys.stdin).keys()))"
# 预期只输出 ['DATABASE_URL']
kubectl -n horus get configmap horus-config -o yaml   # ConfigMap 非敏感，可看全文核对
unset DATABASE_URL                                     # 本地 shell 里的明文连接串用完清掉
```

> 安全说明：K8s Secret 默认只是 Base64 编码、不是加密。生产集群应开启 etcd 静态加密（EncryptionConfiguration 或云厂商默认加密），并用 RBAC 限制谁能 `get secret`。不要把 `kubectl get secret -o yaml` 的输出存进 Git/文档。

私有镜像仓库的拉取凭证（如需要）：

```bash
kubectl -n horus create secret docker-registry registry-pull \
  --docker-server=<registry> --docker-username='<用户名>' --docker-password='<密码>'
# 部署后若 Pod 报 ImagePullBackOff 且事件里提示 pull secret，再把下面两行加进第 6 节 Deployment 的 Pod spec：
#       imagePullSecrets:
#         - name: registry-pull
```

---

## 6. 第五步：部署 Horus

### 6.1 一条命令应用清单（Deployment + Service）

把 `$IMAGE` 换成第 2 节推送的完整镜像地址（下面用变量展开，注意 heredoc 用的是不带引号的 `EOF` 以便展开 `$IMAGE`；清单里没有其他 `$` 符号，可放心粘贴）：

```bash
export IMAGE="<registry>/horus/horus:<tag>"   # 已在第 2 节 export 过可跳过

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: horus
  namespace: horus
  labels:
    app: horus
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: horus
  template:
    metadata:
      labels:
        app: horus
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
        - name: horus
          image: $IMAGE
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - configMapRef:
                name: horus-config
            - secretRef:
                name: horus-secret
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 1Gi
          startupProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 60
          livenessProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: horus
  namespace: horus
  labels:
    app: horus
spec:
  type: ClusterIP
  selector:
    app: horus
  ports:
    - name: http
      port: 3000
      targetPort: http
EOF
```

### 6.2 清单逐段说明（每一段为什么这么写）

| 片段 | 说明 |
|---|---|
| `replicas: 1` + `strategy: Recreate` | 单实例红线（§0.3）。Recreate = 先停旧 Pod 再起新 Pod，升级短暂中断，但保证任何时刻只有一个进程在跑调度器和建表逻辑。**不要改 RollingUpdate、不要加 HPA** |
| `image: $IMAGE` + `IfNotPresent` | 每个版本用独立 tag；同 tag 不会被重复拉取，所以更不要复用 tag 发新版（节点会拿到旧缓存）。私有仓库按 §5.3 末尾加 `imagePullSecrets` |
| `envFrom: configMapRef + secretRef` | 纯 env 版核心：ConfigMap 和 Secret 的**每个键**都会变成容器环境变量。注：若同一个键两边都有，排在后面的 `secretRef` 优先——所以键名不要在两处重复定义 |
| 没有 `HORUS_ENV_FILE`、没有 volumes | 这正是与「挂载 .env 文件版」的区别：入口找不到 `/app/.env` 时自动走环境变量。**不要画蛇添足加卷挂载** |
| `runAsNonRoot / 1001` | 镜像内应用用户就是 uid 1001（`nextjs`），清单显式声明与之对齐 |
| 探针全用 `GET /api/health` | 该接口只证明 HTTP 进程活着（返回 `{"ok":true}`），**不查数据库**（源码明确禁止它 import 数据库模块）。startupProbe 给 `60 × 5s = 300s` 上限，覆盖「等库 90 秒 + 建表 + 首次启动」的全过程；建表没完成前 HTTP 根本不起，所以 startup 不通过是正常等待状态，别急着杀 Pod |
| `requests 100m/256Mi, limits 内存 1Gi` | 百级需求规模足够；内存打满会被 OOMKill，宁可给到 1Gi。CPU 不设 limit（避免节流拖慢启动建表），只设内存上限 |
| Service `ClusterIP 3000` | 只负责集群内寻址。对外暴露方式在第 8 节，不把 Service 改成公网 LoadBalancer 裸奔（除非前面还有网关做 TLS 与访问控制） |

单个变量需要临时覆盖时，不用改 ConfigMap，可以在容器 `env` 里写同名变量（容器级 `env` 优先于 `envFrom`），例如强制某个 Pod 组先用新窗口天数：

```yaml
          env:
            - name: HORUS_NEW_WINDOW_DAYS
              value: "14"
          envFrom:
            - configMapRef:
                name: horus-config
            - secretRef:
                name: horus-secret
```

但长期配置请回写 ConfigMap/Secret，别让覆盖项散落在清单里失控。

### 6.3 等待启动并看日志验收

```bash
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus get deployment,pod,service -o wide
kubectl -n horus logs deployment/horus --tail=200
```

正常日志应依次出现（顺序即启动流程）：

```text
Waiting for MySQL...
MySQL is ready
Synchronizing MySQL schema...
MySQL schema ready (7 tables)
Created initial owner account 'admin'. Set its password on first login.
Horus production data initialization complete.
Starting Horus...
```

第二次以后启动（负责人已存在）倒数第二行会变成 `Keeping existing owner account 'admin' (idempotent initialization)`，这是幂等生效的标志，不是报错。

### 6.4 启动流程详解（出问题时对照卡在哪一步）

容器入口依次做 5 件事（`frontend/docker-entrypoint.cjs` → `frontend/docker-entrypoint.sh`）：

1. **加载配置**：未设 `HORUS_ENV_FILE` 且 `/app/.env` 不存在 → 直接用容器环境变量；已通过 `env`/`envFrom` 显式注入的值优先级最高。
2. **校验 `DATABASE_URL`**：为空立即退出（`DATABASE_URL is required`）。
3. **等 MySQL**：每 2 秒试连一次（`SELECT 1`），**最长 90 秒**，超时打印最后一次错误并退出，Pod 会 CrashLoopBackOff 重试。日志长期停在 `Waiting for MySQL...` 就是卡这里——查地址/防火墙/账号，别查应用。
4. **同步表结构并校验**：`drizzle-kit push` 后显式查 `information_schema` 确认 7 张表齐全，缺表即退出。所以「日志有 `MySQL schema ready (7 tables)`」= 建表真的完成了。
5. **初始化数据**（`frontend/src/db/init-prod.ts`，幂等）：无负责人时按 `HORUS_INIT_OWNER_USERNAME/NAME` 创建 `id=owner` 的负责人（密码为空，首次登录设置）；始终确保通知设置 `id=default` 默认行存在。**不灌任何业务/演示数据**。

之后才 `Starting Horus...` 并监听 `0.0.0.0:3000`。因此 readiness 通过 ≈ 初始化全部完成，可以放心接流量。

数据库侧复核（任选其一）：

```bash
# 方式 A：用 §3.1 的一次性客户端 Pod，把 SQL 换成：
#   SHOW TABLES; SELECT id,username,name,role,active,(password_hash IS NULL) AS pwd_not_set FROM horus_members;
# 方式 B：
kubectl -n horus exec -it statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" horus -e "SHOW TABLES; SELECT id,username,role FROM horus_members;"'
# 预期：7 张 horus_* 表；horus_members 里有 1 行 id=owner 的负责人
```

---

## 7. 第六步：先集群内验证（别急着对外）

`rollout status` 成功后，先端口转发到本机验一遍：

```bash
kubectl -n horus port-forward service/horus 3000:3000
# 保持此终端运行，另开一个终端：
```

```bash
curl -fsS http://127.0.0.1:3000/api/health
# 预期：{"ok":true}
```

再打开浏览器访问 `http://127.0.0.1:3000`，应跳转登录页且**没有**演示账号入口（有就是 `HORUS_DEMO_MODE` 被开成了 `true`，回 §5 检查 ConfigMap）。

⚠️ `/api/health` 返回 200 **只代表进程活着，不代表数据库和业务正常**（这是有意设计，心跳不查库）。真正的验收是下一步能登录、能打开工作台。

---

## 8. 第七步：对外暴露（Ingress / 网关）

Service 是 ClusterIP，必须再经一层入口才能给同事用。任选现有基础设施的一种：

### 8.1 用 Ingress（有 Ingress 控制器时）

把 `<正式域名>` 和 `ingressClassName` 换成你的（证书由 cert-manager 自动签发时保留 `tls` 段并改 `secretName`；证书已备好则把证书 Secret 名填进去）：

```bash
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: horus
  namespace: horus
  annotations:
    cert-manager.io/cluster-issuer: <你的ClusterIssuer>   # 不用 cert-manager 则删掉此行
spec:
  ingressClassName: nginx            # 按 kubectl get ingressclass 的结果改
  tls:
    - hosts:
        - <正式域名>
      secretName: horus-tls
  rules:
    - host: <正式域名>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: horus
                port:
                  number: 3000
EOF
```

要点：

- 域名 DNS 解析到 Ingress 控制器入口地址；HTTPS 在这一层终结。
- 必须透传 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`（nginx Ingress 默认就带；自研网关/反向代理需手动确认），否则登录 Cookie 的 Secure 判断和跳转链接会出错。
- 挂好后把 ConfigMap 的 `APP_URL` 对齐成 `https://<正式域名>` 并重启（§10.1），钉钉摘要链接才正确。

### 8.2 用现有网关/反向代理（没有 Ingress 时）

在现有 Nginx/网关上把 `<正式域名>` 反代到集群内 `horus.horus.svc.cluster.local:3000`（网关在集群外时，用节点 NodePort 或云 LB 把 Service 引出来，目标仍是 Service 的 3000），并带齐：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

集群内服务全名是 `horus.horus.svc.cluster.local`（`<service>.<namespace>.svc.cluster.local`），同 namespace 内简写 `horus` 即可。

### 8.3 临时内网直连（仅调试，别长期这么用）

```bash
kubectl -n horus patch service horus -p '{"spec":{"type":"NodePort"}}'
kubectl -n horus get service horus   # 看分配的高位端口，浏览器开 http://<节点IP>:<端口>
```

NodePort 是明文 HTTP 且绕过统一入口管理，正式使用请回 8.1/8.2 并配 HTTPS；调试完改回 `ClusterIP`。

---

## 9. 第八步：首次登录与业务初始化

1. 浏览器打开正式地址（或 §7 的本地转发地址），未登录会跳到 `/login`。
2. 输入初始负责人账号（默认 `admin`，即 `HORUS_INIT_OWNER_USERNAME`）。系统识别为首次登录，要求**设置 8–72 位密码**（bcrypt 存库，会话只存 SHA-256 摘要）。这一步做完，库里负责人的 `password_hash` 从 NULL 变为已设置。
3. 负责人进系统后在页面里完成（**都不需要碰数据库**）：建团队 → 在团队里配阶段模板 → 预建成员账号并分配角色/团队 → PM 用自己的账号登录。
4. 验收锚点：换一台同事电脑和一部手机打开正式地址，能到登录页、能登录、手机端无横向滚动。

负责人密码忘了没有自助找回：由另一位负责人（或负责人在「成员管理」里）重置；若唯一的负责人密码丢失且无人能重置，属于运维事故，需 DBA 介入处理 `horus_members` 中 `id='owner'` 行的 `password_hash`（置 NULL 后下次登录会回到首次设密流程）——这属于应急手段，操作前先备份。

---

## 10. 日常运维

### 10.1 改配置（改 env，不用重建镜像）

配置只在**容器启动时**读一次，没有热更新。改完必须重启 Deployment，且是 `Recreate`，会短暂中断：

```bash
# 例 1：改非敏感项（APP_URL / 窗口天数 / 连接池等）——重写 ConfigMap 再重启
kubectl -n horus create configmap horus-config \
  --from-literal=HORUS_DEMO_MODE=false \
  --from-literal=HORUS_INIT_OWNER_USERNAME=admin \
  --from-literal=HORUS_INIT_OWNER_NAME='团队负责人' \
  --from-literal=APP_URL='https://<正式域名>' \
  --from-literal=HORUS_NEW_WINDOW_DAYS=14 \
  --from-literal=HORUS_DB_CONNECTION_LIMIT=10 \
  --from-literal=TZ=Asia/Shanghai \
  --dry-run=client -o yaml | kubectl apply -f -

# 例 2：改敏感项（换数据库地址/密码）——重写 Secret 再重启
kubectl -n horus create secret generic horus-secret \
  --from-literal=DATABASE_URL='mysql://horus:<新密码编码>@<mysql-host>:3306/horus' \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n horus rollout restart deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus --tail=100
```

注意：

- `kubectl create configmap ...` 是**整表替换**口径，命令里漏写的键会被删掉。只改一两个键更稳妥的做法：`kubectl -n horus edit configmap horus-config` 直接改，或 `kubectl -n horus patch configmap horus-config --type merge -p '{"data":{"HORUS_NEW_WINDOW_DAYS":"14"}}'`，然后同样 `rollout restart`。
- 只执行 `kubectl apply` 更新了 Secret/ConfigMap 而不重启，**运行中的进程不会感知**（即使 envFrom 的值在 Pod 里能看到变化，进程也只在启动时读）。
- 改 `HORUS_INIT_OWNER_*` 对已有负责人**无效**（幂等初始化不覆盖），改账号/姓名走页面成员管理。
- 临时改一个变量试效果可用一条命令：`kubectl -n horus set env deployment/horus HORUS_NEW_WINDOW_DAYS=14`（它会写进容器 `env` 并触发滚动；Recreate 下等于重启）。试完记得用 `kubectl -n horus set env deployment/horus HORUS_NEW_WINDOW_DAYS-` 删除覆盖项，让口径回到 ConfigMap，避免两处配置打架。

### 10.2 升级与回滚

```bash
# 0) 先备份数据库（见 10.4），尤其版本带表结构变更时——启动会自动同步新结构，老镜像不一定兼容新结构
# 1) 构建推送新 tag（第 2 节），然后只改镜像：
kubectl -n horus set image deployment/horus horus="<registry>/horus/horus:<新tag>"
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus --tail=200   # 确认仍是那串启动日志

# 回滚到上一版镜像：
kubectl -n horus rollout history deployment/horus
kubectl -n horus rollout undo deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=360s
```

若升级改过表结构又只回滚镜像导致不兼容，需连同升级前备份一起恢复数据库（§10.5），不要只回滚一半。

### 10.3 钉钉摘要联调（可选）

1. Pod 出站能到 `https://oapi.dingtalk.com:443`（防火墙放行）。
2. 负责人在页面「通知设置」里填钉钉机器人 Webhook（及可选加签密钥）、发送时间，页面里填的访问链接优先于 `APP_URL`。
3. 先页面内「发送测试/预览」验证，再等每日定时（北京时间）触发；发送记录在 `horus_notification_logs` 和页面日志里可查。

### 10.4 备份

> 备份文件必须再拷贝/同步到公司规定的备份位置（对象存储/备份机），只留在集群里不算完成备份。

方式 B（集群内 MySQL，最简单）：

```bash
mkdir -p backups
BACKUP="backups/horus-$(date +%Y%m%d-%H%M%S).sql.gz"
kubectl -n horus exec statefulset/horus-mysql -- \
  sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --databases "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP"
gzip -dc "$BACKUP" | grep -q 'CREATE TABLE' && echo "备份可读: $BACKUP"
```

方式 A（外部 MySQL）：在能连库的机器上用 DBA 给的账号执行等价 `mysqldump`，或走 RDS/DBA 自带备份体系；关键是确认备份里含 7 张 `horus_*` 表且定期演练恢复。

定时备份可把上面命令包成 CronJob（`schedule: "0 2 * * *"`，镜像 `mysql:8.0`，挂 Secret 连库，产物写到对象存储/PVC），本文不展开模板，按你们现有的备份规范落地即可。

### 10.5 恢复（危险操作，先留底再动手）

```bash
# 1) 先按 10.4 给当前库再备一份（命名 pre-restore-*）
# 2) 停应用，避免恢复过程中有写流量（Recreate 单副本，直接缩到 0）
kubectl -n horus scale deployment/horus --replicas=0

# 3) 导入（下面以方式 B 为例；方式 A 在可连库机器上对目标库执行 mysql 导入）
gzip -dc backups/<要恢复的文件>.sql.gz | kubectl -n horus exec -i statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

# 4) 拉起应用并验收
kubectl -n horus scale deployment/horus --replicas=1
kubectl -n horus rollout status deployment/horus --timeout=360s
curl -fsS http://127.0.0.1:3000/api/health   # 需先按第 7 节开着 port-forward；或直接浏览器登录验收
```

恢复后负责人账号/密码以备份时点为准；若备份早于首次设密，负责人会回到「首次登录设密」状态。

### 10.6 常用巡检命令

```bash
kubectl -n horus get pods -o wide
kubectl -n horus describe deployment horus
kubectl -n horus logs deployment/horus --tail=200          # 当前 Pod 日志
kubectl -n horus logs deployment/horus --previous --tail=200  # 上一个已退出 Pod 的日志（崩溃排障必看）
kubectl -n horus get events --sort-by=.metadata.creationTimestamp
kubectl -n horus top pod    # 需集群装 metrics-server；看是否逼近内存 1Gi limit
```

---

## 11. 故障排查速查

| 现象 | 大概率原因 | 怎么查 / 怎么办 |
|---|---|---|
| Pod `ImagePullBackOff` / `ErrImagePull` | 镜像地址/tag 写错、仓库未授权、节点与镜像架构不一致 | `kubectl -n horus describe pod <pod>` 看 Events；核对 §2 的 `$IMAGE`、§5.3 的 `imagePullSecrets`；用 §2 末尾的 pull-test Pod 复验 |
| Pod `CrashLoopBackOff`，日志 `DATABASE_URL is required` | Secret 没建、键名不是 `DATABASE_URL`、或 Deployment 没引用到 `horus-secret` | `kubectl -n horus get secret horus-secret` 确认存在；检查 §6.1 的 `envFrom`；进 Pod 看变量是否存在：`kubectl -n horus exec <pod> -- env \| grep -c DATABASE_URL`（只看有没有，别打印值） |
| 日志长期 `Waiting for MySQL...` 后退出（约 90 秒一轮） | Pod 到 MySQL 不通：地址错/写了 localhost、防火墙没放行、库没建 | 按 §3.1 第 2 步用客户端 Pod 复测；核对 `DATABASE_URL` 主机段；方式 B 先确认 `statefulset/horus-mysql` 已 Ready |
| 日志 MySQL 报错 `Access denied for user` | 密码错、密码特殊字符没编码、账号来源主机不匹配 | 按 §5.2 重新编码密码并重写 Secret（§10.1 例 2）；请 DBA 核对 `'horus'@'<来源>'` 授权 |
| 日志 MySQL 报错 `Unknown database 'horus'` | 库没建，或连错了实例 | 回 §3 第 1 步确认建库在**这台**实例上；核对 URL 尾部的库名 |
| 日志 `Schema sync did not create: ...` | 账号缺建表/改表权限，或库不是空库且结构冲突 | 给应用账号补 `horus.*` 全权后重启；仍失败把完整日志给 DBA，必要时走附录 A |
| startupProbe 一直不通过、Pod 反复重启 | 启动全程超过 300 秒：MySQL 慢、建表卡住，或大库同步久 | 先看日志卡在流程哪一步（§6.4）；确认 MySQL 健康；可适当调大 `failureThreshold`，别直接删探针 |
| Pod `OOMKilled` | 内存超 1Gi limit | `kubectl -n horus describe pod` 看 Last State；调大 limits.memory 并观察 `kubectl top` |
| 改了 ConfigMap/Secret 但不生效 | 没重启，或改的是本地文件而不是集群对象 | 按 §10.1 `rollout restart`；确认改的是 `kubectl -n horus get configmap horus-config` 看到的内容 |
| 重启后仍用旧值 | 容器级 `env` 覆盖了 `envFrom`（曾用过 `kubectl set env`） | `kubectl -n horus set env deployment/horus --list` 查覆盖项，多余的用 `变量名-` 后缀删除 |
| `/api/health` 是 200 但业务打不开/登录失败 | 心跳不查库，进程活着但数据库链路坏了 | 看应用日志的数据库报错；按上面 MySQL 行逐项查；以「能登录并打开工作台」为真实验收 |
| 登录页出现演示账号入口 | `HORUS_DEMO_MODE=true` 被误开 | ConfigMap 改回 `false` 并重启；若已在空库灌入演示数据且尚未投产，评估清库重来 |
| 改了负责人账号配置但登录还是旧账号 | 初始化幂等，不覆盖已有负责人 | 预期行为；走页面成员管理改，或参 §9 应急说明 |
| 页面「本周新建」天数与预期不符 | `HORUS_NEW_WINDOW_DAYS` 值不对，或构建兜底与运行时不一致 | 改 ConfigMap 重启即生效（运行时下发）；要改客户端兜底则改构建参数重构建镜像，并让两值一致 |
| 经 Ingress 登录态丢失/跳转异常 | 转发头不全或 `APP_URL` 与实际域名协议不一致 | 按 §8 补齐 `Host`/`X-Forwarded-*`；`APP_URL` 改为正式 `https://` 地址后重启 |
| 方式 B：MySQL Pod `Pending`，PVC 不绑定 | 无默认 StorageClass 或容量/可用区不满足 | `kubectl get storageclass` 后在 StatefulSet 里显式写 `storageClassName`；`kubectl -n horus describe pvc` 看原因 |
| 方式 B：改了 MySQL Secret 密码后应用连不上 | 镜像只在空数据目录时初始化账号，改 Secret 不改库内密码 | 进库 `ALTER USER` 改成一致，或把 Secret 改回库内现值；二者必须一致 |

---

## 12. 上线前检查清单（逐项打勾）

- [ ] `kubectl config current-context` 确认是目标集群
- [ ] 镜像已推送为**独立 tag**（非 latest），节点 pull-test 通过
- [ ] MySQL 为 8.0、`utf8mb4`；方式 A 已建空库+账号+授权且客户端 Pod 连通测试通过；方式 B StatefulSet 已 Ready、PVC 已 Bound
- [ ] **没有**对常规部署手工跑 `deploy/mysql/01-schema.sql`（§0.2）
- [ ] Secret 只有 `DATABASE_URL` 一个敏感键；密码已按 §5.2 处理；ConfigMap 中 `HORUS_DEMO_MODE=false`、`APP_URL` 为正式地址
- [ ] 没有设置 `HORUS_ENV_FILE`、`HORUS_PREVIEW_MODE`、`HORUS_EMBEDDED_PREVIEW`
- [ ] Deployment `replicas: 1` + `Recreate`，无 HPA；探针与资源如 §6.1
- [ ] 日志出现 `MySQL schema ready (7 tables)` 与负责人初始化行；库里 7 张表、1 个 owner 可查
- [ ] `/api/health` 返回 `{"ok":true}`，且**真人登录成功**并能打开工作台（不能只看心跳）
- [ ] Ingress/网关 HTTPS 可用，转发头齐全，手机端登录正常
- [ ] 已完成一次备份并验证可读（`gzip -dc ... | grep 'CREATE TABLE'`），备份已同步到规定位置
- [ ] Secret 静态加密/RBAC 已按集群规范配置；3306 未对外暴露

---

## 13. 一页纸速通版（外部 MySQL · 已有 Ingress）

```bash
# 0. 前提：DBA 已在 MySQL 8.0 建好空库 horus + 账号 horus（horus.* 全权）；镜像仓库可达
# 1. 构建推送（仓库根目录）
export REGISTRY=<registry> IMAGE="$REGISTRY/horus/horus:<tag>"
docker build --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 -t "$IMAGE" ./frontend && docker push "$IMAGE"
# 2. 命名空间
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
# 3. 配置（纯 env）
kubectl -n horus create secret generic horus-secret \
  --from-literal=DATABASE_URL='mysql://horus:<编码后密码>@<mysql-host>:3306/horus' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus create configmap horus-config \
  --from-literal=HORUS_DEMO_MODE=false \
  --from-literal=HORUS_INIT_OWNER_USERNAME=admin \
  --from-literal=HORUS_INIT_OWNER_NAME='团队负责人' \
  --from-literal=APP_URL='https://<正式域名>' \
  --from-literal=HORUS_NEW_WINDOW_DAYS=7 \
  --from-literal=HORUS_DB_CONNECTION_LIMIT=10 \
  --from-literal=TZ=Asia/Shanghai \
  --dry-run=client -o yaml | kubectl apply -f -
# 4. 部署（清单见 §6.1，把 $IMAGE 展开后 kubectl apply -f -）
# 5. 验收
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus --tail=200
kubectl -n horus port-forward service/horus 3000:3000   # 另开终端 curl http://127.0.0.1:3000/api/health
# 6. 挂 Ingress（§8.1）后浏览器打开 https://<正式域名>，用 admin 首次登录设密
```

---

## 附录 A：DBA 人工 SQL 初始化（仅当应用账号不给 DDL 权限时）

常规部署跳过本附录。前置：DBA 已建空库与账号（§3.1 第 1 步），且在**空库**上操作。

```bash
# 1) 先看两个脚本头部注释，按需改 02 里的 @owner_username / @owner_name
#    并与 ConfigMap 的 HORUS_INIT_OWNER_* 保持一致
# 2) 依次执行建表与初始数据（以能连库的客户端为例）
mysql -h <mysql-host> -u horus -p horus < deploy/mysql/01-schema.sql
mysql -h <mysql-host> -u horus -p horus < deploy/mysql/02-init-owner.sql
# 3) 之后照常按第 6 节部署；启动时的结构同步与 db:init 幂等，不会与手工结果冲突
```

校验（两个查询应各返回 1 行，负责人的 `password_not_set` 为 1）：

```sql
SHOW TABLES;  -- 7 张 horus_* 表
SELECT id, username, name, role, active, (password_hash IS NULL) AS password_not_set
FROM horus_members WHERE id = 'owner';
SELECT id, enabled, time FROM horus_notification_settings WHERE id = 'default';
```

注意：`01-schema.sql` 不可对非空库重跑；初始化后若 DBA 收紧为仅 DML，**每次升级前先确认该版本有无表结构变更**，有变更需 DBA 先执行对应 DDL 或临时恢复应用账号 DDL 权限。初始化「做了什么/没做什么」的完整说明见部署手册 [`deployment-guide.md`](./deployment-guide.md) 第 5 节。

## 附录 B：与「挂载 .env 文件版」的差异速查

| | 本文档（纯 env 版） | `kubernetes-deployment.md`（文件版） |
|---|---|---|
| 配置载体 | Secret（敏感）+ ConfigMap（非敏感），`envFrom` 注入 | Secret 的 `.env` 键，挂载为 `/etc/horus/.env` |
| 关键变量 | **不设** `HORUS_ENV_FILE` | **必须** `HORUS_ENV_FILE=/etc/horus/.env` |
| 改配置 | 改 Secret/ConfigMap → `rollout restart` | 改外部 `.env` → 重写 Secret → `rollout restart` |
| 清单文件 | 本文档 §6.1 heredoc 直接 apply | `deploy/k8s/horus.yaml`（含卷挂载） |
| 适用 | 习惯云原生 env 管理、配置项不多的场景 | 已有一份 `.env` 想原样搬上集群的场景 |

两版的应用行为（启动等库、同步 7 表、幂等初始化、心跳语义、1 副本限制）完全一致，不要在同一个 Deployment 里混用两种配置来源：容器级/ `envFrom` 显式变量在文件版里也会优先于 `.env` 文件，容易造成「文件改了却不生效」的困惑。
