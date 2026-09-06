# ADR-0001: 编辑器整合以 TS 时间线状态机为真相源，不移植 Concat 的 Rust 引擎

状态：已接受。日期：2026-09-01。来源：借鉴 Concat（WolfCut）编辑器能力整合决策。

> 更新记录（2026-09-01）：采纳 ADR-0005 后，编辑器 UI 与能力出口改为预设插件贡献（详见 ADR-0005）；本 ADR 聚焦的边界因此收窄为：核心状态机仍是宿主 TS 库，但不再是编辑器的一切。

## 背景

Concat（WolfCut）的核心架构原则是"引擎拥有项目模型"（engine doctrine）：Rust 引擎持有时间线模型、全部编辑命令（`commands.rs`）、撤销栈、渲染与导出路径、文档格式（wolfcut.json）；Tauri host 只是管道，UI 只渲染状态并派发命令。这一形态依赖本地文件系统、ffmpeg 子进程和 GPU 组合器，与其桌面产品定位绑定。

影策是 Web 应用（React 19 + Go 后端 + Node canvas-agent），画布节点模型以 TS 状态机为真相源（localforage user-scope + 后端项目接口持久化）。时间线已有第一期字幕数据落地与第二期类型（`TimelineProject` v2，含轨道/片段/directMedia），第三期规划了 ffmpeg 导出（`timeline-to-ffmpeg.ts` 纯函数规划层已存在）。后端 Go 目前不执行 ffmpeg。

## 决策

借鉴 Concat 的架构**形态**，不移植其**实现**：把"引擎拥有模型"翻译为"TS 时间线状态机拥有编辑真相"。

- 时间线编辑逻辑集中在 `web/src/lib/timeline/`（在现有 build/placement/snap/to-ffmpeg 基础上新增 editor 状态机），UI 组件只渲染状态并派发命令，不直接改写模型。
- 编辑器**UI 与能力出口全部为预设插件贡献**（时间线面板、预览、检查器、转写、导出、字幕工具），核心状态机是插件依赖的宿主协议而非编辑器的一切（见 ADR-0005）。
- 不移植 wolfcut crates、不引入 WASM 版引擎、不引入 Tauri/Electron 壳。
- 媒体重活（转码、导出合成、转写）交给 Go 后端任务队列，浏览器 ffmpeg.wasm 保留为降级路径，两者由同一份滤镜图计划驱动（见 ADR-0003）。

## 考虑过的方案

- **移植/包装 Rust 引擎（wasm32 / 子进程）**：引擎与画布节点模型、localforage 缓存、浏览器预览路径同构成本高，会产生"引擎真相 + 画布真相"双真相源；否决。
- **引入现成 Web 视频编辑器库（Remotion/Editly 等）**：Remotion 是 React 声明式渲染框架而非交互式多轨编辑器，现成编辑器与画布→时间线的 AI 工作流（节点资产入轨、字幕一期能力）耦合成本高于自建；否决。
- **TS 端自建状态机（选定）**：与现有 `timeline.ts` v2、`timeline-build`/`timeline-placement` 等纯函数层一脉相承，可直接复用字幕与导出规划能力。

## 后果

- 撤销、自动保存、命令协议由 TS 端承担，责任随 Concat 的引擎移动到了前端库层；需要用类型与测试约束（见 ADR-0002）。
- 不复制 Concat 的 chains mirror 债务（TS 手写镜像 Rust 滤镜串）：滤镜参数只允许单一来源（见 ADR-0003）。
- ffmpeg 执行位置（浏览器 wasm / 后端任务）保持可切换，切换不改变编辑模型与导出参数。
- 编辑器面板（时间线/预览/右侧检查器）复用 `docs/design/workspace-shell-design.mdx` 的设计 token 与三段式布局，不引入新设计体系。
- 新增编辑器能力由预设插件承担（ADR-0005）：核心库冻结，只演进命令协议、滤镜图计划与任务协议。
