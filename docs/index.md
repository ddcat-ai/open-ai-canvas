# 影策 · AI 文档索引

面向 AI 的短索引。详细文档维护规则见 [AGENTS.md](../AGENTS.md) 第 10 节「文档同步」。

## 设计沉淀

- [工作区外壳设计沉淀](design/workspace-shell-design.mdx)：侧栏（260px 可折叠导航 + 分组折叠）、主区卡片、顶部栏（账户/公告/主题）的设计决策与样式约束。

- [画布节点可读性设计沉淀](design/canvas-node-visual-contrast.mdx)：节点外壳、空态和图片创作面板在浅色/深色画布上的表面、边界、阴影与控件状态约束。

- [画布浮动控件设计沉淀](design/canvas-floating-controls.mdx)：顶部操作区、底部 Dock、小地图和右下角工作模式切换的浮动面板、定位与响应式约束。

- [用户诊断包设计](design/user-diagnostic-bundle.mdx)：面向普通用户的一键日志导出、前后端链路关联、脱敏、权限与排障方案。

- [肖像权可识别性排查画布插件实施规格](design/portrait-clearance-canvas-plugin.mdx)：TypeScript 重写、画布节点与全屏工作台、项目模型复用、本机 ONNX/百度识图/候选去重、任务合同、报告和验收方案。

- [AI 审美批改画布插件方案](design/ai-art-critique-solution.md)：云端视觉分析、并行 Reviewer、问题定位、AI 修改提示词与前端 SVG 标注的职责边界和交互设计。

- [LLM、Image、Video 主流请求协议全景与影策兼容性调查](design/model-request-protocol-landscape.md)：主流原生协议、聚合网关、图片/视频异步任务、参考素材 role、当前插件映射缺口与 MiniMax H3 专项审计。

- [编辑器预设插件化实施规格](plans/editor-preset-plugin-implementation.md)：参考 open-vetta 万物皆可插件，把编辑器做成预设插件的分阶段实施计划（SDK v2、命令状态机、8 个 editor 预设插件（含 AI 助手）、后端转写/导出任务、权限执行校验、AI 对话式剪辑），含产品视图、接口草案与文件规划。
- [编辑器实施 Runbook](plans/editor-implementation-runbook.md)：分步执行计划——M0~M6 里程碑 + 原子步明细（每步改动文件/验证/完成标准）、依赖关系、验证命令速查、高风险步与回退。解决「一次性实施效果差」：每步可验证、可回退、看得见进度。

## 决策记录（`docs/adr/`）

- [ADR-0001：编辑器整合边界](adr/0001-editor-integration-boundary.md)：借鉴 Concat 架构形态但以 TS 时间线状态机为真相源，不移植 Rust 引擎；媒体重活放 Go 后端。
- [ADR-0002：编辑命令协议](adr/0002-edit-command-protocol.md)：时间线唯一修改入口为可序列化编辑命令，手势 echo、有界快照撤销、防抖保存。
- [ADR-0003：预览与导出分层](adr/0003-preview-export-layering.md)：交互近似预览 + 单一滤镜图计划驱动导出，禁止手写第二套滤镜串。
- [ADR-0004：自动字幕转写服务化](adr/0004-autocaption-transcription-service.md)：转写为 Go 后端异步任务，结果写回字幕轨道。
- [ADR-0005：编辑器预设插件架构](adr/0005-editor-preset-plugin-architecture.md)：参考 open-vetta「万物皆可插件」，编辑器全部 UI 与能力为预设插件贡献，插件 SDK 演进为 v2（UI 插槽 + 预设分发 + 权限执行校验）。
- [ADR-0006：语音滤镜与项目模板](adr/0006-voice-filters-and-templates.md)：补充评估 Concat 剩余两个缺口——语音滤镜走 Web Audio 预览近似 + ffmpeg 音频滤镜图导出，模板走项目快照服务化；均为预设插件且服从单一滤镜图计划。
- [ADR-0007：AI 编辑交互](adr/0007-ai-editing-interaction.md)：对话式剪辑作为预设插件——AI 输出受约束命令 JSON（schema 校验 fail-closed），与手势命令同队列同撤销栈；≤3 条直接执行、批量改动 diff 预览待确认。

## 本地协作文档（不随仓库分发）

- [beautifului 创作设计](beautifului-creation-design.md)：本地设计参考，未纳入版本控制。

## 按约定维护的文档（`docs/content/docs/`）

功能、代码地图、待办、待测试分别维护在以下页面；尚未建立的专题会在对应任务中补齐：

- [AI 审美批改画布插件](content/docs/plugins/ai-art-critique.mdx)
- [功能](content/docs/overview/features.mdx)
- [本地开发](content/docs/backend/local-development.mdx)
- [后端数据库](content/docs/backend/backend-database.mdx)
- 代码地图：待补充
- 待办：待补充
- [待测试](content/docs/progress/pending-test.mdx)
