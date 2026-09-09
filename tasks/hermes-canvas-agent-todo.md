# Hermes Agent 植入画布 Agent 任务追踪

## 当前边界

外部 Codex、Claude 等 Agent 通过 stdio MCP 使用远程画布。它们负责 Skill、Plan、Task、询问/自动和审批；远程 MCP 只负责画布读取、校验、写入和生成任务提交。下表中的 Hermes Bridge 是网页内置 Agent 的独立路线，不属于外部 MCP 客户端。

## 阶段 1：网页 Agent 的 Hermes Bridge 与最小闭环

- [ ] Hermes Bridge 会话创建、回合提交、SSE 事件和取消接口
- [ ] `canvas-agent` Hermes 客户端与协议类型
- [ ] 验证 CLI 登录授权后由 Codex/Claude 通过 stdio MCP 操作远程画布
- [ ] Canvas Tool Adapter 与三个最小画布工具
- [ ] 网页 Agent 通过现有在线模型工具循环完成剧本拆场景计划、审批和节点写入闭环
- [ ] 剧本拆场景并创建文本节点的浏览器闭环

## 检查点 1

- [ ] 流式消息、审批、节点写入和 409 重读通过真实页面验证

## 阶段 2：影视创作能力

- [ ] 网页 Agent 的 `/script-to-scenes` 等 Skills 合同与路由
- [ ] 网页 Agent Skill 输入输出、版本和画布工具权限声明
- [ ] Skill 手动调用：启用只进入列表，`/skill-name` 或选择器调用后才注入当前回合
- [ ] 复杂请求 Plan 生成、预览和修改
- [ ] Task 状态、依赖、暂停、重试、取消和恢复
- [ ] 询问模式/自动模式与 Task 授权策略
- [ ] 节点查找、更新、删除、连线工具
- [ ] 图片、视频、音频生成任务
- [ ] `@` 引用、附件和 Agent 结果视图

## 检查点 2

- [ ] 从剧本生成角色、分镜和媒体节点的完整流程通过

## 阶段 3：画布 Agent 扩展

- [ ] Memory 与项目隔离
- [ ] 仅使用画布工具的 Subagent delegation
- [ ] 长任务恢复、压缩和幂等

## 最终检查点

- [x] `canvas-agent` 测试和构建通过（43 tests；npm build）
- [ ] Hermes Bridge 真实导入测试通过
- [ ] 前端 Agent 聚焦测试和真实浏览器验证通过
- [ ] 文档、待测试清单和功能清单同步
