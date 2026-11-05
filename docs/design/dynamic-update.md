# 服务动态更新设计

当前定制部署保护的实现与配置见 [定制版本与更新保护](../content/docs/backend/custom-release-updates.mdx)。来源不明、手动维护或运行镜像不匹配的部署默认拒绝覆盖更新；本文其余部分包含规划，不代表全部能力已实现。

## 目标与边界

动态更新面向使用官方 Docker Compose 部署的自托管实例。管理员可在后台查看当前版本、GitHub Release 新版本和更新日志，并发起一次受控升级。升级必须满足：同一时刻只有一个更新任务、数据库和数据目录有可恢复备份、迁移失败不启动新服务、健康检查失败自动恢复旧镜像、业务 Backend 不直接持有 Docker Socket。

源码部署、Kubernetes、Portainer 或用户自行修改过编排文件的实例第一阶段只提供版本检查和手工升级指引，不自动接管宿主机。

## 组件边界

```text
管理后台
  -> Backend 更新 API（鉴权、状态展示、审计）
      -> Host Updater（宿主机最小权限守护进程）
          -> GitHub Release / OCI Registry
          -> Docker Compose
          -> PostgreSQL / 数据卷备份
```

- Backend 负责管理员权限、Release 信息缓存、更新任务展示和审计，不执行 Docker 命令。
- Host Updater 负责下载、验签、备份、迁移、切换、健康验证和回退；只接受本机 Unix Socket 或随机高强度 Token 鉴权请求。
- `migrate-schema` 是唯一结构迁移入口。生产 Backend 使用 `CANVAS_AUTO_MIGRATE=false`，只校验 Schema 与当前二进制兼容。
- 官方 Release 发布不可变镜像摘要和更新清单；Updater 不执行 Release 文本中的任意命令或脚本。

## Release 清单

每个正式 Release 附带机器可读的 `update-manifest.json`，至少包含：

| 字段 | 用途 |
| --- | --- |
| `version`、`channel`、`publishedAt` | 版本比较和稳定版/测试版通道 |
| `minimumUpdaterVersion` | 阻止旧 Updater 执行不理解的新协议 |
| `images` | Web、Backend 镜像及不可变 digest |
| `schemaVersion`、`minimumRollbackSchemaVersion` | 升级前兼容性和可回退性判断 |
| `composeRevision` | 确认当前部署模板是否受支持 |
| `releaseNotesUrl` | 后台展示更新日志 |
| `signature` | 对规范化清单做签名，防止供应链篡改 |

版本比较使用语义化版本，正式通道默认忽略 prerelease。GitHub API 使用 ETag 和超时缓存，网络失败只显示“检查失败”，不会影响当前服务。

## 升级状态机

```text
idle -> checking -> preflight -> draining -> backup -> pulling
     -> migrating -> switching -> verifying -> succeeded
                       |             |            |
                       +---------- failed --------+
                                      |
                                  rolling_back
                                      |
                         rolled_back / manual_intervention
```

更新任务和每一步结果持久化到宿主机，不只保存在正在被替换的 Backend 中。Updater 使用文件锁保证单实例执行，并为每次更新生成 operation ID，重复点击只返回同一任务。

### 预检

1. 校验管理员请求、更新通道、Release 签名、镜像 digest 和磁盘空间。
2. 确认当前 Compose revision、数据目录、数据库连接和备份目录可访问。
3. 检查当前 Schema、目标 Schema 与回退兼容窗口；不满足时在停机前拒绝更新。
4. 拉取目标镜像但不切换，确认目标 Backend 内含期望版本的 `migrate-schema`。

### 排空与备份

Updater 先让 Backend 进入 drain。Readiness 立即变为 503，新生成任务返回可重试错误；周期 Worker 停止领取任务，已执行任务在 `CANVAS_SHUTDOWN_TIMEOUT` 内完成。随后执行 PostgreSQL 一致性备份、SQLite 文件快照和数据目录增量快照，并记录备份校验和。备份失败不得继续迁移。

### 迁移与切换

目标镜像以一次性容器执行 `migrate-schema up`。迁移整批运行在事务中，PostgreSQL 使用事务级 advisory lock；迁移实现与 `schema_migrations` 记录的名称或 checksum 不一致时立即失败。迁移成功后才切换 Web/Backend 镜像，并保持旧镜像 digest 与旧 Compose 配置可用。

### 健康验证

切换后依次验证：

1. `/api/health/startup` 成功；
2. `/api/health/ready` 连续多次成功；
3. `/api/system/version` 与目标 Release、Schema 版本一致；
4. 可选的登录态只读冒烟检查成功。

单次 200 不视为升级成功。只有在稳定窗口内连续通过后才标记成功并清理临时资源。

## 回退策略

回退分为两类：

- **镜像回退**：目标版本未修改 Schema，或新 Schema 仍兼容旧 Backend，直接恢复旧镜像和 Compose 配置并再次验证健康状态。
- **数据回退**：迁移包含破坏性或不可向后兼容变更，停止所有业务容器后恢复数据库和数据目录快照，再启动旧镜像。该过程会丢弃升级开始后的新写入，因此升级期间必须保持写流量关闭。

迁移设计默认采用 expand/contract：先新增字段/表并保持旧版本可读，至少跨一个发布周期后再清理旧结构。无法做到向后兼容的 Release 必须在清单中标记维护窗口和数据回退要求，后台需要二次确认。自动回退失败时保持服务停止并输出明确的备份位置、失败步骤和人工恢复命令，不反复重试破坏现场。

## 后台能力

第一阶段后台提供：当前版本、目标版本、发布时间、更新日志、通道、检查时间、升级前检查结果、更新进度、失败原因、回退结果和审计记录。只有超级管理员可发起更新；普通管理员只读。危险状态不提供“强制跳过迁移/备份/验签”入口。

建议 API：

- `GET /api/admin/system/update-status`
- `POST /api/admin/system/check-update`
- `POST /api/admin/system/update`
- `GET /api/admin/system/update-operations/:id`
- `POST /api/admin/system/update-operations/:id/rollback`

## 分阶段实施

### P0：可升级运行基础

- 权威 BuildInfo 与 `/api/system/version`；
- 分层健康检查和 Worker drain；
- 版本化、事务化的 `schema_migrations` 与独立迁移命令；
- 生产 Compose 的 migrate job、停止宽限期和 Release 版本门禁。

### P1：只读检查更新

- Backend 缓存 GitHub Release/manifest；
- 管理后台展示版本、更新日志、部署类型和自动更新可用性；
- 无 Host Updater 的部署只展示手工更新指引。

### P2：Host Updater 与手动升级

- 独立最小权限进程、操作锁、持久化状态、备份、镜像切换和健康回退；
- 后台实时展示进度，先在 PostgreSQL 官方 Compose 上灰度；
- SQLite 和自定义数据目录在备份/恢复验证完成后开放。

### P3：自动调度

- 支持维护窗口、稳定版通道、失败通知和延迟发布；
- 默认关闭无人值守升级；涉及破坏性迁移的版本始终要求人工确认。
