# 编辑器实施 Runbook（分步执行计划）

> 配套文档：[编辑器预设插件化实施规格](../plans/editor-preset-plugin-implementation.md)（目标架构与接口）与 [ADR-0001 ~ 0007](../adr/)（决策）。本文件只解决一个问题：**按什么顺序、以什么粒度动手，让每一步都可验证、可回退、看得见进度**。
>
> 状态：2026-09-01 制定。M0–M3 已完成并提交；M4.1（转写后端：本地 whisper.cpp HTTP，
> `CANVAS_WHISPER_BASE_URL`）e9d1b8ad/bf26ebb1、M4.2（渲染后端：`POST /api/timeline/renders`）
> 3f16d13b、M4.3（转写前端回写，真实任务替换 mock）fd5e8139 均已提交。

## 0. 执行原则（为什么这样拆）

一次性大爆炸实施的三个失败模式：**看不见进度**（写一堆类型层后毫无可见产物）、**无法定位回归**（一个 diff 里混了协议+UI+后端）、**无法回退**（改动面太大只能整体回滚）。本计划按三条铁律对抗：

1. **原子步**：每一步是一个可独立验证的变更，只动一个目标（类型 / 纯函数 / 单个插件 / 单个接线点），不混多个目标。
2. **验证门**：每步结束必须过最轻的验证门（typecheck / 专项测试 / 构建，按步标注），通过才能进下一步。验证命令以当前 `package.json` 为准（§4 速查）。
3. **垂直切片优先**：先让「最小可演示」跑通（M0 空壳 + M1.4 插槽链路 + M2 命令），让每一步都有浏览器可见或测试可断言的产物，再横向铺开功能面。

配套纪律：每步一个 commit（`feat(editor)` / `test(editor)` 等，见 AGENTS.md）；测试文件按项目实际约定放 `web/test/`（不是 `src/__tests__`，实施规格 §6 的路径为示意，落位时以本文件为准）；不覆盖、不回滚非本次变更。

## 1. 里程碑总览

| 里程碑 | 核心产出 | 演示 / 验收标准 | 依赖 |
|---|---|---|---|
| **M0 准备与基线** | 编辑器路由占位壳 + 概览流程入口 + 测试骨架 | 浏览器访问 `/projects/:id/editor` 看到占位页；概览页有「剪辑成片」步骤卡；`bun test test/editor-commands.test.ts` 可跑 | 无 |
| **M1 SDK v2** | v2 类型 + editor-slot-registry + 注册器兼容 + 插槽链路垂直切片 | 一个预设插件注册的 timeline-panel 插槽在占位页**真实渲染**出空面板（链路全通） | M0 |
| **M2 命令状态机** | editor-commands / editor-history / editor-store + 黄金文件测试 | 命令序列 → 状态快照黄金文件比对通过；撤销/重做 200 层测试通过；手势（移动/裁剪）echo→提交→撤销浏览器可操作 | M1 |
| **M3 预设插件** | 8 个 editor 插件逐个人轨 + detail.tsx 接线 | 编辑器三段式布局完整：时间线/预览/检查器/素材库/字幕/转写/导出逐区域可见可操作 | M2、M4（API 面） |
| **M4 后端任务** | 转写 + 渲染异步任务（服务端） | `go test ./...` 通过；前端任务客户端（创建/轮询/SSE）接 editor-transcription/export | M3 前需 API 面 |
| **M5 权限执行** | plugin-permission-check + fail-closed 接入 | permission-denied 测试通过；未声明 `timeline.command` 的插件写操作被拒；v1 插件权限语义不变 | M1、M3 |
| **M6 AI 编辑交互** | ai-command-schema + timeline-summary + editor-ai-assistant | AI 命令 schema 黄金文件测试通过；对话式剪辑浏览器冒烟（命令执行→撤销、非法命令整批拒绝、批量 diff 预览） | M2、M3、M5 |

## 2. 原子步明细

> 每步的「验证」是**最轻**的通过标准；「完成标准」是这一步真正做完的标志。

### M0 准备与基线

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M0.1 | `web/src/pages/projects/detail.tsx` | `DetailView` 加 `"editor"`；`views` 数组加「剪辑」项（常驻，插在「项目画布」后）；`editor` 视图渲染**占位页**（`editor-slot-registry` 为空时显示空态壳） | `bun run typecheck`；浏览器 `/projects/:id/editor` | tab 存在且可切换，占位页可见，其余 6 视图不受影响 |
| M0.2 | `web/src/pages/projects/detail/overview.tsx` | `productionSteps` 在「镜头视频」与「交付与打包」间插入「剪辑成片」步骤卡（`href: /projects/:id/editor`） | `bun run typecheck`；浏览器概览页 | 步骤卡可见可跳转；完成态 = 镜头视频齐备且已有时间线 |
| M0.3 | `web/test/editor-commands.test.ts`（新建骨架） | 空测试壳 + `bun test` 跑通；确认 `web/test/` 下测试基建 | `bun test test/editor-commands.test.ts` | 测试可运行（1 个占位断言通过） |

### M1 插件 SDK v2

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M1.1 | `web/src/lib/plugins/plugin-types.ts` | 加 `PLUGIN_API_VERSION "yingce.plugin/v2"` 类型、编辑器贡献类型（timeline-panel / preview-renderer / inspector / asset-ingest / subtitle-tool / transcription-provider / export-renderer / ai-assistant）、`timeline.*` / `export.run` / `ai.text` 权限字面量 | `bun run typecheck` | 纯类型增量，v1 类型零改动，既有代码零编译错误 |
| M1.2 | `web/src/lib/plugins/editor-slot-registry.ts`（新建） | 插槽注册表：`registerEditorSlot / unregisterEditorSlot / getEditorSlot`，按插槽类型 + 优先级排序，幂等注册 | 新增 `web/test/editor-slot-registry.test.ts`：注册/去重/排序/未知插槽 | 专项测试通过，无 UI 依赖（纯函数） |
| M1.3 | `web/src/lib/plugins/plugin-registry.ts` | 注册断言按 apiVersion 分支：v1 保持现状（kebab-case + ≥1 贡献）；v2 增加插槽贡献合法性校验；重复权限检查对 v2 生效 | `bun test test/canvas-node-registry.test.ts`（既有）全过 + 新增 v2 注册测试 | v1 插件行为完全不变；v2 注册/拒绝路径测试通过 |
| M1.4 | `web/src/lib/plugins/builtin/editor/editor-shell.ts`（临时）+ `web/src/lib/plugins/builtin/index.ts` | 垂直切片：`editor-shell` 预设插件注册 1 个 timeline-panel 插槽，占位页渲染该插槽 | `bun run typecheck`；浏览器 `/projects/:id/editor` | 插槽注册→渲染链路全通（空面板可见），**这是第一条垂直切片** |

### M2 命令状态机（纯函数层，黄金文件先行）

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M2.1 | `web/src/lib/timeline/editor-commands.ts` + `web/test/fixtures/commands.golden.json`（新建） | 核心 op：`addClip / moveClip / trimClip / splitClip / removeClip / setClipProperty / addSubtitle / removeSubtitle`；reducer 纯函数；黄金文件 = 命令序列→期望状态快照 | 新增 `web/test/editor-commands.test.ts`：逐命令断言 + 黄金文件比对 | 全部 op 通过；非法 payload 抛错路径覆盖 |
| M2.2 | `web/src/lib/timeline/editor-history.ts`（新建） | 快照撤销栈：200 层上限、undo/redo、undo 后新命令清空 redo | 新增 `web/test/editor-history.test.ts` | 边界测试通过（0 层/200 层/undo 后 redo 清空） |
| M2.3 | `web/src/lib/timeline/editor-store.ts`（新建） | zustand store：命令入队→reducer→新状态；echo 预演与 release 提交；1.5s 防抖保存（localforage + 后端项目接口）；保存失败向上抛 | 新增 `web/test/editor-store.test.ts`（mock 保存层） | 队列/防抖/失败传播测试通过 |
| M2.4 | 手势 echo 层（`web/src/components/editor/` 起步最小件） | 时间线区域支持移动、裁剪两个手势：拖动中本地 echo 预演，release 提交命令 | `bun run typecheck` + M2.1 测试 | 浏览器拖拽片段→撤销回退可操作（与画布拖拽不冲突，含 `data-canvas-no-zoom` 边界） |

### M3 预设插件（每步一个插件，每步后对应区域可见）

> 顺序按依赖：面板（数据展示）→ 预览 → 检查器（选中联动）→ 素材入轨（数据源）→ 字幕 → 转写/导出（依赖 M4 API 面，可先接 mock）。

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M3.1 | `web/src/lib/plugins/builtin/editor/editor-timeline-panel.ts` | `createTimelinePanel` → 注册 timeline-panel（bottom）；渲染时间线轨道区（读 editor-store，接 M2.4 手势） | typecheck + `bun test test/editor-*.test.ts` | 轨道/片段渲染、选中联动、撤销重做 UI |
| M3.2 | `web/src/lib/plugins/builtin/editor/editor-preview-monitor.ts` | `createPreviewMonitor` → 注册 preview-renderer（center）；浏览器原生近似渲染 + 播放头/时间码/帧步进 | typecheck；浏览器预览可播放 | 预览与时间线播放头同步（走 `buildTimelineRenderPlan` 预览近似路径） |
| M3.3 | `web/src/lib/plugins/builtin/editor/editor-inspector.ts` | `createInspector` → 注册 inspector（right）；选中片段属性（起止/音量/变速/滤镜参数模型） | typecheck；浏览器选中联动 | 属性编辑经 `setClipProperty` 命令入队，可撤销 |
| M3.4 | `web/src/lib/plugins/builtin/editor/editor-asset-ingest.ts` | `createAssetIngest` → 注册 asset-ingest（left）；角色资产/项目资产/本地上传 → 拖入时间线（`asset-ingest` 权限 + directMedia） | typecheck；浏览器拖拽入轨 | 素材入轨生成 clip（`addClip` 命令），复用现有资产层 |
| M3.5 | `web/src/lib/plugins/builtin/editor/editor-subtitle-tools.ts` | `createSubtitleTool` → 注册 subtitle-tool（right 折叠）；SRT 导入导出（复用 `srt-parser`/`srt-resegment`）、AI 高亮、批量样式、**「从节点重建字幕片段」命令（§3.1 快照契约）** | typecheck + 新增字幕命令测试 | SRT 往返一致；重建命令替换过期快照（单向显式同步） |
| M3.6 | `web/src/lib/plugins/builtin/editor/editor-transcription.ts` | `createTranscription` → 注册 transcription-provider；调 M4 转写任务（API 面未就绪时先 mock） | typecheck；浏览器触发转写→字幕入轨 | 转写结果落字幕轨道（ADR-0004 协议） |
| M3.7 | `web/src/lib/plugins/builtin/editor/editor-export.ts` | `createExporter` → 注册 export-renderer；导出面板 → `buildTimelineRenderPlan` + 后端渲染任务 / ffmpeg.wasm 降级 | typecheck；浏览器导出 MP4 | 导出走单一滤镜图计划；`nodeId` 悬空引用按 §3.1 降级/报错二分 |
| M3.8 | `web/src/pages/projects/detail.tsx` + `web/src/lib/plugins/builtin/editor/index.ts` + `web/src/lib/plugins/builtin/index.ts` | editor 视图从 `editor-slot-registry` 渲染全部插槽；8 个插件静态注册（含 editor-ai-assistant 的 M6 先注册占位贡献，M6 补实现） | `bun run build`（全量）+ 浏览器三段式布局 | 布局完整、停用插件显示空态、v1 插件不受影响 |

### M4 后端任务（服务端）

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M4.1 | `backend/`：`task_timeline.go` + `transcription_whisper.go`；路由 POST `/api/timeline/transcriptions`（注册于 `RegisterTaskRoutes`） | 转写异步任务：`CreateTimelineTranscriptionTask`（feature 门控/资源归属/可转写类型校验）配额入队（local/whisper.cpp，不走模型路由与计费）；worker 顶部按类型分叉 `processTimelineTranscription`，本地 whisper.cpp HTTP 转写，结果 `ResultJSON{segments,srt,language}` 落盘 | 转写相关单测 PASS（`go test ./internal/service/ ./internal/handler/`） | 未配置 `CANVAS_WHISPER_BASE_URL` 时任务明确失败并提示 |
| M4.2 | `backend/`：`task_render.go` + `timeline_render_plan.go`；路由 POST `/api/timeline/renders`（注册于 `RegisterTaskRoutes`） | 渲染任务：接收 v2 快照 → `buildRenderPlan`（含可渲染媒体校验）→ 服务端 ffmpeg 合成 → 产物入资源存储，`ResultJSON` 记 resourceId | render 单测 PASS | 60 分钟超时；`CANVAS_FFMPEG_PATH` 或 PATH |
| M4.3 | `web/src/services/api/timeline-tasks.ts` + `editor-transcription.tsx` | 转写任务客户端：创建 → `waitForGenerationTask` 轮询（25min）→ 结果 segments 映射 SrtEntry 写入字幕轨道（去 mock） | typecheck 通过 | 浏览器端到端：发任务→进度→字幕入轨待用户确认 |

### M5 权限执行（横切，fail-closed）

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M5.1 | `web/src/lib/plugins/plugin-permission-check.ts`（新建） | 纯函数：`checkPermission(plugin, required, context)`——声明缺失 → 拒绝（fail-closed）；`timeline.write` 拆分为 `timeline.read`/`timeline.command` 粒度 | 新增 `web/test/plugin-permission-check.test.ts`（10 用例，含 editor-shell 真实回归） | 缺失/越权/边界测试通过 ✅ |
| M5.2 | 接入执行路径：`editor-slot-registry` 渲染时 + 命令队列入口 + 模型调用 | 插槽渲染校验、命令入队校验、AI 命令校验（`timeline.command` 未声明 → 拒绝） | `bun test test/plugin-permission-check.test.ts test/editor-*.test.ts`；**v1 插件全量既有测试回归** | 未声明权限的写操作被拒；v1 插件行为零回归（权限语义不收紧存量） |
| M5.3 | **执行路径接入（边界说明）**：`web/src/pages/projects/detail/editor.tsx` SlotStack fail-closed 过滤（缺权限插槽 → 一行诊断条，不渲染）；`editor-shell` manifest 权限补全为 `timeline.read/timeline.command/export.run` | 命令队列入口与模型调用是**宿主全局命令**（M2 editor-commands 注册表，v1 语义）；v2 插件不代发宿主命令，仅贡献插槽。M5 权限域（timeline.*/export.run）只约束 v2 插件插槽贡献与后续 M6 AI 命令代发通道，宿主 UI 手势不受权限校验——与 ADR-0007「v1 权限语义一字不动」一致 | editor-shell 8 插槽真实回归可渲染；全量 bun test 无新增失败 | 缺权限插槽被拒渲染且有诊断；editor-shell 权限齐备可渲染全部 8 插槽 ✅ |

### M6 AI 编辑交互（ADR-0007）

| 步骤 | 改动文件 | 内容 | 验证 | 完成标准 |
|---|---|---|---|---|
| M6.1 | `web/src/lib/timeline/ai-command-schema.ts` + `web/test/fixtures/ai-commands.golden.json`（新建） | per-op 命令 JSON schema（与 M2.1 handler 同源维护）、`aiCommandSchemaVersion` 版本化；fail-closed 校验函数 | 新增 `web/test/ai-command-schema.test.ts` | 合法/非法 payload 全覆盖；单条非法整批拒绝；错误回填格式稳定 ✅（14 用例全绿；golden op 集与 EDITOR_COMMAND_OPS 黄金同步断言通过） |
| M6.2 | `web/src/lib/timeline/timeline-summary.ts`（新建） | 时间线结构化精简摘要（轨道/片段/时长/关键属性，不含媒体二进制） | 新增 `web/test/timeline-summary.test.ts` | 摘要确定性强（同输入同输出）；大对象排除 ✅（16 用例全绿；折叠上限/中文字幕统计/空态覆盖） |
| M6.3 | `web/src/lib/plugins/builtin/editor/editor-ai-assistant.ts` | AI 助手：对话面板（right，复用画布 agent 聊天 UI 交互模式）、命令执行链路（≤3 条直执行 / >3 条 diff 预览待确认）、只读问答（timeline.read） | typecheck + M6.1/M6.2 测试 + 浏览器冒烟 | 自然语言→命令→撤销全链路；非法命令回填错误；与画布会话上下文隔离 |

## 3. 依赖关系

```
M0（壳+骨架）──▶ M1（SDK v2 + 插槽链路）
                    │
                    ▼
              M2（命令状态机）
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   M4（后端任务）◀───（API 面先行，M3.6/3.7 可先 mock）
        │                       │
        ▼                       ▼
   M3（8 插件逐个）──▶ M5（权限执行，横切接入）
                    │
                    ▼
              M6（AI 编辑交互）
```

- M3.6 / M3.7 只依赖 M4 的 **API 面**（可先用 mock 接口），不必等 M4 全部完成。
- M5 横切：在 M3 完成后接入执行路径，避免在插件开发期被权限拦截干扰；但 M1.3 注册期就应声明权限字段。
- M6 依赖 M2（命令）、M3（面板）、M5（权限），最后做——它复用全部前置协议，是收尾验证。

## 4. 验证命令速查（以当前 package.json / go.mod 为准）

| 场景 | 命令 |
|---|---|
| 前端类型检查（每步） | `cd web && bun run typecheck` |
| 前端专项测试 | `cd web && bun test test/editor-commands.test.ts`（按文件替换） |
| 前端全量构建（M3.8 / 里程碑验收） | `cd web && bun run build`（含 build:bridge + tsc + vite build，较重，非每步跑） |
| 后端测试 | `cd backend && go test ./...` |
| 浏览器冒烟 | 对照实施规格 §7.4 清单（编辑器三路由、明暗主题、空态、快捷键不冲突） |

## 5. 每步通用完成检查

- [ ] diff 只含本步目标文件，无顺手改动
- [ ] 类型/调用方/文档同步（本步涉及的方案章节如有出入，当场修正）
- [ ] 错误与权限路径完整（不 `catch { return defaultValue }` 吞错）
- [ ] 验证如实记录（通过的命令 + 结果；不能浏览器验证时写明替代依据）
- [ ] 按 AGENTS.md 提交规范 commit（`feat(editor): ...` / `test(editor): ...`）

## 6. 高风险步与回退

| 步骤 | 风险 | 缓解 / 回退 |
|---|---|---|
| M1.3 注册器 v1/v2 分支 | 破坏既有 v1 插件（eagle/prompt-optimizer/workflows/portrait-clearance） | 分支隔离 + 既有测试全量回归；异常时 revert 该 commit（v1 路径零改动原则） |
| M3.8 detail.tsx 接线 | editor 视图影响其余 6 视图 | 视图按 id 分发，editor 分支独立渲染；回退 = revert M3.8，其余插件贡献无损 |
| M5.2 权限收紧 | v1 插件未声明新权限域被误拒 | **fail-closed 只针对新权限域**（timeline.* / export.run / ai.text），v1 既有权限语义一字不动；先加测试再接入 |
| M4.1 转写 provider | ~~部署路径未定~~ 已定：本地 whisper.cpp HTTP（`CANVAS_WHISPER_BASE_URL`），不接云 ASR | 语音数据不出本机；未配置仅影响转写任务（任务明确失败并提示） |
| M2.4 手势 echo 与画布拖拽冲突 | 时间线内拖拽与画布手势系统互扰 | 复用画布事件忽略选择器约定（modal/popover/dropdown）与 `data-canvas-no-zoom` 边界，冒烟清单含快捷键不冲突项 |

## 7. 里程碑验收顺序（推荐推进节奏）

1. 完成 M0+M1 → **第一次演示**：`/projects/:id/editor` 占位页有真实插槽渲染（证明插件链路成立）
2. 完成 M2 → **第二次演示**：纯命令驱动的可撤销时间线（无 UI 也能证明核心正确）
3. 完成 M3（含 M4 API 面）→ **第三次演示**：完整三段式编辑器可编辑可导出
4. 完成 M5+M6 → **第四次演示**：权限收紧 + 对话式剪辑（ADR-0007 完整落地）

每两次演示之间建议不超过一个里程碑；若一个里程碑内停滞超过 3 次同类失败，停下记录现象、已排除项与新假设（AGENTS.md §8），再切换路径。
