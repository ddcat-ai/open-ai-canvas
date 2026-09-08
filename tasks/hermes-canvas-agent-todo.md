# Hermes Agent 植入画布 Agent 任务追踪

## 阶段 1：Bridge 与最小闭环

- [ ] Hermes Bridge 会话创建、回合提交、SSE 事件和取消接口
- [ ] `canvas-agent` Hermes 客户端与协议类型
- [ ] 验证 CLI 登录授权后由 Codex/Claude 通过 stdio MCP 操作远程画布
- [ ] Canvas Tool Adapter 与三个最小画布工具
- [ ] 剧本拆场景并创建文本节点的浏览器闭环

## 检查点 1

- [ ] 流式消息、审批、节点写入和 409 重读通过真实页面验证

## 阶段 2：影视创作能力

- [ ] `/script-to-scenes` 等 Skills 合同与路由
- [ ] Skill 输入输出、版本和画布工具权限声明
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

- [ ] `canvas-agent` 测试和构建通过
- [ ] Hermes Bridge 真实导入测试通过
- [ ] 前端 Agent 聚焦测试和真实浏览器验证通过
- [ ] 文档、待测试清单和功能清单同步
