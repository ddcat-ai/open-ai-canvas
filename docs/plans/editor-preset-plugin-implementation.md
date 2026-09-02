# 编辑器预设插件化实施规格

> 文档状态：待实施（决策已定，见 ADR-0001 ~ ADR-0005）。
>
> 目标读者：后续负责实现、评审和验收的 AI 或开发者。
>
> 关联决策：[ADR-0001 整合边界](../adr/0001-editor-integration-boundary.md)、[ADR-0002 命令协议](../adr/0002-edit-command-protocol.md)、[ADR-0003 预览导出分层](../adr/0003-preview-export-layering.md)、[ADR-0004 转写服务化](../adr/0004-autocaption-transcription-service.md)、[ADR-0005 预设插件架构](../adr/0005-editor-preset-plugin-architecture.md)、[ADR-0006 语音滤镜与模板](../adr/0006-voice-filters-and-templates.md)。
>
> 硬约束：遵循 AGENTS.md 的目录职责、API 合同（`request.ts` / `custom-channel-relay`）、三层设计 token 与验证纪律；编辑器能力一律以预设插件贡献，不在核心库写编辑器专属硬编码分支。

## 0. 产品视图：实现完成后的编辑器

> 本节描述目标形态，帮助实现者理解"做完是什么样"；与 ADR-0001 ~ 0006 决策一一对应。UI 依据 `../design/workspace-shell-design.mdx` 三段式布局与既有设计 token，不引入新设计体系。

### 0.1 编辑器形态

编辑器是项目详情下的独立视图，对标 Concat 面板结构（时间线 / 预览 / 素材库 / 右侧面板），落在三段式工作区壳内：

```text
┌─ 顶部栏 ──────────────────────────────────────────────┐
│ ◀ 返回项目  剪辑中 · 已保存   ↩撤销 ↪重做    导出成片 ▸ │
├────────┬──────────────────────────────────┬───────────┤
│ 左侧栏  │       中央预览监视器              │ 右侧检查器 │
│ 素材库  │   播放/暂停/时间码/帧步进         │ 选中片段   │
│ ·角色资产│   （浏览器原生近似渲染）         │ 起止/音量  │
│ ·本地上传│                                  │ 变速/滤镜  │
│ ·转场/效│──────────────────────────────────│ 字幕文本   │
│  果分类 │       时间线面板（底部）          │           │
│        │  ┌──轨道区：视频/音频/字幕/文字──┐│           │
│        │  │ 拖拽移动 裁剪手柄 分割 吸附   ││           │
│        │  └──────────────────────────────┘│           │
└────────┴──────────────────────────────────┴───────────┘
```

每个区域都是**插件插槽**（§5.2）：时间线面板（bottom）、预览监视器（center）、右侧检查器（right）、素材入轨（left）、字幕工具（right 折叠）、转写/导出（弹层）；语音滤镜与模板为增量预设插件（见 ADR-0006）。停用某插件时对应区域显示空态，其余区域不受影响。

**与画布内 timeline-dialog 的定位差异（避免两套时间线 UI）**：画布 `canvas-timeline-dialog.tsx` 是**画布级快速组装**——单画布、轻量，从当前画布节点就近组装预览；编辑器是**项目级工作台**——跨画布、命令协议（ADR-0002）、撤销栈、插件面板（ADR-0005）。两者读写**同一 `TimelineProject`**、走**同一 `buildTimelineRenderPlan`**，形态层级不同、协议同源；不另立数据模型、不复制实现。

**编辑器 ↔ 画布 ↔ 短剧 关联图景**（数据流，均基于既有实现）：

```text
短剧（章节 → 分镜）
  │  chapterId / sceneId / storyboardRowId 挂在画布节点 metadata；shortDramaEnabled → guided 工作流（canvas-starter）
  ▼
画布（分镜画布）
  │  buildTimelineFromNodes / syncNodeSubtitlesToTimeline（timeline-build.ts）
  ▼
时间线（TimelineProject v2，挂在 project 上，非画布私有）
  │  clip.nodeId 引用画布节点；字幕 clip = subtitleEntryIndex + text 快照
  ▼
编辑器（/projects/:projectId/editor，本方案）
  │  buildTimelineRenderPlan 单一滤镜图 → MP4
  ▼
成片（onCreateAssembledNode 合成节点放回画布；导出可落项目资产/交付，见 M 阶段待定项）
```

### 0.2 入口（三层）

- **主入口 · 顶部导航 tab**：项目详情页视图切换器新增 `editor`（"剪辑"），路由 `/projects/:projectId/editor`，与「分镜制作」「项目画布」并列——从项目任何视图随时可达。实现点：`detail.tsx` 的 `DetailView` 联合类型加 `"editor"`、`views` 数组加对应项（图标建议 `Film`/`Scissors`，插在「项目画布」之后），路由复用既有 `/projects/:projectId/:view` 通配（`router.tsx`），无需新路由。
- **到达路径（完整链路）**：全局侧边栏「短剧创作」→ `/projects` 项目列表 → 项目详情页 → 顶部 tab「剪辑」。侧边栏入口实际显示名是「短剧创作」（`navigation-tools.ts`：`slug: "projects"`、`label: "短剧创作"`、Clapperboard 图标），不是「项目」；编辑器是短剧创作功能域内、项目详情页下的一个视图，全局导航不新增任何入口。
- **入口常驻（决策，2026-09-01）**：侧边栏与命令面板的「短剧创作」入口（`/projects`，即短剧创作模块）**不随功能开关渲染**——「短剧创作/剪辑」是普通用户核心功能，入口可见性不依赖管理员后台配置。`shortDramaEnabled` 仅保留为**部署级兜底**：管理员明确关闭短剧功能时，由 `RequireFeature` 渲染「暂未开放」提示页（带返回按钮，`require-feature.tsx`），而非隐藏入口。编辑器 `views` 项同理常驻。
- **流程入口 · 概览流程步骤卡**：`overview.tsx` 的 productionSteps 在「镜头视频」与「交付与打包」之间插入「剪辑成片」步骤卡（`href: /projects/:projectId/editor`，完成态 = 镜头视频齐备且已有时间线），快速入口区补「进入剪辑」。
- **状态入口 · 当前任务 CTA**：镜头视频全部就绪后，概览当前任务阶段（`overviewStage`）由"检查交付"扩展为"剪辑成片"，主 CTA 变为「开始剪辑」。

### 0.3 使用流程

```text
① 项目概览 → 切"剪辑"视图 → 进入编辑器（默认 7+2 插件全开）
② 左侧素材库选素材（角色资产/项目视频/本地上传）→ 拖入时间线（asset-ingest → directMedia）
③ 时间线编辑：拖拽排布、裁剪手柄、分割、变速、吸附对齐
     —— 手势先 echo 预演，松手才提交命令，可一键撤销（200 层快照）
④ 预览监视器实时看近似效果（滤镜/转场为 CSS/canvas/Web Audio 近似）
⑤ 右侧检查器精调选中片段（起止、音量、变速、滤镜）
⑥ 字幕：字幕工具导入 SRT / AI 高亮；自动字幕按钮 → 后端转写任务
     —— 进度展示 → 完成后 SRT 自动写回字幕轨道
⑦ 导出成片：导出面板选分辨率/格式/烧录字幕 → 后端 ffmpeg 任务 → 产物下载
```

与画布工作流的闭环：**分镜/AI 生成的视频 → 项目资产 → 入轨 → 剪辑 → 烧录字幕 → 成片**，是 AI 影视创作工作台的成片出口。

### 0.4 功能覆盖对照（Concat 已实现功能）

| Concat 功能 | 覆盖度 | 说明 |
| --- | --- | --- |
| 多轨编辑（视频/音频/字幕/文字） | ✅ | TimelineProject v2 轨道类型齐全 |
| 剪切工具 split/trim/merge | ✅ | M2 命令集含分割/裁剪/移动/删除；merge 需在 M2 命令集确认补一条 |
| 变速 speed control | ✅ | 命令集含 setSpeed |
| 自动字幕 | ✅（形态不同） | Concat 本地 whisper；影策服务端任务（ADR-0004），浏览器不跑模型 |
| 字幕高亮 | ✅（领先） | 已有 subtitle-highlight-* 库；Concat 尚在 roadmap |
| 标题与样式文本 | 🟡 | text 轨道 + 字幕工具批量样式；复杂标题动画依赖画布文本节点 |
| 转场 transitions | 🟡 | 单一滤镜图计划含转场降级；效果库是渲染器插槽扩展点，首版基础淡入淡出 |
| 语音滤镜 | ➕ 见 ADR-0006 | 音频 DSP：Web Audio 预览近似 + ffmpeg 音频滤镜图导出 |
| 模板 Templates | ➕ 见 ADR-0006 | 项目快照：存为模板 / 从模板新建；模板中心暂不做 |
| TTS 配音 | 🟡 能力在别处 | 生成式语音走既有模型渠道（ADR-0004 明确不属编辑器范围） |
| 效果/转场库扩展（Concat roadmap） | ✅ 架构即答案 | 渲染器/滤镜图插件化正是为其设计 |

## 1. 目标与范围

### 1.1 目标

把编辑器（时间线编辑、预览、导出、自动字幕）做成**预设插件（preset plugins）**，参考 astravia「万物皆可插件」理念：编辑器全部 UI 与能力都是插件贡献，宿主核心只保留协议层（时间线状态机、编辑命令、滤镜图计划、任务协议）。现有 `yingce.plugin/v1` 演进为 v2（UI 插槽 + 预设分发 + 权限执行校验），编辑器域是 v2 的第一个完整消费方。

### 1.2 首版必须交付

- 插件 SDK v2：`yingce.plugin/v2` 清单类型、UI 插槽注册 API、预设分发字段、权限执行校验（首个校验点：编辑器宿主 API）。
- 时间线命令状态机：可序列化编辑命令 + 单队列 + 有界快照撤销（200 层）+ 手势 echo。
- editor 预设插件（`builtin/editor/`）：时间线面板、预览监视器、右侧检查器、素材入轨、字幕工具、自动字幕（转写）、导出、AI 助手，共 8 个（7 核心 + editor-ai-assistant，见 ADR-0007）。
- 后端任务：转写任务（ASR 可插拔）+ ffmpeg 导出任务，复用现有任务队列与配额。
- 测试与验证：命令黄金文件、渲染计划黄金文件、插槽渲染冒烟、权限拒绝路径、AI 命令 schema 校验测试、浏览器验证清单。

### 1.3 明确不做

- 不做外部插件安装、插件市场、zip 上传、沙箱隔离（astravia 的租户选择机制待真正出现外部插件需求时再补）。
- 不做多端协同命令同步（命令日志协议预留，不实现服务端广播）。
- 不在浏览器跑 whisper；转写一律走后端任务。
- 不新增第二套滤镜串生成路径（单一 `buildTimelineRenderPlan` 约束对插件强制生效）。
- 不迁移既有画布 v1 插件（v1 贡献类型与字段保持兼容，无需改动）。

## 2. 现状盘点（实现者必须知道的事实）

以下为 2026-09-01 勘察结论，以当前代码为准：

### 2.1 插件体系现状（`web/src/lib/plugins/`）

- `plugin-types.ts`：`PLUGIN_API_VERSION = "yingce.plugin/v1"`；贡献类型 `provider | workflow | canvas-node | transform | command | asset-source | usage-observer | ai-capability | agent | import-export`；权限 `canvas.* / asset.* / generation.run / ai.text / media.read / usage.read / external.open`；`RegisteredPlugin` 提供 `activate/deactivate/createAssetSource/createPromptOptimizer`；`PluginManifest` 含 `surfaces`（仅声明字段，无插槽注册实现）。
- `plugin-registry.ts`：`registerPlugin`（`assertManifest` 校验 kebab-case id、apiVersion 必须等于 v1、权限不重复、至少一种贡献）→ `Map` 存储；canvasNodes 会同步注册到 `@/lib/canvas/node-registry`。
- `plugin-storage.ts`：启用态与配置持久化。
- `builtin/`：`index.ts` 静态 import 5 个插件（eagle、prompt-optimizer、workflows、portrait-clearance），`application.tsx` 顶层 `import "@/lib/plugins/builtin"` 完成注册。
- `use-plugin-store.ts`：插件启用态管理。

**结构性缺口（v1 不可直接支撑编辑器插件化）**：无 UI 插槽注册 API；无 editor 域贡献类型；无预设分发语义；内置插件为源码硬编码导入；权限只有清单字符串、宿主无调用点校验。

### 2.2 时间线现状（`web/src/types/timeline.ts` + `web/src/lib/timeline/`）

- `TimelineProject`（v2 数据形状）：轨道/片段/directMedia 已定义；一期字幕数据已落地。
- 纯函数库：`timeline-build.ts`（构建）、`timeline-placement.ts`（放置）、`timeline-snap.ts`（吸附）、`timeline-tracks.ts`、`timeline-view.ts`、`srt-parser.ts`、`srt-resegment.ts`、`subtitle-highlight-*`（AI 字幕高亮）。
- 导出规划：`timeline-to-ffmpeg.ts` 导出 `buildTimelineRenderPlan(timeline, sources, context): TimelineRenderPlan`（含 `steps` 与 `SUBTITLE_FILE`），是**唯一的**滤镜图计划来源。
- 画布 ↔ 时间线引用：`timeline-build.ts` 的 `buildTimelineFromNodes`（画布节点 → 时间线）与 `syncNodeSubtitlesToTimeline`（节点字幕 → 时间线字幕轨道，`project.tsx` 字幕保存时调用）；`clip.nodeId` 引用画布节点、字幕 clip 带 `subtitleEntryIndex` + `text` 快照；画布内 `canvas-timeline-dialog.tsx` 已有组装/裁剪/入轨/成片回画布闭环（编辑器为其**项目级形态**，同一 `TimelineProject`，见 §3.1）。
- 尚无编辑命令层：当前修改模型是直接写状态，没有命令/撤销/echo。

### 2.3 后端任务现状（`backend/internal/`）

- 任务模型在 `backend/internal/model/models_task.go`；任务输出在 `service/task_output.go`；provider 调度在 `service/provider.go`。
- 后端目前不执行 ffmpeg；无 ASR/转写能力。

### 2.4 设计资产

- `docs/design/workspace-shell-design.mdx`：三段式布局（侧栏 / 主区 / 顶部栏）与设计 token，编辑器面板复用，不引入新设计体系。

## 3. 目标架构

```text
┌──────────────────────── Web / React ─────────────────────────┐
│  宿主核心（协议层，冻结扩展）                                 │
│    ├─ timeline 状态机（真相源）——命令队列/apply/快照撤销     │
│    ├─ 滤镜图计划 buildTimelineRenderPlan（单一来源）           │
│    ├─ 任务协议（转写/导出任务客户端）                         │
│    └─ 插件宿主：editor-slot-registry 插槽渲染 + 权限执行校验  │
├──────────────────────────────────────────────────────────────┤
│  插件 SDK v2（yingce.plugin/v2）                              │
│    ├─ definePlugin 统一形态（v1 字段兼容）                    │
│    ├─ UI 插槽注册 API（面板/渲染器/工具/快捷键域）            │
│    ├─ 预设分发（preset: true, defaultEnabled）                │
│    └─ 权限执行（宿主调用点 fail-closed 校验）                 │
├──────────────────────────────────────────────────────────────┤
│  editor 预设插件（builtin/editor/，默认启用不可卸载）          │
│    ├─ editor-timeline-panel      时间线面板                   │
│    ├─ editor-preview-monitor     预览监视器（近似渲染）        │
│    ├─ editor-inspector           右侧检查器                   │
│    ├─ editor-asset-ingest        素材入轨                     │
│    ├─ editor-subtitle-tools      字幕工具                     │
│    ├─ editor-transcription       自动字幕（转写面板）          │
│    ├─ editor-export              导出面板                     │
│    └─ editor-ai-assistant        AI 助手（对话式剪辑，ADR-0007）│
└──────────────────────────────────────────────────────────────┘
        │ 任务协议（前端不变）
┌───────▼───────────── Go 后端 ───────────────┐
│  任务队列 + 配额：transcription / render 任务 │
│    ├─ ASR provider（whisper.cpp / 云 ASR 可插拔）│
│    └─ ffmpeg 导出（主路径；wasm 为浏览器降级）  │
└──────────────────────────────────────────────┘
```

数据流（编辑）：UI 手势 → 本地 echo 预演 → `release` 提交一个编辑命令 → 单队列 → reducer → 新 `TimelineProject`（真相源）→ 快照撤销栈 + 1.5s 防抖保存（localforage + 后端项目接口）。

### 3.1 引用契约：画布节点 ↔ 时间线片段

时间线片段与画布节点是**层间引用**而非合并模型：clip 以 `nodeId` 引用画布节点（素材来源），字幕以 `subtitleEntryIndex` + `text` 快照引用节点字幕。现有实现已暴露 3 个真实耦合点，编辑器实现必须立契约束缚：

1. **媒体元数据双份**：`timeline-build.ts` 构建 clip 时把节点 `durationMs` 复制为 `sourceDurationMs`，构建后节点时长变化不自动同步。
2. **字幕双份（快照契约）**：节点 `subtitleEntries` 是实体，字幕 clip `text` 是快照。`syncNodeSubtitlesToTimeline` 已提供「节点 → 时间线」单向同步（`project.tsx` 字幕保存时调用）；「时间线 → 节点」方向**不自动回写**——编辑后由 `editor-subtitle-tools` 提供显式「从节点重建字幕片段」命令，把漂移变成用户可操作的动作，不做双向隐式同步。
3. **nodeId 悬空引用**：节点删除/替换后 clip 引用失效。render 层（`buildTimelineRenderPlan` sources 解析）必须区分两种结果：**可降级**（跳过该 clip 并提示）与**不可解析**（报错并定位到具体 clip），禁止静默产出错误渲染。

契约总原则：**时间线以「快照 + 可重建」持有来自画布的数据，单向显式同步，双向不同步**；画布数据变更不自动改写时间线，避免隐式漂移。与画布内 `canvas-timeline-dialog`（画布级快速组装，单画布、轻量）不同，编辑器是**项目级工作台**（跨画布、命令协议、撤销栈、插件面板）——两者读写同一 `TimelineProject`、同一 `buildTimelineRenderPlan`，形态层级不同、协议同源。

## 4. 分阶段实施计划

### M1 插件 SDK v2（前端插件体系演进）

目标：v1 → v2 类型与注册机制，向后兼容；编辑器域贡献类型与插槽注册表就位。

任务：

1. `web/src/lib/plugins/plugin-types.ts`
   - 新增 `PLUGIN_API_VERSION_V2 = "yingce.plugin/v2"`；`PluginManifest.apiVersion` 允许 v1 | v2。
   - 新增 editor 贡献类型：`timeline-panel | preview-renderer | export-renderer | transcription-provider | subtitle-tool | inspector-panel | asset-ingest | shortcut-scope`（并入 `PluginContributionKind` 与 `PluginContributions`，v1 插件不声明即为空）。
   - 新增权限：`timeline.read / timeline.write / timeline.command / transcription.run / export.run`（并入 `PluginPermission` 联合类型）。
   - 新增预设分发字段：`preset?: boolean`、`defaultEnabled?: boolean`（默认 `preset: false`，v1 清单不设即保持现状）。
   - 新增 `RegisteredPlugin` 的 editor 工厂入口：`createTimelinePanel? / createPreviewRenderer? / createExportRenderer? / createTranscriptionProvider? / createSubtitleTool?`（与 `createAssetSource` 同构）。
2. 新建 `web/src/lib/plugins/editor-slot-registry.ts`：UI 插槽注册表与渲染入口（接口草案见 §5.2），含插槽去重（同一 pluginId+slotId 幂等覆盖）、顺序（`order` 字段）、卸载（`unregisterPlugin` 时同步清理）。
3. `web/src/lib/plugins/plugin-registry.ts`：`assertManifest` 按 apiVersion 分支校验；v2 清单允许空 `contributes`（若仅贡献 UI 插槽，插槽在注册时单独校验）；注册/注销时联动 `editor-slot-registry`。
4. `web/src/lib/plugins/builtin/index.ts`：保持静态导入，语义化为"预设插件入口"（注释标明）；新增 `builtin/editor/` 子目录。

产出：v1 插件零改动可运行；`listRegisteredManifests` 可枚举 v2 清单。
验证：`cd web && bun run build` 通过；现有 5 个 builtin 插件注册无回归。

### M2 时间线命令状态机（宿主核心协议）

目标：时间线唯一修改入口命令化，撤销/echo/保存就位；命令 handler 可插件注册。

任务：

1. 新建 `web/src/lib/timeline/editor-commands.ts`
   - `type EditCommand = { op: string; payload: unknown }`；`type CommandHandler = (state: TimelineProject, payload: unknown) => TimelineProject`（纯函数，禁止依赖组件实例）。
   - `createEditorCommandRegistry()`：`register(op, handler)`（宿主与插件共用，插件经宿主 API 注册）、`apply(state, cmd)`（未知 op 抛错，fail-closed）、黄金命令集合（`addClip / moveClip / trimClip / splitClip / deleteClip / setVolume / setSpeed / addSubtitle / updateSubtitle / deleteSubtitle / setDirectMedia / ...`，首版以一期/二期能力为准）。
2. 新建 `web/src/lib/timeline/editor-history.ts`：有界快照撤销（`undoStack` / `redoStack` 各 200 层，快照只存结构化模型，媒体大对象以 directMedia 引用/存储 key 入快照）；`undo() / redo() / push(state)`；重做栈在 push 时清空。
3. 新建 `web/src/lib/timeline/editor-store.ts`：命令单队列（串行 apply）、`dispatch(cmd)` 入口、快照撤销接入、1.5s 防抖保存（localforage user-scope + 后端项目接口；写失败必须上报，不吞错）。
4. 手势 echo：在 `editor-store` 提供 `previewGesture(state)` 只读预演（拖拽/裁剪位置），`commitGesture(cmd)` 提交唯一命令；撤销粒度是手势。
5. 锁定滤镜图计划：`timeline-to-ffmpeg.ts` 的 `buildTimelineRenderPlan` 标注为协议模块（新增 JSDoc：插件不得绕过）；`timeline-export.ts` 保持降级路径。**render 层按 §3.1 契约处理 `nodeId` 悬空引用**：可降级（跳过 + 提示）与不可解析（报错 + 定位 clip）两条路径，禁止静默错误渲染。

产出：任意编辑操作可回放为命令序列；撤销/重做可用；插件可注册自定义 op。
验证：命令黄金文件测试（§7.1）；既有字幕一期功能经命令层无回归。

### M3 editor 预设插件（UI 与能力插件化）

目标：7 个核心预设插件全部以 v2 清单 + 插槽贡献形态实现（AI 助手插件在 M6，见 ADR-0007），宿主核心不再新增编辑器 UI 硬编码分支。

任务（每个插件 = `builtin/editor/<name>.ts`，`manifest.apiVersion = "yingce.plugin/v2"`，`preset: true`，`defaultEnabled: true`）：

1. `editor-timeline-panel.ts`：`createTimelinePanel` → 注册 `timeline-panel` 插槽（dock: bottom）；轨道/片段渲染、拖拽移动、裁剪手柄、吸附复用 `timeline-snap`、右键菜单；组件只消费状态机视图并派发命令。
2. `editor-preview-monitor.ts`：`createPreviewRenderer` → 注册 `preview-renderer`；`<video>` 裁剪/缩放/透明度/音量 + CSS 滤镜 + canvas 近似合成（ADR-0003 近似层）；交互真相非导出像素。
3. `editor-inspector.ts`：`createInspector` → 注册 `inspector-panel`（dock: right）；选中片段属性编辑（起止、音量、变速、字幕文本），全部经命令提交。
4. `editor-asset-ingest.ts`：`createAssetIngest` → 注册 `asset-ingest`；素材库/项目资产/本地上传入轨为 directMedia，复用 `@/services/` 文件与媒体层。
5. `editor-subtitle-tools.ts`：`createSubtitleTool` → 注册 `subtitle-tool`；SRT 导入导出（`srt-parser` / `srt-resegment`）、AI 高亮（`subtitle-highlight-*`）、批量样式；**「从节点重建字幕片段」命令**（按 §3.1 字幕快照契约：把节点 `subtitleEntries` 显式同步为时间线字幕 clip，替换过期快照）。
6. `editor-transcription.ts`：`createTranscriptionProvider` → 注册 `transcription-provider`；提交后端转写任务（§M4 任务协议客户端）、进度/重试 UI、结果写回字幕轨道。
7. `editor-export.ts`：`createExportRenderer` → 注册 `export-renderer`；导出面板（分辨率/格式/字幕烧录开关）；默认执行器走后端 ffmpeg 任务，降级走 `exportTimelineToMp4`（wasm）；两者吃同一 `buildTimelineRenderPlan` 计划。

宿主接线：

- `detail.tsx`：`DetailView` 联合类型加 `"editor"`，`views` 数组新增「剪辑」项（常驻，与侧边栏「短剧创作」入口一致，不随功能开关过滤）；编辑器视图页壳复用三段式布局（`../design/workspace-shell-design.mdx`），从 `editor-slot-registry` 渲染各插槽。
- `application.tsx`：无需新增路由；仅确保编辑器视图页壳挂载后正确初始化 `editor-slot-registry` 渲染；无插槽注册时显示空态（插件被停用时不渲染对应区域）。
- 页面壳只做布局与插槽聚合，不含编辑器业务分支。

产出：编辑器全部 UI 由插件贡献；停用某插件即停用对应区域。
验证：浏览器冒烟（§7.4）；每个插件独立可停用/启用。

### M4 后端任务（转写 + 导出）

目标：转写与 ffmpeg 导出作为后端任务，复用任务队列与配额；前端协议不变。

任务：

1. 任务类型扩展：`backend/internal/model/models_task.go` 增加任务类型 `transcription` 与 `render`（沿用现有任务状态机：pending/running/success/failed/canceled）。
2. 新建 `backend/internal/service/transcription/`：ASR provider 接口（`Transcribe(ctx, audioRef, opts) (segments, error)`）+ 两个实现（whisper.cpp 本地、云 ASR 预留）；service 层负责校验归属、配额、任务编排、结果 SRT 落库；SSRF/私网放行遵循 AGENTS.md 第 5 节。
3. 新建 `backend/internal/service/render/`：ffmpeg 导出任务，消费前端传来的 `TimelineRenderPlan`（`buildTimelineRenderPlan` 产物，前端序列化上传）；按 plan.steps 执行（trim → gap → concat → subtitle → burn）；产物写入资源存储。
4. handler：`/api/timeline/transcription`（提交/查询/取消）、`/api/timeline/render`（提交/查询/取消），响应统一 `{ code, data, msg }`；写路径强校验归属与配额。
5. 前端任务客户端：`web/src/services/api/timeline-tasks.ts`（经 `apiClient`，复用 `request<T>`；不新建 axios 实例），`editor-transcription` 与 `editor-export` 插件消费。
6. 数据库字段/表变化同步 `docs/content/docs/backend/backend-database.mdx`（AGENTS.md 第 5 节义务）。

产出：转写/导出为异步任务，浏览器 wasm 仅为无后端降级。
验证：后端 `cd backend && go test ./...`；任务冒烟路径（提交→轮询→产物可访问）。

### M5 权限执行校验与测试收尾

目标：权限从"声明"变为"执行"；黄金文件与浏览器验证收口；文档同步。

任务：

1. 权限执行校验：新建 `web/src/lib/plugins/plugin-permission-check.ts`，宿主 API 调用点（命令入队、转写提交、导出提交、素材读取、外部打开）统一走 `checkPermission(pluginId, permission)`，fail-closed（未声明 → 拒绝并报错；后续按 astravia 语义可扩展 warn+noop / 抛错三档，首版只做 fail-closed）。
2. 黄金文件：命令序列黄金文件（§7.1）、渲染计划黄金文件（§7.2）入库为测试夹具。
3. 浏览器验证清单执行（§7.4），关键路由/明暗主题/滚动/空态/核心交互逐项记录。
4. 文档同步：`docs/content/docs/progress/todo.mdx` 更新待办；已实现未确认项写入 `docs/content/docs/progress/pending-test.mdx`；功能清单 `docs/content/docs/overview/features.mdx` 补编辑器插件化条目。

产出：无权限插件调用编辑器 API 被拒绝且界面给出明确提示。
验证：权限拒绝路径测试（§7.3）；全量构建通过。

### M6 AI 编辑交互（对话式剪辑，ADR-0007）

目标：AI 作为时间线一等公民编辑者——自然语言 → 受约束命令 JSON → 命令队列执行，与人编辑共享撤销栈；接入既有模型渠道与画布聊天 UI 模式。

任务：

1. 新建 `web/src/lib/timeline/ai-command-schema.ts`：per-op 命令 JSON schema（与 `editor-commands.ts` handler 同源维护），`aiCommandSchemaVersion` 版本化；新增 `timeline-summary.ts`：时间线结构化精简摘要（轨道/片段/时长/关键属性，不含媒体二进制），作为 AI 上下文。
2. 新建 `web/src/lib/plugins/builtin/editor/editor-ai-assistant.ts`：预设插件（`ai-assistant` 贡献类型 + `ai.text` / `timeline.read` / `timeline.command` 权限），对话面板插槽（right），复用画布 agent 聊天 UI 交互模式（流式输出/可停止），不移植画布会话协议。
3. AI 命令执行链路：LLM 输出 `{ commands, reasoning }` → schema 校验（fail-closed，任一失败整批拒绝并回填错误供 AI 自纠）→ 权限校验 → 入队；≤3 条直接执行，>3 条或涉及删除/整体重排先展示 diff 预览待确认（ADR-0007 执行语义）。
4. AI 只读问答：`timeline.read` 分析对话（节奏/剪辑建议），不产生命令；`timeline.command` 未声明时写操作被拒。
5. 聚合入口：AI 面板可调起转写（ADR-0004）、AI 字幕高亮（既有 `subtitle-highlight-*`）、AI 素材入轨（生成链路 + asset-ingest），各自协议不变。

产出：对话式剪辑可用；AI 命令与人命令同撤销栈、同黄金文件测试。
验证：AI 命令 schema 校验测试（§7.1 扩展）；浏览器对话冒烟（§7.4 扩展）。

### M 阶段待定项（画布 / 短剧深化关联）

不阻塞首版，实现中按需决策：

1. **章节 → 时间线导航**：画布节点有 `chapterId`（`canvas.ts` metadata），时间线 clip 目前**没有** `chapterId`。若「从分镜入轨」时把章节信息带入 clip（`timeline-build.ts` 扩展），编辑器可提供「按章节查看 / 定位时间线」，直接呼应短剧章节结构。决策点：clip 模型加 `chapterId` 字段 vs 通过 `nodeId` 反查节点章节。
2. **成片 → 交付**：当前导出走 `onCreateAssembledNode` 回画布；可顺带把 MP4 落入项目资产 / 交付物，接进 overview「交付与打包」流程（`productionSteps` 末步）。决策点：导出产物写入资产库 vs 独立交付物表。

## 5. 接口草案

### 5.1 v2 清单扩展（`plugin-types.ts` 增量）

```ts
export const PLUGIN_API_VERSION_V2 = "yingce.plugin/v2" as const;

export type EditorContributionKind =
    | "timeline-panel" | "preview-renderer" | "export-renderer"
    | "transcription-provider" | "subtitle-tool" | "inspector-panel"
    | "asset-ingest" | "shortcut-scope";

export type PluginPermissionV2 =
    | PluginPermission
    | "timeline.read" | "timeline.write" | "timeline.command"
    | "transcription.run" | "export.run";

// PluginManifest 增量字段（v2 可选）
//   preset?: boolean            // 预设插件（随应用分发，默认启用，不可卸载删改）
//   defaultEnabled?: boolean    // 默认启用（preset 时恒 true）
//   apiVersion: "yingce.plugin/v1" | "yingce.plugin/v2"
```

### 5.2 UI 插槽注册（新建 `web/src/lib/plugins/editor-slot-registry.ts`）

```ts
export type EditorSlotDock = "bottom" | "right" | "left" | "center" | "fullscreen";

export type TimelinePanelSlot = {
    slotId: string; pluginId: string; order: number; dock: EditorSlotDock;
    component: React.ComponentType<TimelinePanelProps>;
};

export type PreviewRendererSlot = {
    slotId: string; pluginId: string; order: number;
    render: (ctx: PreviewRendererContext) => React.ReactNode;   // 浏览器原生近似渲染
};

export type ExportRendererSlot = {
    slotId: string; pluginId: string; order: number;
    // 消费 buildTimelineRenderPlan 产物；禁止插件内拼第二套滤镜串
    execute: (plan: TimelineRenderPlan, ctx: ExportContext) => Promise<ExportResult>;
    fallback?: boolean;   // true = wasm 降级执行器
};

export type TranscriptionProviderSlot = {
    slotId: string; pluginId: string; order: number;
    submit: (req: TranscriptionRequest, ctx: TranscriptionContext) => Promise<TaskHandle>;
};

export type SubtitleToolSlot = {
    slotId: string; pluginId: string; order: number; dock: EditorSlotDock;
    component: React.ComponentType<SubtitleToolProps>;
};

export type InspectorPanelSlot = {
    slotId: string; pluginId: string; order: number; dock: "right";
    component: React.ComponentType<InspectorProps>;
};

export type AssetIngestSlot = {
    slotId: string; pluginId: string; order: number; dock: "left" | "bottom";
    component: React.ComponentType<AssetIngestProps>;
};

// 注册 / 渲染 / 卸载
export function registerTimelinePanel(slot: TimelinePanelSlot): void;
export function registerPreviewRenderer(slot: PreviewRendererSlot): void;
export function registerExportRenderer(slot: ExportRendererSlot): void;
export function registerTranscriptionProvider(slot: TranscriptionProviderSlot): void;
export function registerSubtitleTool(slot: SubtitleToolSlot): void;
export function registerInspectorPanel(slot: InspectorPanelSlot): void;
export function registerAssetIngest(slot: AssetIngestSlot): void;
export function unregisterEditorSlots(pluginId: string): void;   // unregisterPlugin 联动
export function listEditorSlots(): EditorSlotIndex;               // 页面壳按 dock 渲染
```

### 5.3 命令协议（新建 `web/src/lib/timeline/editor-commands.ts`）

```ts
export type EditCommand = { op: string; payload: unknown };

export type CommandHandler = (state: TimelineProject, payload: unknown) => TimelineProject;

export function createEditorCommandRegistry(): {
    register: (op: string, handler: CommandHandler) => void;   // 插件经宿主 API 调用
    apply: (state: TimelineProject, cmd: EditCommand) => TimelineProject;  // 未知 op 抛错
    knownOps: () => string[];
};

// 手势 echo（editor-store 内）：previewGesture 只读预演，commitGesture 提交唯一命令
```

### 5.4 预设插件清单（`web/src/lib/plugins/builtin/editor/`）

| 文件 | 插槽 | 权限 | 依赖的宿主协议 |
| --- | --- | --- | --- |
| `editor-timeline-panel.ts` | timeline-panel (bottom) | timeline.read / timeline.write / timeline.command | 命令状态机、timeline-snap |
| `editor-preview-monitor.ts` | preview-renderer (center) | timeline.read / media.read | 近似渲染、directMedia 解析 |
| `editor-inspector.ts` | inspector-panel (right) | timeline.read / timeline.write | 命令状态机 |
| `editor-asset-ingest.ts` | asset-ingest (left) | asset.read / asset.search / asset.import / timeline.write | 素材服务、directMedia |
| `editor-subtitle-tools.ts` | subtitle-tool (right) | timeline.read / timeline.write / ai.text | srt-parser / srt-resegment / subtitle-highlight-* |
| `editor-transcription.ts` | transcription-provider | timeline.read / timeline.write / transcription.run | 后端任务协议（M4） |
| `editor-export.ts` | export-renderer | timeline.read / export.run / media.read | buildTimelineRenderPlan、后端 render 任务 / wasm 降级 |
| `editor-ai-assistant.ts` | ai-assistant (right) | ai.text / timeline.read / timeline.command | ai-command-schema、timeline-summary、模型渠道、命令队列（ADR-0007） |

### 5.5 后端任务协议（M4）

- 提交：`POST /api/timeline/transcription` `{ assetRef | clipRef, provider?, lang? }` → `{ taskId }`；查询 `GET /api/timeline/transcription/:taskId`；取消 `DELETE /api/timeline/transcription/:taskId`。
- 提交：`POST /api/timeline/render` `{ plan: TimelineRenderPlan, sources: TimelineRenderSource[], opts? }` → `{ taskId }`；查询/取消同构。
- 结果：转写任务返回 SRT（写回字幕轨道）；render 任务返回资源存储 key。
- 前端客户端：`web/src/services/api/timeline-tasks.ts`（`apiClient` / `request<T>`，AbortSignal 透传，轮询或 SSE 沿用既有任务约定）。

## 6. 文件规划

新建：

- `web/src/lib/plugins/editor-slot-registry.ts`
- `web/src/lib/plugins/plugin-permission-check.ts`
- `web/src/lib/timeline/editor-commands.ts`、`editor-history.ts`、`editor-store.ts`、`ai-command-schema.ts`、`timeline-summary.ts`
- `web/src/lib/plugins/builtin/editor/editor-timeline-panel.ts`、`editor-preview-monitor.ts`、`editor-inspector.ts`、`editor-asset-ingest.ts`、`editor-subtitle-tools.ts`、`editor-transcription.ts`、`editor-export.ts`、`editor-ai-assistant.ts`、`index.ts`
- `web/src/services/api/timeline-tasks.ts`
- `backend/internal/service/transcription/`、`backend/internal/service/render/`
- 测试：`web/src/lib/timeline/__tests__/editor-commands.test.ts`、`editor-history.test.ts`、`ai-command-schema.test.ts`、`timeline-summary.test.ts`、`render-plan.golden.test.ts`、`web/src/lib/plugins/__tests__/editor-slot-registry.test.ts`、`permission-check.test.ts`；夹具 `web/src/lib/timeline/__fixtures__/commands.golden.json`、`ai-commands.golden.json`、`render-plans.golden.json`

修改：

- `web/src/lib/plugins/plugin-types.ts`（v2 类型）、`plugin-registry.ts`（v2 分支 + 插槽联动）、`builtin/index.ts`（editor 预设入口）
- `web/src/application.tsx`（编辑器页面壳接线插槽；不新增业务分支）
- `backend/internal/model/models_task.go`（任务类型）、`backend/internal/handler/`（transcription/render handler）
- `docs/content/docs/backend/backend-database.mdx`（任务表变化）、`docs/content/docs/progress/todo.mdx`、`pending-test.mdx`、`overview/features.mdx`

## 7. 测试与验证策略

### 7.1 命令黄金文件

命令序列 → 期望状态快照的 JSON 夹具（`commands.golden.json`）：新增/移动/裁剪/分割/字幕编辑等命令逐个断言；插件自定义 op 的黄金文件由插件目录自带。回归时 `bun test` 比对夹具，防 reducer 漂移。

**扩展（M6 / ADR-0007）**：`ai-commands.golden.json` 存 AI 命令序列 → 状态快照；`ai-command-schema.test.ts` 校验合法/非法 payload（fail-closed：单条非法整批拒绝、错误信息回填格式）。AI 命令与人命令共用同一黄金文件体系，防止 schema 与 handler 漂移。

### 7.2 渲染计划黄金文件

`buildTimelineRenderPlan` 对代表性时间线（多轨/间隙/字幕/转场降级）输出计划快照；任何新增效果必须更新夹具而非绕过测试——这是"单一滤镜图计划"的机器闸门。

### 7.3 权限拒绝路径

单元测试：清单未声明 `timeline.command` 的插件调用命令入队被拒；`transcription.run` 未声明提交转写被拒；界面提示明确（不静默）。

### 7.4 浏览器冒烟清单

- 编辑器路由加载：三段式布局渲染，各插槽区域来自插件注册表。
- 停用某插件（如 preview-monitor）→ 预览区域空态，其余区域正常。
- 拖拽移动/裁剪：echo 预演流畅，release 后命令入队、撤销一次回退手势粒度。
- 明暗主题切换、窄屏降级（dock 折叠）。
- 转写：提交任务 → 进度 → SRT 写回字幕轨道；导出：后端任务产物可下载；无后端时 wasm 降级可导出。
- 快捷键作用域（shortcut-scope 插槽）不与画布快捷键冲突。
- AI 对话冒烟：对话面板打开/流式输出/停止；自然语言 → 命令执行 → 撤销回退；非法命令（schema 错/权限不足）整批拒绝并回填错误；批量改动（>3 条）显示 diff 预览待确认。

### 7.5 验证纪律

按 AGENTS.md 第 8 节选择最小充分命令并如实记录：前端 `cd web && bun run build`、专项 `bun test ...`；后端 `cd backend && go test ./...`；无法浏览器验证时说明替代依据，不把静态阅读写成运行验证。

## 8. 风险、依赖与未决问题

- **v1/v2 并存**：`assertManifest` 双版本分支是首个兼容点；回归范围限现有 5 个 builtin 插件，风险可控。M1 结束前必须跑通全部既有插件注册。
- **快照撤销内存**：快照只存结构化模型，directMedia 引用入快照不复制二进制；200 层为上限，超限时丢弃最旧快照（与 ADR-0002 一致）。
- **转写模型部署**：whisper.cpp 需要后端机器与模型权重；provider 接口先行、首版可只接 whisper.cpp，云 ASR 为预留接口。模型下载与部署路径在 M4 单独确认（不影响前端协议）。
- **插件间耦合**：editor 预设插件只允许依赖宿主协议与共享纯函数库，禁止插件互相 import（评审时检查 import 图）。
- **已确认**：路由挂载为**项目内视图**——复用 `/projects/:projectId/:view` 通配（`router.tsx` 第 153 行已存在），`DetailView` 加 `"editor"`，不新增顶层路由、不采用画布内嵌面板；与「分镜制作」「项目画布」同级 tab。
- **未决**：预览近似与导出像素的级差表（哪些效果允许差、差多少）在 M3 评审时定稿。

- **画布 ↔ 时间线引用耦合**：`nodeId` 悬空引用（节点删除）与字幕快照漂移（节点字幕变更不回写）是真实存在的层间耦合。约束见 §3.1：render 层降级/报错二分、字幕单向显式同步；M2/M3 按契约实现。剩余风险是节点删除后用户需手动清理悬空 clip（右键「定位来源/移除」缓解，列入后续迭代）。

## 9. 交付前检查清单

- [ ] 改动聚焦：未动 v1 插件与画布/生成链路既有行为。
- [ ] 调用方与类型同步：v2 清单、插槽类型、命令协议三处类型一致。
- [ ] 错误/权限/数据归属完整：写路径强校验、fail-closed、配额与归属不遗漏。
- [ ] 文档同步：ADR、backend-database、todo、pending-test、features 一致。
- [ ] 验证如实：黄金文件 + 浏览器冒烟记录在案，未把静态阅读写成运行验证。
- [ ] 未留下密钥/本地数据。
