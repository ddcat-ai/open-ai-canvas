# ADR-0008: 自研 UI 组件层（Celadon UI）——吸收 dbx 组织纪律与 BoardUI 设计体系，分阶段替换 AntD

状态：已接受。日期：2026-09-05（初版）；2026-09-05（修订 1：吸收 BoardUI 设计体系）；2026-09-05（修订 2：视觉数值基准改为直接采用 composio-brand-package，见 D3 与「考虑过的方案」末条）。来源：`web/src/components/ui` 混乱整治；参考 dbx（`apps/desktop/src/components/ui`）、BoardUI（`boardui/`）的组织形态与设计纪律，以及 composio-brand-package（`../../../composio-brand-package/`，与 open-ai-canvas 同级的兄弟目录，设计 token 唯一数值权威源）；AntD 依赖面证据来自清点脚本复核（数字见「背景」）。

## 背景

`web/src/components/ui` 混乱、不统一的根因不是缺组件，而是缺一层有纪律的自研组件契约：

- `components/ui/` 目前几乎全是**一次性装饰件**（`aceternity/` 下的 comet-card、floating-dock、spotlight-surface 等，另有顶层 `animated-theme-toggler`、`announcement-content`、`dia-text-reveal`），深路径引用，无目录规范、无变体契约、无统一导出。
- 工作台高频交互件（画布工具条按钮、工具激活态、状态/节点徽章、空态、加载态、截断文本提示等）无归属，散落在 `pages/**` 与 `components/canvas/**` 各自私有实现，样式与键盘/无障碍行为漂移。
- 主题基建已成熟：`web/src/styles/globals.css`（约 892 行 CSS 变量声明）三层 token（Primitive→Semantic→Component），`--color-neutral-*` 色板、`--palette-node-*`、`--palette-status-*`、`--space-*`、`--fs-*` 字号梯度、`--r-*` 圆角梯度；`app-theme.ts` 统一管理 AntD 6 皮肤。缺组件层消费规范与产品级组件沉淀位置。
- AntD 依赖面：约 180/637 文件导入 AntD、41 个命名导入；Top：Button、App、Input、Modal、Select、Switch、Tooltip、Form、InputNumber、Tag、Segmented、Dropdown、Drawer、Skeleton、Popconfirm；低使用率但对等成本高：Table 5、Upload 3、DatePicker 2、Tree 2（2026-09-05 清点脚本）。
- 工具链：`cn`（clsx+tailwind-merge）、cva ^0.7、motion ^12.42、lucide-react ^1.25、antd ^6.5.1、tailwindcss ^4.3.3。

### 参考吸收（两套参考，结论不同）

**dbx**（shadcn-vue/reka-nova 风格，Vue SFC）：优秀项 = 目录即组件族 + `index.ts` barrel 导出 variants、cva 变体即公共 API、紧凑桌面密度档位、复合模式件下沉、语义状态色与自定义 radius。不足 = 目录半迁移（19 个组件目录旁仍散落 CustomContextMenu/ErrorBanner/LightDropdown 等 8 个顶层扁平遗留件）、token 粒度粗（单角色色值、交互态散在组件内）、无统一排版梯度、图标尺寸由调用方传 class、动效无统一纪律、无 agentic 界面沉淀。

**BoardUI**（`components/{base,application,foundations}`，agentic interfaces 设计系统）：用 React 19 + Tailwind v4 + `react-aria-components` + remixicon + motion 构建，语义 token 做"状态位 × 前景/文本/背景/边框"矩阵与复合排版工具类（`text-body-medium`、`text-caption-1-semibold`…），kbd/segmented/status-dot 等全部消费专用语义 token；基础组件族目录平铺（`buttons/` 内含 button/icon-button/close-button/button-group），每组件头部注释 Figma 源节点与明暗差异；`application/` 沉淀 agent-chat（composer/history/message）、agent-thinking、notification-center、app-shell、data-table 等 agentic 产品块；动效抽 `button-press-motion` 等工具类并统一尊重 reduced-motion；accent 支持运行时整体换肤，chart/status 各自成组。与影策"AI 影视短剧创作工作台 + canvas-agent"定位高度同构。

**composio-brand-package**（设计 token 权威包，**直接采用**）：`DESIGN.md`（角色化语义 token 表 + 组件配方 + Do/Don'ts）＋ `tokens.json`（W3C DTCG 机器可读）＋ `variables.css`/`theme.css`（CSS 变量 + Tailwind v4 @theme 落地）＋ `preview.html`。**本项目配色/字体/间距/圆角的数值一律以它为准**（近黑 #0f0f0f 底、电蓝 #0007cd 主色、hairline 分隔、Inter/等宽字体、完整字号与间距梯度），翻译进 globals.css 三层 token；品牌名/Logo/营销文案/abcDiatype 字体（无授权）不采用。

**综合结论**：视觉数值取 composio-brand-package（唯一权威源，直接采用）；契约形态取 dbx（barrel + cva variants）；设计深度取 BoardUI（语义状态矩阵、复合排版、accent/chart/status 分组、RAC 原语、动效纪律、agentic application 层）；三套参考都不搬代码。

## 决策

### D1 战略与执行（维持初版，补充地基阶段）

战略目标：组件层全自研（Celadon UI），最终不依赖 `antd`。执行：分阶段、按功能对等验收逐批替换（B1–B5，详见实施计划），禁止大爆炸与半替换观感并存。**新增一个"地基"前置项**：进入替换前先按 §D3 补齐 token 与契约（复合排版工具类、语义状态矩阵、accent/chart/status 分组），否则新组件会散落裸值。

### D2 分层结构（吸收 BoardUI 顶层分类）

`components/ui/` 按 `base / product / fx / application` 分层：

- `base/`：原语 + 基础件（buttons/、badges/、kbd/、segmented-control/…），职责同 dbx/BoardUI 的 base；
- `product/`：跨页面模式件（empty-state/、callout/、loading-state/、section-card/、property-row/…）；
- `fx/`：特效件（现 `aceternity/*` 归位命名空间，引用随用随迁，不重写）；
- `application/`：产品块（P3 起：agent-chat、notification-center、app-shell…，对齐 BoardUI application）。

AntD 皮肤在替换完成前继续由 `app-theme.ts` 统一管理。

### D3 token 义务（初版 D3 扩展，吸收 BoardUI 深度；数值以 composio-brand-package 为权威源）

**数值权威源**：配色/字体/间距/圆角数值一律以 composio-brand-package（`tokens.json` 优先，`DESIGN.md`/`theme.css` 对照）为准，翻译进 globals.css 三层 token 后组件只消费 `var(--*)`/工具类；禁止在页面或组件里直接写规范包裸值。品牌名/Logo/营销文案/abcDiatype 字体（无授权）不采用，字体以 Inter + 开源等宽替代。

组件只消费三层 token，禁止裸 `text-[Npx]`/`rounded-[Npx]`/硬编码色；明暗自适应，不读皮肤 ID。在此基础上：

- **语义状态矩阵**：高频角色补齐 `-default/-hover/-active/-disabled`（含 `-selected`）状态位，消费方直接用状态位，不在组件推算色值。
- **复合排版工具类**：将 `--fs-*` 字号 + 行高/字重注册为 `text-body-*`、`text-caption-1-*`、`text-title-1-*` 等复合类（Tailwind v4 @theme），并扩展 `cn` 的 tailwind-merge 使其正确合并；组件禁止裸字号堆叠。
- **分组色系**：`accent`（整体换肤品牌 ramp）、`chart`（`--palette-chart-1..9` + active）、`status`（既有 `--palette-status-*` 上补 halo/dot 成对）、`node`（沿用 `--palette-node-*`）。
- 新 token 走 globals.css 三层流程并同步 ADR/规范文档。

### D4 目录与导出规范（初版 D4 修订为"组件族目录"）

```text
components/ui/base/buttons/
  ├── index.ts        # 族级 barrel：重导出组件 + variants 类型
  ├── button.tsx
  ├── icon-button.tsx
  ├── tool-button.tsx
  └── button-group.tsx
```

每族一目录、族内按文件拆变体、族级 `index.ts` 汇总导出（同 dbx barrel 形态）；无全局 barrel；深路径导入 `@/components/ui/<layer>/<family>[/<file>]`。cva variants 即公共 API（导出 `XxxVariants` 类型）；`className` 经 `cn` 合并；ref 转发；根元素 `data-slot`。持久切换用 `aria-pressed` + `data-active`；`type="primary"` 只表主要命令；保留 `:focus-visible`；尊重 `prefers-reduced-motion`。每组件头注释：用途、token 组、接管/对标对象、明暗差异（对齐 BoardUI 溯源注释）。

### D5 原语与无障碍策略（吸收 BoardUI：RAC 为地基）

- 简单件用原生语义元素 + 自有键盘/ARIA 处理。
- 复杂控件替换（B3+：Select/Modal/Drawer/Popconfirm/日期/Combobox）以 **`react-aria-components`** 为无障碍地基（同 BoardUI segmented-control/date-picker 做法），包 Celadon 观感与 token；不自研焦点陷阱/键盘导航/ARIA，不引入 Radix 全家桶。B3 启动时正式加入依赖，并先用 1 个样板（SegmentedControl）评审。

### D6 图标契约（吸收 BoardUI）

统一 `lucide-react`（既有），图标以**组件引用**传入（`icon={Move}`），尺寸/颜色由宿主组件以 token 语义档位决定；禁止调用方传 icon className 改尺寸。

### D7 动效契约（吸收 BoardUI，项目已有 motion v12）

按压/工具切换/浮层出入抽统一工具类或小组件（对齐 `button-press-motion` 思路），统一尊重 `prefers-reduced-motion`；渐变悬停等细节抽复用类，不在页面散写。

### D8 进库门槛、首批清单与试点（维持初版）

新组件须满足：① ≥2 处真实重复（PR 附 grep 证据）；② 隔离明确协议/交互契约。纯透传壳不进库。P0 六件：IconButton、ToolButton、StatusBadge、EmptyState、Callout、Kbd。P1：NodeTypeBadge、TextTooltip、LoadingState、SectionCard、PropertyRow、IconGroup。试点热区：画布工具条/工具注册表、节点状态徽章、画布空态与提示——替换即删私有实现。

## 考虑过的方案

- **双层架构（AntD 基座 + 自研轻量契约层，初版推荐）**：作为过渡形态被吸收（替换期 AntD 皮肤继续由 app-theme.ts 统一管理）；作为战略目标被否决——最终观感与密度不应长期受第三方主题系统约束。
- **一步全量替换 AntD**：180 文件一次性重写，不可回滚；否决，改 B1–B5 批次。
- **仅规范化不动代码**：解决不了页面私有重复与观感不可控；目录规范并入 D4。
- **引入 Radix 全家桶套皮**：与自研目标不符；否决全家桶，仅对复杂控件采纳 RAC（BoardUI 已验证路径）作无障碍地基。
- **照搬 BoardUI 或 dbx 代码/清单**：两套均无 AntD 语境且技术栈不同；否决照搬，仅吸收形态与纪律。BoardUI 的 application 产品块映射到影策 AI 工作台场景按需立项（P3），不整层照搬。
- **沿用既有中性色视觉（初版方向，后被推翻）**：原计划沿用旧中性+状态色 token，不换视觉语言；因配色/字体/间距混乱且无权威数值规范，用户 2026-09-05 决策改为**直接采用 composio-brand-package 视觉**（近黑底 + 电蓝 #0007cd + hairline 分隔 + Inter/等宽），数值全部以该包为准。

## 后果

- 长线工程：180 文件/41 导入按 B1–B5 推进；新增"地基阶段"先行补齐 token 与排版工具类，组件质量从第一批起就受纪律约束。
- RAC 作为唯一新增运行时依赖（B3 起）；其余沿用既有工具链（cva/cn/motion/lucide），不引入 Radix、recharts 等（图表类延后按需评估，chart token 先行备好）。
- 自研件与 AntD 皮肤同源观感过渡（同消费三层 token）；试点先在画布热区，降低样式漂移风险。
- 视觉迁移是一次性大转向（近黑底 + 电蓝 accent + Inter）：集中在阶段 A 完成 token 层翻译与 app-theme 同步换肤，避免新旧视觉长期并存；light/dark 双主题由同一 Semantic token 推导（规范包为深色单主题，light 角色自行推导）。
- 依赖下降可量化：每批后重跑清点，数字写进批记录并回写本文档「背景」。
- Table/DatePicker/Tree/Upload 对等成本最高，B5 强制受控子集评审。
- 不为旧组件加兼容层、不按皮肤 ID 分叉组件、不建全局 barrel；测试基建暂缓引入，组件逻辑保护按需再评估。
 - 批次与里程碑排期见实施计划 `docs/plans/ui-kit-rollout-plan.mdx`；长期规范与组件 backlog 维护在 `docs/plans/ui-design-system.mdx`（活文档）。
