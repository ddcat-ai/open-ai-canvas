# ADR-0005: 编辑器预设插件架构——参考 astravia「万物皆可插件」改造

状态：已接受。日期：2026-09-01。来源：参考 astravia（`astravia`）插件体系理念，改造编辑器插件化。

## 背景

**astravia 的「万物皆可插件」理念**：所有能力（含界面）都是插件贡献，宿主核心只保留最小骨架。其实现要点：

- **统一插件形态**：`definePlugin` SDK + `plugin.json` 清单 + Module Federation 打包（`vettaPluginFederation`）；react/react-dom/SDK/主题 token 由宿主作为共享单例 external 化，插件不自带运行时。
- **系统插件（presets）与用户插件同构**：内置功能与第三方插件用**同一套 SDK 与清单**，仅分发方式（随 App 发布 vs zip 安装）与权限语义（系统插件自动全量授予且不可删改 vs 用户插件安装时逐项授予）不同。
- **UI 插槽**：workspace view、global slot、file preview、activity tab、input action、tool call slot、shortcut scope 等均为注册式插槽，内置界面与插件界面平等占位。
- **权限执行**：清单声明 + 宿主在 API 调用点校验（fail-closed / warn+noop / 抛错三档），未声明即不可见不可用。
- **能力贡献**：capability-runtime（hub/provider/registry/access）+ capability-sdk，插件以 provider 身份注册能力。

**影策现状（改造对象）**：现有 `yingce.plugin/v1`（`web/src/lib/plugins/`）只有**画布域**贡献（provider / workflow / canvas-node / transform / asset-source 等），存在结构性缺口：无 UI 插槽注册 API（surfaces 只是声明字段）、无编辑器任何贡献类型（时间线/预览/导出/转写没有插件入口）、无预设（系统）插件分发语义、内置插件是 `builtin/` 源码硬编码 import、权限只有清单字符串无宿主执行校验。对"编辑器插件化"这一目标不可直接支撑（即现状"不可理"之处）。

## 决策

- **编辑器全部 UI 与能力以插件贡献形态存在**，作为**预设插件（preset plugins）**随产品发布：时间线面板、预览监视器、右侧检查器、素材入轨、自动字幕（转写）面板、导出面板、字幕工具均为预设插件；默认启用、用户可停用、不可卸载删改，权限自动授予。
- **现有插件体系演进为 v2 形态（`yingce.plugin/v2`），补齐 astravia 式机制，editor 域作为首个完整消费方**：
  - 新增**UI 插槽注册 API**：`registerTimelinePanel` / `registerPreviewRenderer` / `registerExportRenderer` / `registerTranscriptionProvider` / `registerSubtitleTool` / `registerShortcutScope` 等；宿主按插槽渲染注册表，内置与第三方插件平等占位。
  - 新增**预设插件分发语义**：preset 插件随应用代码分发（沿用 `builtin/` 目录、语义化为 `builtin/editor/` 预设），与用户插件同清单同 SDK，仅权限/可删改性不同。
  - 新增**权限执行校验**：编辑命令、转写任务、导出任务、资源读取等宿主 API 调用点按清单校验，fail-closed；未声明不得触发。
  - 保持共享单例：react / react-dom / 时间线 SDK / 设计 token（`workspace-shell-design.mdx`）由宿主提供，插件不自带。
- **宿主最小核心保持不变**：时间线状态机（ADR-0001）、编辑命令队列与撤销（ADR-0002）、滤镜图计划（ADR-0003）、任务与配额协议（ADR-0004）是核心骨架，插件只允许在这些协议之上贡献 UI 与 handler，不得绕过命令协议改模型。
- 编辑器内置功能**不做特殊化**：迁入预设插件后与第三方插件走同一条贡献/校验/插槽路径，禁止在核心代码里写"编辑器专属硬编码分支"。

## 考虑过的方案

- **推倒重写插件体系**：现有 v1 已融入画布/生成/素材链路（application.tsx 静态注册 builtin、use-plugin-store 持久化启用态、后端 pluginStates），重写会破坏既有功能且无必要；否决，选择在同一代码库演进。
- **编辑器独立自建面板，不做插件化**：违背"插件化做成预设插件"的产品方向，且重复造轮子；否决。
- **照搬 astravia 包结构（SDK 独立包 + 独立市场）**：影策是单体 web 仓库，先以 v2 形态在 `web/src/lib/plugins/` 内演进，待出现真正的外部插件需求再抽 SDK/打包工具链；当前阶段预设插件足够。

## 后果

- 编辑器成为插件体系第一个完整闭环域：新增编辑器能力 = 写一个预设插件（清单 + 插槽贡献 + handler），不改宿主核心；宿主核心因插件而冻结，只演进协议。
- `yingce.plugin/v1` 升级为 v2：v1 字段（贡献类型/权限声明）保留兼容，新增插槽与分发字段；旧画布插件无需迁移即可继续运行，新增字段可选。
- 权限校验从"声明"变为"执行"：编辑器宿主 API 是第一个强制校验点，随后推广到画布/生成链路。
- 与 astravia 的差距被显式承认：暂无外部插件安装/市场/沙箱，预设插件是当前全部范围；待需要时按 astravia 的 SDK/打包/租户选择机制补齐。
- 插件数量与耦合风险：editor 预设插件按功能域拆分（面板/预览/导出/转写/字幕工具各一个），共享同一命令协议与滤镜图计划，避免插件间互相 import。
