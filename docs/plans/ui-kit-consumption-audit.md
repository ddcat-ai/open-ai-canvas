# UI-kit 消费一致性审计报告（页面 × 管理后台）

> 审计时间：2026-09-06　｜　审计范围：`web/src`（660 个 ts/tsx 文件全量静态扫描；其中 `pages/` 树 146 个文件按页面域逐一核对）
> 审计方法：按文件解析对 `antd` 与 `@/components/ui/*` 的 import，做"同角色残留对比"——即 ui 组件库已提供对标族的控件（Switch / Checkbox / Segmented / Select / Tooltip / Empty / Alert / Badge / 状态 Tag），页面仍直接 import 原生 antd 同款控件的，判为样式不一致风险点。
> 判定依据：`docs/adr/0008-ui-component-layer-antd-replacement.md`、`docs/plans/ui-kit-rollout-plan.mdx`（B1–B5 批次与 2026-09-05 执行状态）、`web/src/components/ui/README.md`。文档声明均与本次代码扫描结果交叉核对。

## 一、结论速览

1. **文档声明的归零项属实**：antd `Empty`（0 处）、`Badge`（0 处）、状态语义 `Tag`（已清零）、`Alert`（全库仅剩 1 处 = `pages/projects/detail.tsx` 的项目已归档 banner，与 rollout 日志"唯一保留 detail.tsx 归档 banner"完全一致）。ui kit 的 EmptyState / Callout / StatusBadge 确实接过了这些角色。
2. **页面与后台确实存在"未统一消费"的同角色双观感**，集中在 **5 个族**，按风险排序：
   - **Select**：全库 53 个文件仍用 antd Select（后台 19、主界面页面 17、画布组件 10、共享组件 7），而 ui `select` 仅被 1 个文件消费；
   - **Tooltip**：全库 29 个文件仍用 antd Tooltip（画布组件 16 为主），ui `tooltip` 仅 3 个文件消费；
   - **Segmented**：画布组件 11 处 antd Segmented，与设置页/后台已铺开的 ui `SegmentedControl`（14 文件）并存；
   - **Switch**：画布浮层/节点面板 8 处 + 图片/视频设置面板 2 处仍是 antd Switch，与 ui `switch`（29 文件，主要分布在设置页与后台）并存；
   - **Checkbox**：`canvas-script-node.tsx` 1 处 antd `Checkbox.Group`（列显隐选择器），ui `checkbox` 已在后台 2 个文件消费。
3. **主界面页面区（`main/*`）与后台区（`admin/*`）都有页面完全零消费 ui**，其中部分零消费且零同角色残留（如登录注册 `auth/`），是通过 antd 全局 token 主题统一观感的；部分则存在可直接迁移的同角色残留（如 `create/` 的 antd Tooltip、`canvas/index.tsx` 的朴素 Select）。
4. **结构性判断（与 rollout 计划一致）**：剩余 16 处 `Tag` 全部为分类 chip/彩标（无状态徽章语义），属有意保留，不判为不一致；`Spin` 4 处无 ui 对标，仅记录。ui kit 尚未提供的 Modal/Form/Table/Drawer/Input 等原生控件不在本次同角色判定范围。

## 二、判定映射表

| antd 控件 | 对标 ui 族 | 现状（全库 import 文件数） |
| --- | --- | --- |
| `Switch` | `ui/base/switch` | antd 10 处 vs ui 29 文件 |
| `Checkbox(+Group)` | `ui/base/checkbox` | antd 1 处 vs ui 2 文件 |
| `Segmented` | `ui/base/segmented-control` | antd 11 处 vs ui 14 文件 |
| `Select` | `ui/base/select`（单选壳；搜索/多选未覆盖） | antd 53 处 vs ui 1 文件 |
| `Tooltip` | `ui/base/tooltip` | antd 29 处 vs ui 3 文件 |
| `Empty` | `ui/product/empty-state` | antd **0** 处 vs ui 11 文件（已归零 ✓） |
| `Alert` | `ui/product/callout` | antd **1** 处（detail.tsx 归档 banner，有意保留）vs ui 9 文件 |
| `Badge` | `ui/base/badges(StatusBadge)` | antd **0** 处 vs ui 13 文件（已归零 ✓） |
| `Tag`（状态语义） | `ui/base/badges` | 状态场景已清零；剩余 16 处均为分类 chips（有意保留） |
| `Spin` | （无 ui 对标） | 4 处，仅信息项 |

## 三、页面域 × ui 消费矩阵（pages 树，146 文件）

图例：`ui=` 直接 import ui 族的文件数；`ui族` 该区用到的 ui 族；`残留` 该区 antd 同角色 import 计数（"—"=无）。

### 主界面页面区（main/*，106 文件）

| 页面域 | 文件 | ui | ui 族 | 同角色残留 |
| --- | --- | --- | --- | --- |
| auth（登录/注册） | 4 | 0 | — | — |
| assets（素材库） | 4 | 2 | IconButton/ToolButton, StatusBadge | Select×2, Tag×1(chip) |
| canvas（创作画布页） | 43 | 3 | Kbd, fx | Select×1(朴素), Tag×2(chip) |
| create（新建） | 4 | 0 | — | Tooltip×1, Spin×1 |
| dev | 2 | 1 | StatusBadge, Switch | — |
| not-found / route-error | 2 | 2 | fx | — |
| plugins（插件中心） | 5 | 2 | EmptyState, IconButton/ToolButton, Switch | Select×1, Tag×1(chip), Spin×1 |
| projects（项目管理） | 20 | 5 | Callout, EmptyState, SegmentedControl, StatusBadge | Select×4, Tooltip×3, Alert×1(有意保留) |
| settings（用户设置） | 9 | 6 | Callout, SegmentedControl, Select, StatusBadge, Switch | Select×5, Tooltip×1, Tag×2(chip) |
| skills（技能中心） | 5 | 3 | SegmentedControl, Switch | Select×3, Tooltip×2 |
| tasks（任务中心） | 6 | 4 | IconButton/ToolButton, SegmentedControl, Switch, Tooltip | Select×1 |
| wallet（钱包） | 1 | 1 | SegmentedControl | Tag×1(chip) |
| test-voice-recording | 1 | 0 | — | — |

### 管理后台区（admin/*，40 文件）

| 页面域 | 文件 | ui | ui 族 | 同角色残留 |
| --- | --- | --- | --- | --- |
| channels（渠道管理） | 1 | 1 | Switch | Select×1 |
| components（后台共享面板） | 15 | 8 | Checkbox, EmptyState, IconButton/ToolButton, SegmentedControl, StatusBadge, Switch, fx | Select×8, Tooltip×2, Tag×1(chip) |
| logical-models（逻辑模型） | 2 | 2 | Callout, StatusBadge, Switch | Select×2, Tag×1(chip) |
| logs（操作日志） | 1 | 1 | IconButton/ToolButton | Select×1 |
| payments（账单） | 1 | 1 | Callout, Switch | Select×1 |
| plugins（后台插件） | 1 | 1 | Switch | Select×1 |
| redemption-codes（兑换码） | 1 | 0 | — | — |
| settings（后台设置，9 文件） | 9 | 6 | IconButton/ToolButton, SegmentedControl, Switch, Tooltip | Select×2 |
| storyboard-prompts | 1 | 1 | Callout, StatusBadge | Select×1 |
| users（用户管理） | 4 | 1 | Checkbox | Select×2 |
| 非页面文件（context/route-pages/index/lib） | 4 | 0 | — | — |

### 零消费 ui 的页面（需重点关注）

| 页面 | 说明 | 风险 |
| --- | --- | --- |
| `main/auth`（登录/注册/找回） | 0 ui、0 残留 | 低：表单/命令类控件 ui 未提供对标，靠 antd token 主题统一 |
| `main/create` | 0 ui，残留 antd Tooltip×1 | **中**：ui tooltip 已可用，直接可迁移 |
| `admin/redemption-codes` | 文件本身 0 ui 0 残留 | 低：实际 UI 由 `admin/components/*`（8/15 文件消费 ui）渲染，属间接继承 |
| `main/canvas/index.tsx` | 残留朴素 Select×1 | 中：画布主工作区大量 UI 在 `components/canvas/*`，见下 |

## 四、同角色残留明细（含组件树，供整改引用）

### 1. Select — 53 处（ui select 仅 1 文件消费）

- 分布：后台页 19、主界面页面 17、画布组件 10、共享组件 7。
- 用法分类（pages 树 36 处）：**24 处带 `mode=multiple/tags` 或 `showSearch`**（ui 单选壳不覆盖，属已知能力缺口，需 ComboBox/多选落地后才能替换）；**12 处为朴素单选**，是可直接评估切换 ui `select` 的候选：
  `admin/components/email-settings-panel.tsx`、`admin/settings/components/skin-theme-editor.tsx`、`admin/settings/storage-settings-page.tsx`、`admin/users/users-drawer.tsx`、`pages/canvas/index.tsx`、`pages/projects/detail/canvases.tsx`、`pages/projects/detail/settings.tsx`、`pages/settings/diagnostics-panel.tsx`、`pages/settings/index.tsx`、`pages/settings/prompt-preferences-pane.tsx`、`pages/skills/skill-editor-drawer.tsx`、`pages/skills/skill-install-modal.tsx`
- 其余代表性文件：`pages/admin/components/analytics-panel.tsx`、`admin/users/users-panel.tsx`、`pages/settings/channel-settings-pane.tsx`（mode 多选）、`pages/tasks/index.tsx`（showSearch）等。

### 2. Tooltip — 29 处（ui tooltip 仅 3 文件消费）

- 画布组件 16：`components/canvas/canvas-agent-chat-ui.tsx`、`canvas-config-node-panel.tsx`、`canvas-toolbar.tsx` 系列、`director/*` 等；
- 主界面页面 7：`pages/create/index.tsx`、`pages/projects/detail.tsx`、`pages/projects/detail/canvases.tsx`、`pages/projects/detail/chapters.tsx`、`pages/settings/channel-settings-pane.tsx`、`pages/skills/index.tsx`、`pages/skills/skill-detail-drawer.tsx`；
- 共享组件 4：`channel-headers-editor.tsx`、`conversation/voice-recording-*.tsx`×2、`workflow-field-mapping-editor.tsx`；
- 后台 2：`pages/admin/components/admin-shell.tsx`、`analytics-panel.tsx`。
- 结论：ui `tooltip` 已可覆盖 help/说明类场景，属**最高性价比迁移项**。

### 3. Segmented — 11 处，全部在画布组件树

`canvas-appearance-controls.tsx`、`canvas-assistant-panel.tsx`、`canvas-config-node-panel.tsx`、`canvas-local-agent-panel.tsx`、`canvas-node-angle-dialog.tsx`、`canvas-node-upscale-dialog.tsx`、`canvas-script-node.tsx`、`canvas-subtitle-dialog.tsx`、`canvas-video-segment-dialog.tsx`、`portrait-clearance/portrait-clearance-modal.tsx`、`style-profile-editor-modal.tsx`。

- 同一角色：用户设置页与后台已用 ui `SegmentedControl`（14 文件）。**画布面板控件是"两套分段控件观感"最集中的区域。**

### 4. Switch — 10 处，全部在 pages 树外

画布 8：`canvas-agent-panel-chrome.tsx`、`canvas-config-node-panel.tsx`、`canvas-subtitle-dialog.tsx`、`canvas-toolbar.tsx`、`director/canvas-director-workbench.tsx`、`portrait-clearance/portrait-clearance-modal.tsx`、`style-asset-binding-modal.tsx`、`toolbars/toolbar-settings-modal.tsx`；
共享 2：`components/image-settings-panel.tsx`、`components/video-settings-panel.tsx`。

- 同一角色：ui `switch` 已消费 29 文件（后台 15、主界面 8、共享 6）。开关控件同页面混用观感差异集中在画布浮层/设置面板。

### 5. Checkbox — 1 处

`components/canvas/canvas-script-node.tsx` 的 `Checkbox.Group`（脚本列显隐选择）。ui `checkbox` 已在后台 2 个文件消费，ui 侧含 CheckboxGroup 时可直接迁移。

### 6. 有意保留 / 信息项（不判为不一致）

- `Tag`×16（含画布 import 对话框、设置项、后台面板等）：抽查均为分类 chip/彩标，无状态语义；
- `Spin`×4：`pages/create/index.tsx`、`pages/plugins/eagle.tsx`、`components/canvas/canvas-share-modal.tsx`、`components/conversation/voice-recording-inline.tsx`——ui 暂无 loading 对标（loading-state 若立项需同步处理）；
- `Alert`×1：`pages/projects/detail.tsx` 归档 banner（有意保留）。

## 五、与 rollout 计划执行状态的一致性核对

| rollout 日志声明（2026-09-05） | 本次扫描结果 | 一致 |
| --- | --- | --- |
| AntD Empty 全量归零（12 处） | 全库 0 处 | ✓ |
| Alert → Callout 全量归零（18 处，唯一保留 detail.tsx 归档 banner） | 全库仅 detail.tsx 1 处（已核实为"项目已归档"banner） | ✓ |
| Tag 状态徽章 → StatusBadge 清零（22 处） | 剩余 16 处均为 chips | ✓ |
| Badge 全库零使用 | 0 处 | ✓ |
| Segmented 结构性保留 | 11 处全在画布组件；但 ui SegmentedControl 已 14 文件在用 | ⚠ 双实现并存，需决策 |
| B3（Switch/Tooltip RAC 化）待推进 | ui switch/tooltip 已建成且部分页面提前接线，但 antd 版本残留 10/29 处 | ⚠ 与"待推进"一致 |
| ui select 仅单选壳 | 53 处 antd Select 中 24 处需搜索/多选能力，尚未可替换 | ✓（覆盖缺口） |

## 六、整改建议（按优先级）

### P0 — 同角色直接替换（ui 能力已具备，改动面小）

1. **Tooltip 迁移（29 处）**：ui `tooltip` 已覆盖 help 场景，按"共享组件 → 画布 → 页面"顺序替换，含 `admin-shell.tsx`、`pages/projects/detail*.tsx`、`pages/skills/*` 等。
2. **画布浮层 Switch 迁移（10 处）**：`canvas-toolbar.tsx`、`canvas-config-node-panel.tsx` 等 8 + 2 处换 ui `switch`，与设置/后台观感统一。
3. **朴素单选 Select 迁移（12 处）**：上列候选文件逐个评估语义后切 ui `select`（含 `pages/canvas/index.tsx`、`pages/settings/index.tsx` 等高频页面）。
4. **Checkbox.Group（1 处）**：ui checkbox 具备 Group 能力后迁移 `canvas-script-node.tsx`。

### P1 — 画布结构性决策（需产品/视觉确认）

5. **Segmented 双实现统一**：画布 11 处 antd Segmented vs 设置/后台 ui SegmentedControl。若统一到 ui，需先比对两者在画布高密度工具条中的尺寸/键盘行为差异，建议以画布外观控件为试点做视觉回归。
6. **Select 能力缺口补齐**：为 ui select 族补齐搜索（ComboBox）与多选模式，再批量替换剩余 24+ 处；在此之前后台 19 处与画布 10 处的搜索/多选下拉保持 antd 是**合理降级**，建议在 rollout 计划中显式标注"已知缺口"，避免被误判为回退。

### P2 — 一致性基建

7. **补 loading 对标**：`Spin` 4 处若 ui 立项 loading-state，同步替换。
8. **规则化防回退**：建议在 lint 层（如 eslint no-restricted-imports）禁止 pages/components 新代码直接 import `antd` 的 Switch/Segmented/Tooltip/Checkbox/Empty/Alert/Badge，防止归零项反弹。
9. **计划文档同步**：将本报告的分布数据与上述缺口标注回填 `docs/plans/ui-kit-rollout-plan.mdx` 的 B3/B4 批次范围。

## 附录：范围说明

- 本报告为 **import 级静态审计**，判定的是"页面是否直接继承 ui 族控件"；组合渲染路径（如 admin 页面经 `admin/components/*` 面板间接继承 ui）已在矩阵中单列说明。
- 视觉差异的最终确认仍需浏览器回归（antd 主题 token 与 ui 族同为 token 驱动，但控件结构/交互细节不同，如 RAC 的 Switch 与 antd Switch 的轨道尺寸与焦点态）。
- 审计脚本存放于 `.local/audit-ui-kit/`（git 忽略，可复跑）；仅本报告文件纳入版本库。
