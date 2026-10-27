# Horus · Kubernetes 部署（配置路线二选一）

目标：一个 namespace、一份配置、一个 Deployment（1 副本）+ Service。MySQL 二选一：**外部 MySQL（生产推荐）**或集群内 MySQL（测试/自包含）。配置二选一：**路线一挂载 `.env` 文件**或**路线二纯环境变量（Secret + ConfigMap）**。

> 本文档由原「Secret 挂载 `.env` 文件版」与「纯环境变量版」两份 K8s 文档合并而成（原 `kubernetes-env-deployment.md` 已并入，现为跳转页）。环境变量的完整说明统一见 [`environment-variables.md`](environment-variables.md)，本文只讲 K8s 场景的用法。

## 目录

- [0. 先选配置路线](#0-先选配置路线二选一不要混用)
- [1. 部署架构与三条红线](#1-部署架构与三条红线)
- [2. 前置条件与检查](#2-前置条件与检查)
- [3. 构建并推送镜像](#3-构建并推送镜像)
- [4. 准备 MySQL（外部 / 集群内 二选一）](#4-准备-mysql外部--集群内-二选一)
- [5. 配置（路线一 / 路线二 二选一）](#5-配置路线一--路线二-二选一)
- [6. 部署](#6-部署)
- [7. 验证与对外暴露](#7-验证与对外暴露)
- [8. 首次登录与业务初始化](#8-首次登录与业务初始化)
- [9. 日常运维](#9-日常运维)
- [10. 故障排查速查](#10-故障排查速查)
- [11. 上线前检查清单](#11-上线前检查清单)
- [12. 一页纸速通版](#12-一页纸速通版)
- [附录 A：DBA 人工 SQL 初始化](#附录-adba-人工-sql-初始化仅当应用账号不给-ddl-权限时)
- [附录 B：数据库启动开关速查](#附录-b数据库启动开关速查)
- [附录 C：登录提示「会话未生效」（pending_items 修复）](#附录-c登录提示会话未生效pending_items-修复)

---

## 0. 先选配置路线（二选一，不要混用）

| | 路线一：挂载 `.env` 文件 | 路线二：纯环境变量 |
|---|---|---|
| 配置载体 | Secret 的 `.env` 键，挂载为文件，入口脚本读取 | Secret（敏感项）+ ConfigMap（非敏感项），`envFrom` 注入 |
| 关键变量 | **必须** `HORUS_ENV_FILE=/etc/horus/.env` | **绝对不要**设 `HORUS_ENV_FILE`（显式指定而文件缺失会启动失败） |
| 清单 | 仓库自带 [`deploy/k8s/horus.yaml`](../deploy/k8s/horus.yaml)（含卷挂载） | 本文 §6.2 的 heredoc 清单 |
| 改配置 | 改外部 `.env` → 重写 Secret → `rollout restart` | 改 ConfigMap/Secret → `rollout restart` |
| 适用 | 已有一份 `.env` 想原样搬上集群 | 习惯云原生 env 管理、配置项拆分敏感/非敏感 |

**不要在同一个 Deployment 里混用两种来源**：容器显式 `env` / `envFrom` 的值永远优先于 `.env` 文件（入口 `load-env.cjs` 的规则），混用会造成「文件改了却不生效」的困惑。两版的应用行为（等库、同步 8 表、幂等初始化、心跳语义、单副本限制）完全一致。

---

## 1. 部署架构与三条红线

```text
用户浏览器 ──HTTPS──► Ingress / 网关 ──► Service horus:3000 ──► Pod horus（Next.js，:3000，1 副本）
                                                                    │
                                                                    └──► MySQL 8.0（:3306，二选一，见第 4 节）
                                                                           ├─ 方式 A：外部 MySQL（DBA / 云 RDS，生产推荐）
                                                                           └─ 方式 B：集群内 MySQL（StatefulSet + PVC，测试/小规模）
Pod horus ──出站 443──► https://oapi.dingtalk.com（每日异常摘要推送，可选）
```

| 组件 | 说明 |
|---|---|
| `horus` Deployment | 1 副本，`Recreate`。启动时自动：等 MySQL → 同步 9 张表（或校验已建好的表）→ 幂等创建初始负责人 → 启动 Next.js |
| `horus` Service | ClusterIP `3000`，只做集群内入口，对外靠 Ingress/网关 |
| Secret | 路线一：`horus-env`（`.env` 文件）；路线二：`horus-secret`（`DATABASE_URL`）+ `horus-config`（非敏感项）；方式 B 另有 `horus-mysql-secret` |
| MySQL 8.0 | 业务数据唯一持久化位置。Pod 本地不存业务数据，删 Pod 不丢数据，删库/删 PVC 才丢 |

**三条红线**：

1. **只跑 1 个副本，禁止扩容、禁止 HPA。** 定时摘要调度和启动建表都假设单实例；清单写死 `replicas: 1` + `Recreate`，升级时秒级到一分钟中断是预期行为。
2. **`HORUS_DEMO_MODE` 生产必须 `false`**；不要设置 `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW`。
3. **不要把 3306 暴露到公网/办公网。** 外部 MySQL 靠白名单只放行 Pod 出口；集群内 MySQL 不建对外 Service。

---

## 2. 前置条件与检查

| 项 | 要求 | 检查命令 |
|---|---|---|
| 集群 | k8s 1.25+，能建 namespace/Secret/ConfigMap/Deployment/Service（方式 B 还需 StatefulSet/PVC） | `kubectl version` |
| kubectl context | 指向**目标集群** | `kubectl config current-context && kubectl get nodes -o wide` |
| 镜像仓库 | 节点可拉取；私有仓准备拉取凭证 | 见 §3 末尾 pull-test |
| 构建机 | Docker/Buildx，架构与节点一致（不一致用 `--platform`） | `docker buildx version` |
| MySQL（方式 A） | **8.0**（用了 `utf8mb4_0900_ai_ci`，5.7 不行），Pod 网络可达 3306 | §4.1 第 3 步连通性测试 |
| 域名与证书（对外） | 正式域名 + TLS（Ingress + cert-manager 或现成网关） | `kubectl get ingressclass` |
| 出站网络（可选） | Pod 能访问 `https://oapi.dingtalk.com:443` | §9.3 联调 |
| StorageClass（方式 B） | 有默认 StorageClass 或显式指定 | `kubectl get storageclass` |

占位符约定：`<registry>` 镜像仓库、`<tag>` 每版本一个新 tag（**不要复用 `latest`**）、`<mysql-host>` Pod 可达的 MySQL 地址、`<正式域名>` 用户访问域名。

---

## 3. 构建并推送镜像

构建上下文是 `./frontend`，在仓库根目录执行：

```bash
export REGISTRY=<registry>
export IMAGE="$REGISTRY/horus/horus:<tag>"    # 例如 harbor.example.com/horus/horus:20261020-1

docker login "$REGISTRY"
docker buildx build --platform linux/amd64 \
  -t "$IMAGE" --push ./frontend
```

- 「本周新建」使用自然周（周一 00:00 Asia/Shanghai），不再有构建期窗口变量；其余配置全是运行时变量，不用重构建。
- 每个版本用独立 tag，别复用 `latest`（节点会拿旧缓存）。
- 推完验证节点能拉取，再往下走：

```bash
kubectl run pull-test --rm -it --restart=Never --image="$IMAGE" --image-pull-policy=Always -- echo ok
# 输出 ok 并自动删除 Pod 即为成功；报 ImagePullBackOff 先解决仓库权限/网络
```

---

## 4. 准备 MySQL（外部 / 集群内 二选一）

### 4.1 方式 A：外部 MySQL（生产推荐）

**第 1 步：建库、建账号、授权**（DBA 或 root 执行；字符集必须 `utf8mb4`；来源按策略收紧，能不用 `%` 就不用；密码建议只用字母数字下划线）：

```sql
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'horus'@'<允许访问的来源>' IDENTIFIED BY '<强密码>';
GRANT ALL PRIVILEGES ON horus.* TO 'horus'@'<允许访问的来源>';
FLUSH PRIVILEGES;
```

- `GRANT ALL` 含建表/改表权限，**常规部署必需**（启动要同步表结构）；只建**空库**，不要导入任何 SQL。
- 走附录 A 的人工初始化路线时，初始化后可收紧为仅 DML，但每次升级若有表结构变更需 DBA 先执行 DDL。

**第 2 步：建 namespace**（方式 B 在 §4.2 已建，跳过）：

```bash
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
```

**第 3 步：测连通 + 账号可用**（一次性客户端 Pod，密码交互输入不落历史；防火墙放行的是节点/Pod 出口地址，NAT 场景不是 Pod IP）：

```bash
kubectl -n horus run mysql-client --rm -it --restart=Never --image=mysql:8.0 -- \
  mysql -h <mysql-host> -P 3306 -u horus -p -e "SELECT VERSION(); SHOW DATABASES LIKE 'horus';"
```

`Can't connect` = 网络未放行；`Access denied` = 来源主机不匹配或密码错；`Unknown database` = 建库没在这台实例上。

**第 4 步（可选，路线一前置）：用仓库脚本一次性建表 + 建负责人**——想跳过容器内 Drizzle（DBA 只给 DML、`drizzle-kit push` 卡住、MySQL 5.7）时执行；常规部署可跳过，容器启动会自动建：

```bash
DATABASE_URL='mysql://horus:<URL编码后的密码>@<mysql-host>:3306/horus' ./scripts/init-sql.sh
# 密码含 @ : / # 等先做百分号编码（@ → %40）；脚本对已有 horus_* 表的库会拒绝，确认无误加 --force
```

### 4.2 方式 B：集群内 MySQL（测试/小规模自包含）

数据库运维（备份、磁盘、高可用）要自己扛，重要生产数据用方式 A。

**第 1 步：namespace + MySQL 密码 Secret**（两套密码：root 运维用、应用连库用，都只用字母数字下划线）：

```bash
kubectl create namespace horus
kubectl -n horus create secret generic horus-mysql-secret \
  --from-literal=MYSQL_ROOT_PASSWORD='<root强密码>' \
  --from-literal=MYSQL_PASSWORD='<应用强密码>'
```

**第 2 步：部署 MySQL（StatefulSet + PVC + Service），整段粘贴执行**：

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

要点：官方镜像首次启动按 `MYSQL_*` **自动建库建账号**，无需任何 SQL；数据在 PVC（`data-horus-mysql-0`），删 Pod/StatefulSet 不丢，**删 PVC = 删全部数据**；Service 仅集群内可达。改 Secret 密码**不会**同步库内已有账号（镜像只在空数据目录初始化），改密码进库 `ALTER USER` 后两边对齐。

**第 3 步：等就绪并验收**：

```bash
kubectl -n horus rollout status statefulset/horus-mysql --timeout=300s
kubectl -n horus exec -it statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SHOW DATABASES;"'   # 能查到 horus 库即可
```

### 4.3 两种方式怎么选

| | 方式 A 外部 MySQL | 方式 B 集群内 MySQL |
|---|---|---|
| 数据可靠性 | DBA/RDS 负责（主从、备份、磁盘） | 自己负责，单副本 + 单 PVC，无高可用 |
| 运维成本 | 低，Horus 侧只管一个连接串 | 高，升级/备份/磁盘告警自己管 |
| 适用 | **生产首选** | 测试、演示、小团队自包含 |
| `DATABASE_URL` 主机 | `<mysql-host>` | `horus-mysql` |

---

## 5. 配置（路线一 / 路线二 二选一）

> 变量的完整说明、默认值、哪些变量属于 MySQL 容器不要塞给应用——统一见 [`environment-variables.md`](environment-variables.md)。K8s 场景只需要 `DATABASE_URL` + 少量运行时变量；**不需要** Compose 专用的 `MYSQL_*`（方式 B 除外，它们在 StatefulSet 里）和 `HORUS_PORT`。

### 5.1 路线一：挂载 `.env` 文件（Secret `horus-env`）

**完整 `.env` 模板**（按需增删；只放应用需要的，注释掉的项有默认值）：

```bash
umask 077 && mkdir -p /secure/horus
cat > /secure/horus/.env <<'EOF'
# ── 必填 ────────────────────────────────────────────────
# 主机必须是 Pod 可达地址，不能写 localhost/127.0.0.1（那是容器自己）
DATABASE_URL=mysql://horus:URL_ENCODED_PASSWORD@mysql.example.internal:3306/horus

# ── 生产固定值 ──────────────────────────────────────────
HORUS_DEMO_MODE=false            # 生产红线，禁止 true
HORUS_DB_PUSH=false              # 第 4.1 步已用 init-sql.sh 建表时设；没建过则删掉本行，容器自动建
HORUS_DB_INIT=false              # 已跑过 02-init-owner.sql 时设；想少一步手工就删掉本行，容器幂等补建

# ── 按需修改 ────────────────────────────────────────────
APP_URL=https://horus.example.com            # 用户实际访问地址，钉钉摘要链接兜底
HORUS_DB_CONNECTION_LIMIT=10                 # 连接池，默认 10
# HORUS_INIT_OWNER_USERNAME=admin            # 仅首次建负责人有效
# HORUS_INIT_OWNER_NAME=空间管理员
# HORUS_DB_WAIT_TIMEOUT=90                   # 等 MySQL 秒数上限
# HORUS_DB_STEP_TIMEOUT=180                  # 单步墙钟上限，防无限卡住
EOF
```

建 Secret（键名必须是 `.env`，清单按这个键挂载）：

```bash
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
```

- 真实 `.env` 放仓库外，别提交 Git；Secret 只是 Base64 不是加密，生产集群开静态加密并收紧 RBAC。
- `HORUS_DB_PUSH=false` 的前提是第 4.1 步已建表；此时启动只校验 9 张表，缺表照样拒绝启动。
- 改配置 = 编辑 `/secure/horus/.env` → 重写上面的 Secret → `rollout restart`（§9.1）。

### 5.2 路线二：纯环境变量（Secret + ConfigMap）

先拼好连接串（密码编码规则见 [`environment-variables.md`](environment-variables.md#database_url-密码编码)）：

```bash
export DATABASE_URL='mysql://horus:<编码后密码>@<mysql-host>:3306/horus'
# 方式 B 示例：export DATABASE_URL='mysql://horus:<应用密码>@horus-mysql:3306/horus'
```

敏感项进 Secret，非敏感项进 ConfigMap（`--dry-run | apply` 写法保证幂等更新）：

```bash
kubectl -n horus create secret generic horus-secret \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n horus create configmap horus-config \
  --from-literal=HORUS_DEMO_MODE=false \
  --from-literal=HORUS_INIT_OWNER_USERNAME=admin \
  --from-literal=HORUS_INIT_OWNER_NAME='空间管理员' \
  --from-literal=APP_URL='https://<正式域名>' \
  --from-literal=HORUS_DB_CONNECTION_LIMIT=10 \
  --from-literal=TZ=Asia/Shanghai \
  --dry-run=client -o yaml | kubectl apply -f -
unset DATABASE_URL   # 本地 shell 里的明文连接串用完清掉
```

验收（**不要**把 Secret 内容明文打印到终端/截图/工单，只看键名）：

```bash
kubectl -n horus get secret horus-secret -o jsonpath='{.data}' | python3 -c "import sys,json; print(list(json.load(sys.stdin).keys()))"
# 预期只输出 ['DATABASE_URL']
kubectl -n horus get configmap horus-config -o yaml   # ConfigMap 非敏感，可看全文核对
```

私有镜像仓库的拉取凭证（需要时）：

```bash
kubectl -n horus create secret docker-registry registry-pull \
  --docker-server=<registry> --docker-username='<用户名>' --docker-password='<密码>'
# Pod 报 ImagePullBackOff 且事件提示 pull secret 时，把下面两行加进 §6 部署清单的 Pod spec：
#       imagePullSecrets:
#         - name: registry-pull
```

### 5.3 两条路线共同注意

- 不设 `HORUS_ENV_FILE`（路线二）/ 必须设（路线一，清单里已带）。
- 不设 `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW`。
- 同一个键不要在 Secret 和 ConfigMap 重复定义（`envFrom` 靠后的 `secretRef` 优先，口径容易乱）。

---

## 6. 部署

### 6.1 路线一：用仓库自带清单

把 [`deploy/k8s/horus.yaml`](../deploy/k8s/horus.yaml) 里的 `image: horus:local` 改成 §3 推送的地址（清单已含 `HORUS_ENV_FILE=/etc/horus/.env` 与 Secret 卷挂载），然后：

```bash
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=180s
kubectl -n horus logs deployment/horus --tail=100
```

### 6.2 路线二：heredoc 清单（Deployment + Service）

`$IMAGE` 用 §3 的地址（heredoc 不带引号以便展开；清单里没有其他 `$` 符号）：

```bash
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

### 6.3 清单逐段说明（两条路线通用）

| 片段 | 为什么这么写 |
|---|---|
| `replicas: 1` + `Recreate` | 单实例红线。Recreate 保证任何时刻只有一个进程在跑调度器和建表逻辑；**不要改 RollingUpdate、不要加 HPA** |
| `image` + 独立 tag + `IfNotPresent` | 同 tag 不会重复拉取，更不要复用 tag 发新版；私有仓按 §5.2 加 `imagePullSecrets` |
| `runAsNonRoot / 1001` | 镜像内应用用户就是 uid 1001（`nextjs`），显式声明对齐 |
| 探针全用 `GET /api/health` | 该接口只证明 HTTP 进程活着，**不查数据库**。startupProbe 给 `60 × 5s = 300s` 上限，覆盖「等库 90 秒 + 建表 + 首次启动」；建表没完成前 HTTP 不起，startup 不通过是正常等待，别急着杀 Pod |
| 资源 `100m/256Mi → 内存 1Gi` | 百级需求规模足够；CPU 不设 limit（避免节流拖慢启动），内存打满会 OOMKill |
| Service `ClusterIP 3000` | 只做集群内寻址，对外见 §7，不要裸改成公网 LoadBalancer |

### 6.4 启动日志对照与流程

```bash
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus --tail=200
```

正常日志依次出现（顺序即启动流程）：

```text
Database bootstrap: push=true init=true wait_timeout=90s step_timeout=180s
Waiting for MySQL...
MySQL is ready
Synchronizing MySQL schema...
MySQL schema ready (9 tables)          ← 建表完成的唯一凭据，必须出现
Created initial owner account 'admin'. Set its password on first login.
Horus production data initialization complete.
Starting Horus...
```

跳过 Drizzle（`HORUS_DB_PUSH=false` / `HORUS_DB_INIT=false`）时中间换成 `Skipping schema synchronization...` / `Skipping owner initialization...`，但 **`MySQL schema ready (9 tables)` 仍必须出现**。第二次以后启动倒数第二行变为 `Keeping existing owner account 'admin' (idempotent initialization)`，这是幂等生效不是报错。

启动流程（容器入口依次做，出问题对照卡在哪一步）：

1. **加载配置**：路线一先读挂载的 `.env`，容器显式 env 优先；路线二直接用环境变量。
2. **校验 `DATABASE_URL`**：为空立即退出。
3. **等 MySQL**：每 2 秒试连一次，最长 `HORUS_DB_WAIT_TIMEOUT`（90 秒），超时退出并 CrashLoopBackOff 重试——卡这里查网络/地址/账号，别查应用。
4. **同步并校验表结构**：`drizzle-kit push` + 查 `information_schema` 确认 9 张表齐全，缺表即退出；带 `HORUS_DB_STEP_TIMEOUT`（180 秒）墙钟保护。`HORUS_DB_PUSH=false` 时跳过 push 只留校验。
5. **幂等初始化**：无负责人时创建（密码为空待首登设置），确保通知设置默认行存在；**不灌任何演示数据**。

readiness 通过 ≈ 初始化全部完成，可放心接流量。数据库侧复核（可选）：

```bash
# 方式 A：§4.1 的客户端 Pod 里执行 SHOW TABLES; SELECT id,username,role FROM horus_members;
kubectl -n horus exec -it statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" horus -e "SHOW TABLES; SELECT id,username,role FROM horus_members;"'   # 方式 B
# 预期：7 张 horus_* 表；horus_members 里有 1 行 id=owner 的负责人
```

---

## 7. 验证与对外暴露

### 7.1 先集群内验证（别急着对外）

```bash
kubectl -n horus port-forward service/horus 3000:3000   # 保持运行，另开终端
curl -fsS http://127.0.0.1:3000/api/health              # 预期 {"ok":true}
```

浏览器开 `http://127.0.0.1:3000` 应跳登录页且**没有**演示账号入口（有就是 `HORUS_DEMO_MODE` 被开了）。⚠️ `/api/health` 返回 200 **只代表进程活着，不代表数据库和业务正常**（心跳有意不查库）；真实验收是能登录、能打开工作台。

### 7.2 对外暴露（任选其一）

**Ingress（有控制器时）**——域名、`ingressClassName`、证书按实际改：

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
  ingressClassName: nginx
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

**现有网关/反向代理（没有 Ingress 时）**——把 `<正式域名>` 反代到 `horus.horus.svc.cluster.local:3000`（网关在集群外时用 NodePort/云 LB 引出），转发头必须带齐，否则登录 Cookie 的 Secure 判断和跳转链接会出错：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

**临时内网直连（仅调试）**：`kubectl -n horus patch service horus -p '{"spec":{"type":"NodePort"}}'`，查端口后浏览器开 `http://<节点IP>:<端口>`；明文 HTTP 且绕过统一入口，调试完改回 ClusterIP。

对外地址定稿后，把 `APP_URL` 对齐成 `https://<正式域名>` 并按 §9.1 重启，钉钉摘要链接才正确。

---

## 8. 首次登录与业务初始化

1. 浏览器打开正式地址，未登录跳 `/login`，输入初始负责人账号（默认 `admin`，即 `HORUS_INIT_OWNER_USERNAME`），首次登录设置 8–72 位密码（bcrypt 存库，会话只存 SHA-256 摘要）。
2. 负责人在页面完成（**不碰数据库**）：建团队 → 配阶段模板 → 预建成员账号并绑定团队 → PM 登录。逐项签收见 [M5 清单](m5-uat-checklist.md)。
3. 验收锚点：换一台同事电脑和一部手机打开正式地址，能到登录页、能登录、手机无横向滚动。

负责人密码没有自助找回：由另一位负责人在「成员管理」重置；唯一负责人密码丢失属运维事故，需 DBA 应急处理 `horus_members` 中 `id='owner'` 行的 `password_hash`（置 NULL 回到首次设密流程），操作前先备份。

---

## 9. 日常运维

### 9.1 改配置（改完必须重启，进程只在启动时读配置）

```bash
# 路线一：编辑 /secure/horus/.env 后重写 Secret（§5.1 的 create secret 命令）再重启
# 路线二：改 ConfigMap（非敏感项）或 Secret（敏感项）再重启
kubectl -n horus rollout restart deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=180s
```

- `create configmap/secret ...` 是**整表替换**口径，漏写的键会被删掉；只改一两个键用 `kubectl -n horus edit configmap horus-config` 或 `patch`，然后同样 `rollout restart`。
- 只更新了 Secret/ConfigMap 不重启，运行中的进程**不会感知**。
- 临时试一个变量：`kubectl -n horus set env deployment/horus APP_URL=https://example.com`（写进容器 `env` 并触发重启；容器 `env` 优先于 `envFrom`/文件，试完用 `APP_URL-` 删除覆盖项）。路线一的 Deployment 若留有容器级覆盖，会盖掉 `.env` 文件里的同名值——排查「文件改了不生效」先查这里。
- 改 `HORUS_INIT_OWNER_*` 对已有负责人无效（幂等初始化不覆盖），改账号/姓名走页面成员管理。

### 9.2 升级与回滚

```bash
# 0) 先备份数据库（§9.4），尤其版本带表结构变更时
kubectl -n horus set image deployment/horus horus="<registry>/horus/horus:<新tag>"
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus logs deployment/horus --tail=200          # 确认启动日志正常

# 回滚：
kubectl -n horus rollout history deployment/horus
kubectl -n horus rollout undo deployment/horus
```

- `HORUS_DB_PUSH=false`（附录 A 路线）时**没有任何自动同步**：发新版前确认该版本 `frontend/src/db/schema.ts` 有无变化，有则先备份、DBA 执行 DDL；或在能连库的机器上 `cd frontend && DATABASE_URL=... npm run db:push`（幂等）。
- 升级到含「需求统计」的版本时，除 `db:push` 外还要确保旧库执行了 `deploy/mysql/04-stats-upgrade.sql`（PostgreSQL 为 `deploy/postgres/03-stats-upgrade.sql`）；随后回填历史事件：
  ```bash
  kubectl -n horus exec deploy/horus -- node --experimental-strip-types /opt/horus-migrate/src/db/backfill-events-cli.ts
  ```
  也可在能连库的机器上 `cd frontend && DATABASE_URL=... npm run db:backfill`；首次打开「需求统计」同样会自动回填，命令可重复执行。`HORUS_DB_PUSH=false` 时启动会校验 9 张表，缺 `horus_requirement_events` 或 `horus_requirement_pool` 会直接失败。
- 升级到含「需求池」的版本时，旧库需要执行 `deploy/mysql/05-requirement-pool.sql`（PostgreSQL 为 `deploy/postgres/04-requirement-pool.sql`）创建 `horus_requirement_pool`；需求池为新功能，不需要回填数据。
- 升级改过表结构又只回滚镜像导致不兼容时，连升级前备份一起恢复（§9.5），不要只回滚一半。

### 9.3 钉钉摘要联调（可选）

1. Pod 出站能到 `https://oapi.dingtalk.com:443`（防火墙放行）。
2. 负责人在页面「通知设置」填机器人 Webhook（及可选加签密钥）、发送时间；页面里填的链接优先于 `APP_URL`。
3. 先「发送测试」验证实收，再等每日定时（北京时间）触发；记录在页面推送日志与 `horus_notification_logs`。失败项次日自动合并重发。

### 9.4 备份

> 备份文件必须再拷到公司规定的备份位置（对象存储/备份机），只留在集群里不算完成备份。建议每日一次、保留 7–14 天。

```bash
# 方式 B（集群内 MySQL）：
mkdir -p backups
BACKUP="backups/horus-$(date +%Y%m%d-%H%M%S).sql.gz"
kubectl -n horus exec statefulset/horus-mysql -- \
  sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --databases "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP"
gzip -dc "$BACKUP" | grep -q 'CREATE TABLE' && echo "备份可读: $BACKUP"
```

方式 A（外部 MySQL）：在能连库的机器上用 DBA 给的账号执行等价 `mysqldump`，或走 RDS/DBA 自带备份体系；确认备份含 7 张 `horus_*` 表并定期演练恢复。定时备份可包成 CronJob（镜像 `mysql:8.0`，挂 Secret 连库，产物写对象存储/PVC）。

### 9.5 恢复（危险操作，先留底再动手）

```bash
# 1) 先按 §9.4 给当前库再备一份（命名 pre-restore-*）
# 2) 停应用（Recreate 单副本，直接缩到 0）
kubectl -n horus scale deployment/horus --replicas=0
# 3) 导入（方式 B 为例；方式 A 在可连库机器上对目标库导入）
gzip -dc backups/<要恢复的文件>.sql.gz | kubectl -n horus exec -i statefulset/horus-mysql -- \
  sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
# 4) 拉起并验收
kubectl -n horus scale deployment/horus --replicas=1
kubectl -n horus rollout status deployment/horus --timeout=360s
```

恢复演练只在隔离/测试库做。恢复后账号/密码以备份时点为准；备份早于首次设密时负责人回到「首次登录设密」状态。

### 9.6 常用巡检

```bash
kubectl -n horus get pods -o wide
kubectl -n horus logs deployment/horus --tail=200             # 当前 Pod
kubectl -n horus logs deployment/horus --previous --tail=200  # 上一个崩溃 Pod，排障必看
kubectl -n horus get events --sort-by=.metadata.creationTimestamp
kubectl -n horus top pod                                       # 需 metrics-server，看是否逼近 1Gi limit
```

---

## 10. 故障排查速查

先收集现场：`kubectl -n horus get pods -o wide`、`kubectl -n horus logs deployment/horus --tail=200`（崩溃加 `--previous`）、`kubectl -n horus get events`。不要一上来删 PVC。

| 现象 | 大概率原因 | 怎么办 |
|---|---|---|
| `ImagePullBackOff` / `ErrImagePull` | tag/地址错、仓库未授权、架构不一致、缺 pull secret | `describe pod` 看 Events；核对 §3 `$IMAGE`；pull-test 复验；私有仓加 `imagePullSecrets` |
| `CrashLoopBackOff` + `DATABASE_URL is required` | 路线二：Secret 没建/键名错/`envFrom` 没引用；路线一：`HORUS_ENV_FILE` 与挂载路径不一致，或 Secret 里没有 `.env` 键 | 确认 Secret 存在、键名正确（路线一必须是 `.env`）、清单引用无误；进 Pod `env \| grep -c DATABASE_URL` 只看有没有 |
| 日志第 1 行 `push=true` 而你写了 `false` | Secret 没更新成功、键名/变量名写错，或容器级 `env` 覆盖了文件值 | 核对 Secret 内容与清单 `env` 段；重写 Secret 再 `rollout restart` |
| 卡 `Waiting for MySQL...` 后退出（约 90 秒一轮） | Pod 到 MySQL 不通：地址错/写了 localhost、防火墙白名单、库没建 | 按 §4.1 第 3 步用客户端 Pod 复测；核对 `DATABASE_URL` 主机段；方式 B 先确认 MySQL StatefulSet Ready |
| 卡 `Pulling schema from database...` 不动 | `drizzle-kit push` 连库内省没有自身超时：网络半通、`information_schema` 极慢、元数据锁 | 改走 §4.1 第 4 步 + `HORUS_DB_PUSH=false` 绕过；或调 `HORUS_DB_STEP_TIMEOUT` 让它主动失败 |
| MySQL 报 `Access denied` | 密码错、特殊字符没编码、账号来源主机不匹配 | 按 [变量参考](environment-variables.md#database_url-密码编码) 重新编码并更新配置；DBA 核对授权 |
| MySQL 报 `Unknown database 'horus'` | 库没建或连错实例 | 回 §4 确认建库在这台实例；核对 URL 库名 |
| `Schema sync did not create: <表名>` | 表没建全（`HORUS_DB_PUSH=false` 时）或账号缺 DDL | 重跑 `./scripts/init-sql.sh`（必要时 `--force`）；或临时 `HORUS_DB_PUSH=true` 让容器建 |
| startupProbe 一直不通过 | 启动超 300 秒：MySQL 慢、建表卡、大库同步久 | 看日志卡在 §6.4 哪一步；确认 MySQL 健康；可调大 `failureThreshold`，别删探针 |
| `OOMKilled` | 内存超 1Gi limit | `describe pod` 看 Last State；调大 `limits.memory` 并观察 `top` |
| 改了配置但不生效 | 没重启；或改的是本地文件不是集群对象；或容器级 `env` 覆盖了 `envFrom`/文件 | §9.1 `rollout restart`；`set env deployment/horus --list` 查覆盖项，多余用 `变量名-` 删除 |
| `/api/health` 200 但业务打不开 | 心跳不查库，进程活着但数据库链路坏了 | 看应用日志数据库报错；以「能登录并打开工作台」为真实验收 |
| 登录页出现演示账号入口 | `HORUS_DEMO_MODE=true` 被误开 | 改回 `false` 重启；已灌演示数据且未投产可评估清库重来 |
| 登录提示「会话未生效」且日志有 `null (reading 'length')` | 旧数据 `pending_items` 为空值（见附录 C） | 在库上执行 `deploy/mysql/03-repair-notification-settings.sql` |
| 改负责人账号配置登录还是旧账号 | 初始化幂等，不覆盖已有负责人 | 预期行为；走页面成员管理 |
| 「本周新建」与预期不符 | 时区或数据创建时间问题 | 业务口径固定为 Asia/Shanghai 自然周（周一 00:00），页面会显示窗口起止日期 |
| 经 Ingress 登录态丢失/跳转异常 | 转发头不全或 `APP_URL` 与实际域名协议不一致 | §7.2 补齐转发头；`APP_URL` 对齐后重启 |
| 方式 B：MySQL Pod `Pending`、PVC 不绑定 | 无默认 StorageClass 或容量/可用区不满足 | 显式写 `storageClassName`；`describe pvc` 看原因 |
| 方式 B：改 MySQL Secret 密码后连不上 | 改 Secret 不同步库内已有账号 | 进库 `ALTER USER` 对齐，或 Secret 改回库内现值 |

---

## 11. 上线前检查清单

- [ ] `kubectl config current-context` 确认目标集群
- [ ] 镜像为独立 tag（非 latest），pull-test 通过
- [ ] MySQL 8.0、`utf8mb4`；方式 A 建空库+账号+授权且客户端 Pod 连通通过；方式 B StatefulSet Ready、PVC Bound
- [ ] 常规部署**没有**手工跑 `deploy/mysql/01-schema.sql`；走人工路线的已跑 `./scripts/init-sql.sh` 并设好开关（附录 A/B）
- [ ] 配置只含本路线允许的键：路线一 Secret 键为 `.env` 且含 `HORUS_ENV_FILE` 所指文件；路线二 Secret 只有 `DATABASE_URL`，且**没有**设 `HORUS_ENV_FILE`
- [ ] `HORUS_DEMO_MODE=false`、`APP_URL` 为正式地址；没设 `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW`
- [ ] `replicas: 1` + `Recreate`，无 HPA；探针、资源与 §6 一致
- [ ] 日志出现 `MySQL schema ready (9 tables)`；库里 9 张表、1 个 owner 可查
- [ ] 真人登录成功并打开工作台（不能只看心跳）；手机端正常
- [ ] Ingress/网关 HTTPS 可用，转发头齐全，`APP_URL` 已对齐
- [ ] 已完成一次备份并验证可读，备份已同步到规定位置
- [ ] Secret 静态加密/RBAC 按集群规范配置；3306 未对外暴露

---

## 12. 一页纸速通版

### 路线一（挂 .env · 外部 MySQL 已由 init-sql.sh 建表）

```bash
# 0. 前提：DBA 建好空库+账号；已跑 DATABASE_URL=... ./scripts/init-sql.sh；镜像仓库可达
# 1. 构建推送（§3）
export IMAGE=<registry>/horus/horus:<tag>
docker buildx build --platform linux/amd64 -t "$IMAGE" --push ./frontend
# 2. 写 /secure/horus/.env（模板见 §5.1），建 Secret
kubectl -n horus create secret generic horus-env --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
# 3. 改 deploy/k8s/horus.yaml 的 image 后部署
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=180s
kubectl -n horus logs deployment/horus --tail=100        # 期望 MySQL schema ready (9 tables) → Starting Horus...
# 4. 验收：port-forward + curl /api/health；挂 Ingress（§7.2）后用 admin 首登设密
```

### 路线二（纯 env · 外部 MySQL · 已有 Ingress）

```bash
# 0. 前提：DBA 已建空库 horus + 账号 horus（horus.* 全权）；镜像仓库可达
# 1. 构建推送（§3）
export REGISTRY=<registry> IMAGE="$REGISTRY/horus/horus:<tag>"
docker build -t "$IMAGE" ./frontend && docker push "$IMAGE"
# 2. 命名空间
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
# 3. 配置（§5.2）
kubectl -n horus create secret generic horus-secret \
  --from-literal=DATABASE_URL='mysql://horus:<编码后密码>@<mysql-host>:3306/horus' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus create configmap horus-config \
  --from-literal=HORUS_DEMO_MODE=false \
  --from-literal=HORUS_INIT_OWNER_USERNAME=admin \
  --from-literal=HORUS_INIT_OWNER_NAME='空间管理员' \
  --from-literal=APP_URL='https://<正式域名>' \
  --from-literal=HORUS_DB_CONNECTION_LIMIT=10 \
  --from-literal=TZ=Asia/Shanghai \
  --dry-run=client -o yaml | kubectl apply -f -
# 4. 部署（§6.2 heredoc 清单，展开 $IMAGE）
# 5. 验收：rollout status + logs + port-forward curl /api/health
# 6. 挂 Ingress（§7.2）后浏览器打开 https://<正式域名>，用 admin 首登设密
```

---

## 附录 A：DBA 人工 SQL 初始化（仅当应用账号不给 DDL 权限时）

常规部署跳过本附录。前置：DBA 已建空库与账号（§4.1 第 1 步），且在**空库**上操作。

```bash
# 1) 按需改 deploy/mysql/02-init-owner.sql 头部的 @owner_username / @owner_name，
#    并与 HORUS_INIT_OWNER_* 保持一致
# 2) 依次建表与初始数据（推荐入口，带结果校验；对已有 horus_* 表的库会拒绝，确认无误加 --force）
DATABASE_URL='mysql://horus:<密码>@<mysql-host>:3306/horus' ./scripts/init-sql.sh
#    等价手工命令（分别重定向进 mysql）：
#    mysql -h <mysql-host> -u horus -p horus < deploy/mysql/01-schema.sql
#    mysql -h <mysql-host> -u horus -p horus < deploy/mysql/02-init-owner.sql
# 3) 在配置里加 HORUS_DB_PUSH=false（+ 已跑 02 时 HORUS_DB_INIT=false），再按 §6 部署
```

校验（`SHOW TABLES` 应有 7 张 `horus_*` 表；负责人 `password_not_set` 为 1）：

```sql
SELECT id, username, name, role, active, (password_hash IS NULL) AS password_not_set
FROM horus_members WHERE id = 'owner';
SELECT id, enabled, time FROM horus_notification_settings WHERE id = 'default';
```

注意：`01-schema.sql` 不可对非空库重跑；初始化后若收紧为仅 DML，**每次升级前先确认有无表结构变更**（§9.2）。初始化「做了什么/没做什么」的完整说明见[部署手册](deployment-guide.md)第 5 节。

## 附录 B：数据库启动开关速查

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HORUS_DB_PUSH` | `true` | `false` = 启动不跑 `drizzle-kit push`，仅校验 9 张表存在（缺表仍拒绝启动） |
| `HORUS_DB_INIT` | `true` | `false` = 不跑负责人/通知设置的幂等初始化（已用 `02-init-owner.sql` 建好时） |
| `HORUS_DB_WAIT_TIMEOUT` | `90` | 等 MySQL 可查询的秒数上限 |
| `HORUS_DB_STEP_TIMEOUT` | `180` | 单步墙钟上限（`0` 关闭），让「连不上」变成明确失败 |

三种常见组合：

| 场景 | 组合 |
| --- | --- |
| 全交给容器（默认） | 两个开关都不写；应用账号需建表/改表权限 |
| 手工建表，账号只给 DML（附录 A 路线） | `HORUS_DB_PUSH=false` + `HORUS_DB_INIT=false` |
| 手工建表，负责人仍由容器建 | `HORUS_DB_PUSH=false`（`02-init-owner.sql` 不要跑） |

## 附录 C：登录提示「会话未生效」（pending_items 修复）

登录后提示「会话未生效」且日志出现 `null (reading 'length')`，不一定是 Cookie 问题：旧版登录页在 `/api/workspace` 返回任意错误时都这样提示。若 `/api/auth` 成功而 `/api/workspace` 返回 500，优先检查通知设置：

```sql
SELECT id, pending_items, JSON_TYPE(pending_items) AS pending_items_type
FROM horus_notification_settings WHERE id = 'default';
```

旧版手工初始化脚本没有显式写入 `pending_items`（ORM 的 `$defaultFn` 不是 MySQL 表默认值），可能留下 SQL NULL / JSON null，使旧版工作台的 `pendingItems.length` 抛错，钉钉摘要也可能受影响。在 **Horus 实际连接的数据库**中执行 [`deploy/mysql/03-repair-notification-settings.sql`](../deploy/mysql/03-repair-notification-settings.sql)（可重复执行：补齐缺失默认行、把空值改成 `[]`，不覆盖密码、Webhook 与已有非空待重试摘要），执行后重新登录即可，无需删 PVC/重建库/重置密码。若查询结果本来就是数组，继续查完整服务端堆栈，不要把所有 `null.length` 都视为此问题。

含此修复的镜像已兼容空值，初始化 SQL 也显式写入空数组；新版登录页仅在工作台返回 401 时提示会话失效。

---

## 其他部署路线

Compose / 内网单机与备份回滚见 [`deployment-guide.md`](deployment-guide.md)；纯 Docker 命令见 [`docker-standalone-deployment.md`](docker-standalone-deployment.md)；Vercel + Supabase 见 [`vercel-supabase-deployment.md`](vercel-supabase-deployment.md)。
