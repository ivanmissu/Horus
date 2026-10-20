# ⚠️ 本文档已合并

本文档（纯环境变量版）已与「Secret 挂载 `.env` 文件版」合并为一份 **[Kubernetes 部署文档](kubernetes-deployment.md)**，两条配置路线在合并文档中的对应位置：

| 原本文档内容 | 现在的位置 |
|---|---|
| 两条配置路线对比 | [§0 先选配置路线](kubernetes-deployment.md#0-先选配置路线二选一不要混用) |
| 部署架构与三条红线 | [§1](kubernetes-deployment.md#1-部署架构与三条红线) |
| 构建并推送镜像 | [§3](kubernetes-deployment.md#3-构建并推送镜像) |
| 外部 MySQL / 集群内 MySQL（StatefulSet） | [§4](kubernetes-deployment.md#4-准备-mysql外部--集群内-二选一) |
| Secret + ConfigMap 配置（原 §5） | [§5.2 路线二：纯环境变量](kubernetes-deployment.md#52-路线二纯环境变量secret--configmap) |
| 环境变量全表（原 §5.1） | [`environment-variables.md`](environment-variables.md)（全路线统一参考） |
| 部署清单与逐段说明（原 §6） | [§6](kubernetes-deployment.md#6-部署) |
| 验证与对外暴露（原 §7–§8） | [§7](kubernetes-deployment.md#7-验证与对外暴露) |
| 日常运维（原 §10） | [§9](kubernetes-deployment.md#9-日常运维) |
| 故障排查（原 §11） | [§10](kubernetes-deployment.md#10-故障排查速查) |
| 上线检查清单（原 §12） | [§11](kubernetes-deployment.md#11-上线前检查清单) |
| 一页纸速通版（原 §13） | [§12](kubernetes-deployment.md#12-一页纸速通版) |
| DBA 人工 SQL 初始化（附录 A） | [附录 A](kubernetes-deployment.md#附录-adba-人工-sql-初始化仅当应用账号不给-ddl-权限时) |

请更新你书签里的链接。本文件仅作跳转保留，内容不再更新。
