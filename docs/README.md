# Horus 文档索引

按「你想做什么」找文档。产品简介与本地 Quick Start 在[仓库根 README](../README.MD)。

## 我想……

| 目标 | 看这份 |
|---|---|
| 了解产品定位、功能与本地跑起来 | [根 README](../README.MD)（Quick Start） |
| 查某个环境变量的含义、默认值、哪些路线要用 | [环境变量参考](environment-variables.md) |
| 用 Docker Compose 部署到内网单机（含备份恢复、HTTPS、升级、排查） | [Compose 部署手册](deployment-guide.md) |
| 没有 Compose / 已有 MySQL / 想手工掌控容器 | [纯 Docker 部署](docker-standalone-deployment.md) |
| 部署到 Kubernetes（挂 .env 文件 / 纯环境变量 两条配置路线） | [Kubernetes 部署](kubernetes-deployment.md) |
| 部署到 Vercel + Supabase PostgreSQL | [Vercel + Supabase 部署](vercel-supabase-deployment.md) |
| 上线前逐项签收验收 | [M5 UAT 清单](m5-uat-checklist.md) |
| 了解需求背景与产品边界 | [需求文档](specs/horus-design.md) |
| 了解工程方案、里程碑与执行状态 | [项目计划](specs/horus-project-plan.md) |
| 前端结构、脚本与环境变量细节 | [frontend/README](../frontend/README.md) |

## 部署路线怎么选

| 场景 | 推荐路线 | 入口 |
|---|---|---|
| 内网单机服务器，运维想省事 | Docker Compose | [deployment-guide.md](deployment-guide.md) |
| 内网已有 MySQL，或没有 Compose v2 | 纯 Docker 命令 | [docker-standalone-deployment.md](docker-standalone-deployment.md) |
| 有 K8s 集群，配置走云原生管理 | Kubernetes（两条配置路线二选一） | [kubernetes-deployment.md](kubernetes-deployment.md) |
| 无服务器 / 已用 Supabase | Vercel + Supabase | [vercel-supabase-deployment.md](vercel-supabase-deployment.md) |

不管哪条路线，共同约束都一样：生产 `HORUS_DEMO_MODE=false`、单实例（不要扩容/HPA）、数据库 3306 不对外、定时摘要在 Vercel 上不可用（无常驻进程）。

## 文档地图

```text
docs/
├── README.md                        ← 本索引
├── environment-variables.md         ← 环境变量权威参考（全路线统一）
├── deployment-guide.md              ← Docker Compose 生产部署手册（主推）
├── docker-standalone-deployment.md  ← 纯 Docker 命令部署
├── kubernetes-deployment.md         ← K8s 部署（挂 .env / 纯 env 二选一）
├── kubernetes-env-deployment.md     ← （已并入 kubernetes-deployment.md，跳转页）
├── vercel-supabase-deployment.md    ← Vercel + Supabase 部署
├── m5-uat-checklist.md              ← 上线签收清单
├── specs/                           ← 需求文档 + 项目计划（历史规划稿）
└── screenshots/                     ← README 截图
```

约定：各部署文档只放**本路线**的配置模板与步骤；变量的完整口径统一查 [environment-variables.md](environment-variables.md)，发现文档间不一致以它和 `.env.example` 为准。
