# Agent 浏览器 Worker 与服务端 Worker 共存

实现分支：`codex/browser-agent-worker`。原审计记录见 [计划审计](browser-agent-worker-audit.md)。

## 开关与分配

默认关闭。`CANVAS_BROWSER_AGENT_ENABLED=true` 设置部署默认值；后台「资源与策略 → 画布 Agent → 浏览器 Worker」保存后热更新并优先于环境变量。所有 Compose 后端服务透传该变量。

`GET /api/agent/capabilities` 返回 `browserAgentEnabled`。前端创建或续轮时读取该能力：开启且支持 Worker 时请求 `executionMode: browser`，否则请求 `server`。调用方也可显式选择 server；后端关闭开关时拒绝新的 browser 请求（409 `browser_agent_disabled`）。旧客户端省略模式仍走原服务端路径。

执行方式在每轮创建时固定。开关不迁移进行中的会话，已接受的幂等重试按原模式返回，已有 browser 会话继续可发现和恢复。服务端运行保留原独立 `yingce-agent` / 嵌入式 Node 选择规则，远程失败不回退到嵌入式进程。

浏览器编排释放服务端 Node 的会话容量，可减少 Agent 排队。模型请求、图片和视频仍走 Go 的任务队列、渠道并发、预算及计费，不能消除供应商侧限流。关闭全部页面后暂停后续编排，已提交任务仍独立执行和归档。

## 运行协议

部署可通过 `CANVAS_AGENT_BROWSER_ONLY=true` 限定为仅浏览器编排，受管安装叠加 `docker-compose.browser-only.yml` 并停用 Node Agent 容器；能力接口返回 `browserAgentOnly`，后端拒绝新的服务端执行请求，也禁止启动远程或嵌入式 Node。该限制优先于后台保存的浏览器开关。安装、切换、在线更新及回退说明见 [仅浏览器 Agent 部署](../content/docs/overview/browser-agent-deployment.mdx)。

首版采用原生、带类型的 Dedicated Worker，未加入 Pi SDK。后端已有 canonical history、工具游标和回执，继续作为执行事实的唯一来源，避免浏览器与 SDK 再维护一份消息历史。

Worker 根据服务端 `nextAction` 请求单步。主线程复用登录态 `http`、账号 scope、超时和取消；不接触系统渠道密钥。生命周期属于整个已登录应用，关闭 Agent 面板不会停止 Worker。

| 接口 | 作用 |
| --- | --- |
| `GET /api/agent/browser-runs` | 发现本人未结束的 browser 会话 |
| `POST /api/agent/runs/:id/runtime/claim` | 原子领取 owner、epoch 和 45 秒租约 |
| `POST .../runtime/heartbeat` | 校验未过期 owner/epoch，续租 |
| `GET .../runtime/state` | 返回版本、revision、租约、连接状态和服务端签发 nextAction |
| `POST .../runtime/step` | 提交服务端签发 stepId，原子接受当前模型、工具、压缩或收尾动作 |

写请求携带 `protocolVersion: 1`、`owner`、`epoch`，step 另外携带 `stepId`。检查点版本为 1；版本不一致停止该会话驱动并上报，刷新后再协商。接口不接收客户端消息历史、工具参数、执行成功标志或业务权限。

`nextAction` 为 model/tool/compact/settle/wait_task/wait_approval/wait_user/done。等待审批、等待用户与运行终态继续使用原业务状态，连接断开通过独立 `runtimeConnection` 表示。

控制信息保存在现有 `cloud_agent_executions.state_json` 的 browser 字段：owner、epoch、leaseUntil、sequence、finalAnswer 和 pending。它与步骤接受、原工具游标使用同一个 Revision CAS。stepId 由服务端 run ID 与单调 sequence 生成，旧 step 重传只确认，不创建下一步。工具动作绑定原始服务端调用；模型历史与上下文预算在后端重建并校验。

已接受的 pending 动作由后端独立完成。执行器有单独的 45 秒租约，每 10 秒续租；进程恢复只重建已接受动作，不自行开始下一模型轮。模型结果与 settled 标记同事务保存；工具恢复查询原回执；压缩复用现有结构化检查点及失败保底。页面刷新、新标签或账号切换不授权重复副作用。

工具恢复先按原调用 ID 核对已保存的回执、审批或媒体任务；审批准备产生的新参数不会触发旧调用重放。已批准但尚未执行的操作交给原审批收尾执行器，待审批状态不提交媒体任务。浏览器模型请求显式携带本轮冻结的思考意图，保留 auto/deep/显式档位及强制关闭策略，并由原任务能力解析决定供应商参数。

## 客户端失败日志

`POST /api/agent/client-failures` 自动接收启动失败、Worker 崩溃、消息错误、未处理异常、协议错误及运行请求失败。启动错误允许没有 runId。只允许固定代码、阶段、版本、HTTP 状态、时间、run/step/epoch 和受限帧元数据；不接收任意错误文本、堆栈正文、模型内容、Cookie、密钥或 URL。

浏览器使用当前账号独立 IndexedDB 队列，最多 200 条、保留 24 小时、每批 20 条；仅删除后端 ACK 的 eventId。恢复本地数据时重建允许字段。网络失败退避，切换账号中止请求，上传失败不递归触发上报。当前客户端帧列表为空，定位依靠固定错误码、阶段和 run/step。

后端以 `(user_id,event_id)` 幂等，冲突内容拒绝；每用户最多 2000 条、保留 14 天，启动及每小时清理。`GET /api/agent/client-failures` 只读本人；`GET /api/admin/agent/client-failures` 在 service 校验管理员后可按 userId/runId 查询，最多返回 200 条。新表由 Yingce migration 5 创建。

## 验证边界

专项测试覆盖租约接管、旧 epoch、版本错误、用户归属、审批/输入门禁、取消、开关与模式并存、真实任务队列和工具批次、丢 ACK 重放、日志幂等/隐私/保留与部分 ACK。

浏览器联调使用真实应用页面、Dedicated Worker、Go 后端和 SQLite，模型上游使用本地模拟服务；另外验证原 Node 服务端运行链路。生产 PostgreSQL/Redis、多实例故障、移动端后台冻结和真实供应商并发压测需在相应环境验证。该功能不会自动迁移在途会话；仅浏览器部署可停用服务端 Node Agent 组件，仍需 Go 后端任务 Worker。
