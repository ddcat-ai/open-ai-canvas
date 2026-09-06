# Celadon UI 组件层

`web/src/components/ui/` 下的自研组件层。规范全文见仓库 `docs/plans/ui-design-system.mdx`（组件编写规范）与 `docs/plans/ui-kit-rollout-plan.mdx`（实施计划）、决策记录 `docs/adr/0008-ui-component-layer-antd-replacement.md`。本文是目录内速查版。

## 分层

| 层 | 目录 | 内容 |
| --- | --- | --- |
| base | `ui/base/` | 原语 + 基础件：`buttons/`、`badges/`、`kbd/`、`segmented-control/` 等 |
| product | `ui/product/` | 跨页面模式件：`empty-state/`、`callout/`、`loading-state/`、`section-card/`、`property-row/` |
| fx | `ui/fx/` | 特效件（原 `aceternity/*` 归位至此命名空间，引用随用随迁，不重写） |
| application | `ui/application/` | 产品块（P3 起）：agent-chat、notification-center、app-shell 等 |

> 视觉数值唯一权威源：`composio-brand-package`（仓库根同级兄弟目录），消费规则见实施计划 §2.4。

## 目录与导出

- 每"族"一目录（`base/badges/`），族内按文件拆变体；族级 `index.ts` 汇总导出（组件 + `XxxVariants` 类型）；**无全局 barrel**。
- 导入一律深路径 `@/components/ui/<layer>/<family>`；组件 `PascalCase`、文件 `kebab-case.tsx`、目录 `kebab-case/`。
- 变体用 cva（`class-variance-authority`）定义并从 `index.ts` 导出类型；`className` 经 `cn` 合并；ref 转发；根元素 `data-slot`。

## 硬性纪律

1. 样式只消费三层 token（`var(--*)` 或经 `@theme` 映射的工具类，如 `bg-surface`、`text-caption`、`text-status-success`）；**禁止裸 `text-[Npx]`/`rounded-[Npx]`/十六进制色值**。字号/行高用注册排版工具类或 token 引用。
2. 明暗自适应由 CSS 变量完成，不读皮肤 ID；持久切换 `aria-pressed` + `data-active`，保留 `:focus-visible`，尊重 `prefers-reduced-motion`。
3. 图标以 lucide 组件引用传入（`icon={Move}`），尺寸/颜色由宿主组件决定，禁止调用方传 icon className 改尺寸。
4. 组件头注释注明：用途、消费 token 组、对标/接管对象（AntD 组件或参考系统组件）、明暗差异要点。

## 进库门槛

新组件必须满足其一：① ≥2 处真实重复（PR 附 grep 证据）；② 隔离明确协议/交互契约。纯透传壳不进库。

## 当前族目录

- `base/kbd/` — Kbd（快捷键提示键帽）
- `base/badges/` — StatusBadge（状态点徽章；NodeTypeBadge 规划中）
- `base/buttons/` — IconButton / ToolButton（IconButton 含 ghost/default/outline/solid/danger 变体；ButtonGroup 规划中）
- `base/segmented-control/` — SegmentedControl（分段单选，thumb 滑动，泛型 + block/size）
- `base/checkbox/` — Checkbox + CheckboxGroup（原生 input + 自绘 glyph，checked/indeterminate/bare）
- `base/select/` — Select（RAC 单选壳，value/options/allowClear；多选/搜索 ComboBox 待建）
- `base/tooltip/` — Tooltip（RAC 浮层，AntD 8 向 placement 映射，title 空不渲染）
- `base/switch/` — Switch（button role=switch + data-state，checkedChildren 文本轨、loading、Form.Item 注入）
- `product/empty-state/` — EmptyState（空态占位）
- `product/callout/` — Callout（规划中，P0）
- `base/badges/` — StatusBadge（状态点徽章；NodeTypeBadge 规划中）
- `product/empty-state/` — EmptyState（空态占位）
- `product/callout/` — Callout（规划中，P0）
- `base/buttons/` — IconButton / ToolButton / ButtonGroup（规划中，P0）
