# ADR-0006: 语音滤镜与项目模板——Concat 剩余缺口的补充决策

状态：已接受。日期：2026-09-01。来源：Concat 编辑器功能覆盖对照中的两个明确缺口，评估后决定引入。

## 背景

功能覆盖对照（实现规格 §0.4）识别出 Concat 有两个影策方案未覆盖的功能：

- **语音滤镜（Voice Filters）**：Concat 的招牌特色之一，对音频/人声做本地 DSP 处理（降噪、变声、均衡、回声等）。其前提是桌面应用可本地执行音频处理。
- **模板（Templates）**：Concat 提供保存项目为模板（`SaveTemplateDialog`）、模板缩略图（`TemplateThumb`）与从模板新建的流程；模板中心仍在 roadmap。

影策（Web + Go 服务端）此前将两者列为"明确不做"。本 ADR 评估引入方式，结论：**两者都引入，且必须走预设插件形态（ADR-0005），服从单一滤镜图计划约束（ADR-0003）**。

## 决策

### 语音滤镜：预设插件 `editor-audio-effects`

- 新增 `audio-effects` 贡献类型与 `audio.process` 权限；插件注册音频效果（音量、淡入淡出、均衡、回声、降噪、变速变调）。
- **预览近似走 Web Audio API**：`BiquadFilter` / `DynamicsCompressor` / `DelayNode` / `ConvolverNode` 等实时处理，交互真相，非导出像素。
- **导出真相走 ffmpeg 音频滤镜**：`afftdn`（降噪）/ `equalizer` / `aecho` / `acompressor` / `asetrate`+`aresample`（变速变调）等，作为 `buildTimelineRenderPlan` 的 **audio steps** 纳入单一滤镜图计划。
- **参数模型先行**：与视频滤镜同构——同一参数模型 + 预览/导出两份实现；渲染计划黄金文件（§7.2）增加音频夹具，禁止插件手写第二套滤镜串。
- 首版只做基础集（音量、淡入淡出、均衡、回声、简单降噪）；变声等复杂 DSP 留作插件扩展点。

### 模板：预设插件 `editor-template`

- 新增 `template-provider` 贡献类型与 `template.read` / `template.write` 权限。
- **模板 = 项目快照**：章节 + 画布 + 时间线（`TimelineProject`）+ 资产引用清单，**不含媒体二进制**；带 `templateSchemaVersion` 版本字段，随项目模型演进。
- "存为模板"从当前项目生成快照；"从模板新建"克隆快照为新项目（复用项目创建链路）。
- 模板存储为**服务端模板表**（归属用户/组织），支持列表 + 缩略图（复用 Concat `TemplateThumb` 概念）。
- **模板中心/市场不实现**：保留扩展点，待组织级模板需求出现时再评估（需组织/审核/订阅体系，超出当前范围）。

### 共同约束

- 两者都是预设插件：随应用分发、默认启用、不可卸载，权限自动授予（ADR-0005）。
- 权限执行校验（实施规格 M5 的 fail-closed）覆盖新增的 `audio.process` / `template.read` / `template.write`。
- 新增效果一律遵守"单一参数模型 + 预览近似 + 导出真相"三件套，音频不例外。

## 考虑过的方案

- **语音滤镜用浏览器 WASM DSP（RNBO/声码器级）**：实时性强、效果上限高，但包体大、实现复杂、与导出滤镜难同源；首版否决，保留为复杂 DSP 插件的未来选项。
- **语音滤镜直接用后端 ffmpeg 滤镜做预览**：网络延迟不可接受，违背"预览近似必须浏览器原生"（ADR-0003）；否决。
- **语音滤镜保持缺口（不做）**：Concat 对标的核心卖点之一，且音频效果是实现规格中成本最低的插件化增量；否决。
- **模板 = 复制整个项目含媒体二进制**：两份存储浪费、快照膨胀；否决，快照只存引用清单。
- **模板纯前端 localStorage**：不可跨设备/账号，与项目服务端持久化体系冲突；否决。
- **模板保持缺口（不做）**："从模板新建"是成片效率工具，直接衔接概览「剪辑成片」流程（§0.2）；否决。

## 后果

- `buildTimelineRenderPlan` 从纯视频计划扩展为 **A/V 计划**（video steps + audio steps）；ADR-0003 的"单一来源"约束覆盖音频，滤镜图计划的黄金文件增加音频夹具。
- 新增权限 `audio.process` / `template.read` / `template.write`，权限执行校验清单（M5）同步扩展。
- 模板快照与项目模型强耦合：`templateSchemaVersion` 必须随 `TimelineProject` / 画布模型演进，快照兼容测试纳入验证纪律。
- **优先级建议**：模板先于语音滤镜——模板依赖 M2 数据模型与项目创建链路即可落地（M3 后增量窗口），语音滤镜依赖 M3 预览渲染 + M4 导出管线的音频扩展（M4 后增量窗口）。两者均不阻塞 7 个核心预设插件的主线。
- 实现规格 §6 文件规划需追加：`builtin/editor/editor-audio-effects.ts`、`builtin/editor/editor-template.ts`、后端模板表迁移与 `template` handler、`timeline-to-ffmpeg.ts` 音频 steps 扩展。
