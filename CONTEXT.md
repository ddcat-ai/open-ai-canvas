# 影策 · 编辑器上下文

面向 AI 影视与短剧创作工作台中的"时间线智能编辑器"子域：时间线模型、编辑命令、预览与导出、自动字幕、插件体系的统一语言。术语主要受 Concat（WolfCut）架构启发，插件部分参考 open-vetta「万物皆可插件」理念，适配 Web + Go 技术栈，详见 `docs/adr/`。

## 语言

**时间线 (Timeline)**:
项目的时序编排视图，由轨道与片段组成；`TimelineProject`（v2）是编辑真相源的数据形状。
_Avoid_: 时间轴、剪辑线

**轨道 (Track)**:
同一类型片段的有序序列（video / audio / subtitle / text / image），有 `order` 与 `locked`。
_Avoid_: 层（Layer 特指画布节点叠放，不用于时间线）

**片段 (Clip)**:
时间线上对素材的一段引用：`startMs` + `durationMs` 定位在时间线，`sourceStartMs` / `sourceDurationMs` 定位在源素材内。
_Avoid_: 素材（Media 指源头资产，Clip 是其时间线引用）

**直连媒体 (directMedia)**:
仅时间线作用域的媒体引用（素材库/项目资产/本地上传直接入轨），存在时预览/导出优先从该字段解析，不回画布查节点。
_Avoid_: 内联媒体、画布素材

**编辑命令 (EditCommand)**:
唯一允许修改时间线的可序列化指令 `{ op, payload }`，经单队列顺序应用；UI 不直接改写模型。
_Avoid_: 操作、mutate、setState（指组件内部状态）

**手势回显 (Echo)**:
拖拽/裁剪等手势期间在本地预演的位置与效果，手势结束才提交一个编辑命令——撤销的粒度是手势而非每一像素。
_Avoid_: 预览态、假数据

**预览近似 (Preview Approximation)**:
交互期间用浏览器原生能力（`<video>` 裁剪缩放、CSS 滤镜、canvas 合成）渲染的近似画面，不是导出像素。
_Avoid_: 预览帧、真实预览

**渲染真相 (Render Truth)**:
导出产物的真实合成画面，由单一滤镜图计划驱动；预览近似与它参数同源、允许画质级差。
_Avoid_: 最终预览、监看画面

**滤镜图 (Filter Graph / Render Plan)**:
`buildTimelineRenderPlan` 生成的 ffmpeg 参数计划（trim → gap → concat → subtitle → burn），是导出滤镜串的唯一来源；新增效果禁止在 UI 手写第二套滤镜串。
_Avoid_: 滤镜链、ffmpeg 参数（指手工拼的字符串）

**转写字幕 (Transcription)**:
后端服务任务：把音频/视频片段经 ASR 转成字幕片段写回字幕轨道；前端只提交任务并展示进度。
_Avoid_: 自动字幕（指 UI 按钮名，模型层术语为转写）

**预设插件 (Preset Plugin)**:
随应用分发、默认启用、不可卸载的插件：编辑器全部 UI 与能力（时间线面板、预览、检查器、转写、导出、字幕工具）均为预设插件；与用户插件同 SDK 同清单，仅分发与权限语义不同。
_Avoid_: 内置功能、硬编码面板（内置 = builtin 源码目录语义，指非插件化的历史形态）

**UI 插槽 (UI Slot)**:
宿主暴露的注册式挂载点（`registerTimelinePanel` / `registerPreviewRenderer` / `registerExportRenderer` / `registerTranscriptionProvider` / `registerSubtitleTool` / `registerShortcutScope`），内置与第三方插件平等占位；插件不得绕过插槽直接挂载 DOM。
_Avoid_: 面板数组、硬编码容器

**插件 SDK (Plugin SDK / yingce.plugin/v2)**:
`definePlugin` + 清单 + 贡献类型 + 权限声明的统一形态；v2 在 v1 基础上新增 UI 插槽、预设分发与权限执行校验。
_Avoid_: 插件协议（指 v1 旧称，v2 起称 SDK/清单）

**能力提供者 (Capability Provider)**:
插件以 provider 身份注册的能力（如转写提供者、导出渲染器、预览渲染器），宿主在调用点校验权限后执行；未声明即不可见不可用。
_Avoid_: 能力函数、功能开关

**语音滤镜 (Voice Filter)**:
音频效果能力（音量/淡入淡出/均衡/回声/降噪/变速变调）：预览近似走 Web Audio API，导出真相走 ffmpeg 音频滤镜，两者同源同参数模型（ADR-0006）。
_Avoid_: 声音特效、音频美化

**模板 (Template)**:
项目快照（章节 + 画布 + 时间线 + 资产引用清单，不含媒体二进制），支持存为模板 / 从模板新建；服务端模板表 + 缩略图（ADR-0006）。

**AI 编辑命令 (AI Edit Command)**:
LLM 输出的受约束命令序列 JSON `{ commands, reasoning }`，op 来自命令白名单、payload 按 per-op schema 校验（fail-closed，单条非法整批拒绝）；与手势命令同队列、同撤销栈（ADR-0007）。
_Avoid_: AI 操作、自动剪辑

**时间线摘要 (Timeline Summary)**:
时间线结构化精简版（轨道/片段/时长/关键属性，不含媒体二进制），作为 AI 对话上下文输入；纯函数生成、可测试（ADR-0007）。
_Avoid_: 时间线导出、prompt 原文

**AI 助手插件 (editor-ai-assistant)**:
对话式剪辑预设插件：AI 只读问答（timeline.read）+ 命令执行（timeline.command）+ 聚合转写/字幕高亮/素材入轨入口；复用画布 agent 聊天 UI 交互模式，不共享会话上下文（ADR-0007）。
_Avoid_: 画布 Agent（指 canvas 会话桥接，与编辑器 AI 面板是两套会话）
_Avoid_: 预设项目、项目副本
