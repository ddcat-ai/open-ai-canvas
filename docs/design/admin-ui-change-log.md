# 管理后台 UI 变更记录

本文档是管理后台 UI 的追踪与回滚台账。后续每批 UI 调整都必须在实施时追加，不覆盖历史记录。

## 记录和回滚约定

- 项目实际已存在 Git 工作树（工作树根目录为项目根），本次不初始化、不提交、不改写任何 Git 历史。
- 修改前原始副本保存在 `.local/ui-change-backups/<batch>/`；`.local/` 为本地工作目录，不进入产品源码。
- 每个批次同时记录原文件 SHA-256，回滚时先校验目标和批次，再逐文件恢复，禁止宽范围覆盖。

## 批次 001：建立规范、变更台账与基线

- 日期时间：2026-08-27 20:30 CST
- 目的：在首次 UI 修改前建立可追踪、可回滚制度，并将管理端视觉、布局、响应式和可访问性原则形成明文。
- 修改前状况：项目有全局设计 token 和集中的管理端 CSS，但没有管理端专用规范，也没有覆盖“目的—现状—文件—验证—影响—回滚”的 UI 批次台账。
- 涉及文件：`docs/design/admin-ui-design-standard.md`（新增）、`docs/design/admin-ui-change-log.md`（新增）。
- 具体改动：新增管理端 UI 与布局规范；新增本变更记录；明确本地副本、SHA-256 和逐文件回滚方式。
- 验证结果：修改前 `git status --short` 无输出；原项目指定的 `bun run typecheck` 未能启动，原因是当前环境没有 `bun` 可执行文件，非代码失败。
- 潜在影响：仅新增文档，不进入运行时。
- 逐项回滚：删除上述两个新文档即可；不需要覆盖任何现有文件。

### 已建立的修改前基线

| 文件                                             | 修改前 SHA-256                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `web/src/pages/admin/components/admin-shell.tsx` | `0dc53fee3b3aef0d375ff8da285cb085ae878914fd995b0d785012cb13c8ca2d` |
| `web/src/pages/admin/components/admin-ui.tsx`    | `3d43c03611e02e1ef12e4d1c86217e108e3f5afaad003a24eb756486d29a0c9f` |
| `web/src/styles/globals.css`                     | `0da9f0de77d993ec7e88087a426398ebd20218fa4b75681ae5ddc3b352ca9364` |

## 批次 002：响应式导航与页面壳优化

- 日期时间：2026-08-27 20:36 CST
- 目的：降低中小屏的导航寻找成本，稳定窄屏页头、表格、分页、批量操作和设置卡的排版。
- 修改前状况：<1024px 时将所有管理页面入口平铺为单行横向滚动导航，当前位置和分组不易识别；窄屏下页头操作、分页及批量操作可被挤压，设置摘要与内容之间缺少边界。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将移动端全量横向菜单改为“当前页面 + 分组下拉导航”，保留返回创作台和更新日志快捷入口；增加明确的导航语义、当前页文字和焦点态；为页头操作区、分页、批量操作和设置摘要增加窄屏换行与分隔规则；缩减窄屏表格单元格水平留白。
- 验证结果：Vite 在生产构建中已转换 11,642 个模块，未报告本批管理端 JSX、导入或 CSS 语法错误；构建最终被与本批无关的 Tiptap 版本不一致阻断，具体为 `@tiptap/react` / `@tiptap/extension-list` 从 `@tiptap/core` 引用不存在的导出。TypeScript 5.9 替代检查同样仅报告画布文本编辑器的 Tiptap 重复类型错误。`git diff --check` 与管理端静态扫描通过。
- 潜在影响：中小屏进入其他管理页面由一次横向寻找改为一次打开菜单后选择；所有路由、feature flag 过滤、登录权限和页面组件保持不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-002/` 按原相对路径分别恢复 `admin-shell.tsx`、`admin-ui.tsx` 和 `globals.css`；然后删除本批记录。恢复前可用上表 SHA-256 确认副本与原基线一致。

## 批次 003：补齐管理端表面层级 token

- 日期时间：2026-08-27 20:37 CST
- 目的：修复模型能力编辑器中协议标识底色引用未定义 token 的问题，完善亮暗主题表面层级。
- 修改前状况：`.admin-capability-protocol-card-heading > span` 引用 `--admin-layer-3`，但管理端主题只定义到 `--admin-layer-2`，该条 `background` 声明因无法解析而失效。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在管理端亮色和暗色 token 组中分别定义 `--admin-layer-3`，使其成为比输入表面稍强的第三层中性表面。
- 验证结果：管理端 token 静态扫描的未定义引用从 `admin-layer-3` 一项降为零项。
- 潜在影响：仅影响引用该 token 的协议标识背景，亮暗主题均会恢复轻微表面层次；不改变尺寸、交互或数据。
- 逐项回滚：从 `.local/ui-change-backups/batch-003/web/src/styles/globals.css` 恢复到 `web/src/styles/globals.css`，或只删除亮色和暗色 token 组中新增的两条 `--admin-layer-3`；修改前备份 SHA-256 为 `4bedc571c43d44a459045f4c3654fac0ed0adda74803151717036fa8b0d6282e`。

## 批次 004：审查结论和验证结果归档

- 日期时间：2026-08-27 20:38 CST
- 目的：将已完成的页面、组件、样式、响应式、交互与可访问性审查范围及剩余风险归档，补全批次 002 的实际验证结果。
- 修改前状况：规范已建立，但完整审查覆盖和构建阻塞原因尚未在项目文档中汇总；批次 002 验证项仍标记为待补充。
- 涉及文件：`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在规范文档中增加审查范围、结论、保留决策和剩余风险；把 TypeScript 检查、Vite 构建、静态扫描的真实结果回填到批次 002。
- 验证结果：文档中的页面范围与 `web/src/router.tsx` 及 `web/src/pages/admin/` 现状核对一致；构建与类型检查的阻塞信息按实际输出记录。
- 潜在影响：仅文档变化，不进入运行时。
- 逐项回滚：从 `.local/ui-change-backups/batch-004/docs/design/` 分别恢复两个文档；修改前 SHA-256 分别为 `cb0298fc1ec948606ff5227b2797a634a9afc5135456684a2554099fb4e734ba` 和 `ae650fca21adf03936ed88c7de6faaefddba0af9a172b0f83a6695c2f84b7789`。

## 批次 005：PC 端公共框架与页面节奏

- 日期时间：2026-08-27 20:47 CST
- 目的：先统一 PC 端管理后台的侧栏尺度、超宽屏内容边界、页头层级、工具栏间距和设置卡分区，为后续数据概览与列表页优化建立稳定框架。
- 修改前状况：管理端复用创作端 208px 侧栏尺度，多组管理入口较拥挤；内容在 2K/4K 等超宽屏上无最大宽度，图表和表格的扫读距离过长；页头与工具栏缺少稳定边界；宽屏设置卡的摘要和表单区层级较弱。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为管理端建立独立的 224px 展开侧栏和 1680px 内容最大宽度 token；调整 PC 侧栏头部、导航分组和底部留白；统一 PC 内容区 28px 水平边距；增强页面标题字号、描述文字和页头分隔；统一工具栏高度；在 PC 断点为设置卡增加更稳定的摘要列比例和内部分隔。
- 验证结果：PostCSS 完整解析样式成功；7 组关键公共框架选择器全部确认位于 `min-width: 1024px` 断点；管理端未定义 token 为 0；`git diff --check` 通过。本批仅修改 CSS，没有重复触发已知会被 Tiptap 依赖树阻断的全量构建。
- 潜在影响：新增规则集中在 `min-width: 1024px` 的 PC 断点；不改变移动导航、业务交互、路由、权限或 API。窄桌面宽度下侧栏增加 16px，内容区相应减少 16px，但表格容器仍保留横向滚动。
- 逐项回滚：从 `.local/ui-change-backups/batch-005/web/src/styles/globals.css` 恢复样式文件，从 `.local/ui-change-backups/batch-005/docs/design/admin-ui-change-log.md` 恢复台账；修改前 SHA-256 分别为 `6b1553a59380e0b5f14809682d66a6315a1631b7e70416d733c24339999f5162` 和 `d75aeedd664083f429db822804421223191af93e3adfc126877cb4358d2aab10`。

## 批次 006：PC 端数据概览信息层级

- 日期时间：2026-08-27 20:49 CST
- 目的：以数据概览作为 PC 端仪表盘模板，强化关键指标、辅助指标、趋势图和分析表之间的层级，并补齐语义标题。
- 修改前状况：关键指标卡高度和数值字号偏小，与下方信息的主次不够明显；队列、P95 和费用只是一行轻文字；趋势图标题与图形边界较弱；页面 `h1` 后直接使用 `h3`，标题层级跳级。
- 涉及文件：`web/src/pages/admin/components/analytics-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为概览页主区块增加专用 class；关键指标组改为有语义的 `section`；队列、P95 和费用改为 `dl/dt/dd` 结构；趋势标题改为正确的 `h2` 并与区块关联，图表增加文字替代语义；在 PC 断点放大核心数值、将辅助指标收口为独立条带、增强趋势区标题边界和图表高度、统一分析标签栏节奏。
- 验证结果：`analytics-panel.tsx` 通过 Vite/Oxc TSX 独立转换；PostCSS 完整解析样式成功；9 组概览页视觉选择器全部确认位于 `min-width: 1024px` 断点；管理端未定义 token 为 0；`git diff --check` 通过。
- 潜在影响：数据、统计口径、筛选、刷新、导出、图表序列与分析表均保持不变；样式调整只位于 `min-width: 1024px` 的 PC 断点，移动端仅接收无视觉影响的语义标签修正。
- 逐项回滚：从 `.local/ui-change-backups/batch-006/` 按原相对路径恢复 `analytics-panel.tsx`、`globals.css` 和变更台账；修改前 SHA-256 分别为 `78764033133bea04838bcbc7476d4142bd90f7d1290c75ff8b8f23786e5248cf`、`c2ed26382711056d321befea901a2374238103d01f0c82f0051b35e337353440` 和 `16d1814cdad8d3d1d91e1150ab52cfea2b0b1fba23b063fff3eb66dbe8ab700a`。

## 批次 007：修复 PC 侧栏与主内容之间的过大空白

- 日期时间：2026-08-27 20:58 CST
- 目的：消除超宽屏上侧栏与管理内容之间的大块无意义留白，让数据概览、图表和表格从侧栏后的标准页边距开始。
- 修改前状况：批次 005 将整个 `.admin-page-frame` 限制为 1680px 并水平居中。当可用内容区明显宽于 1680px 时，居中外边距会在左侧形成大块空白，被误认为额外布局区域。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：删除 `--admin-content-max-width` token；移除 `.admin-page-frame` 的 `max-width` 和自动水平外边距；保留桌面端 28px 水平内边距、224px 侧栏以及其他页头和概览页优化。
- 验证结果：PostCSS 完整解析样式成功；PC 断点下 `.admin-page-frame` 仅保留 `width: 100%` 和 `padding: 20px 28px 0`，不再包含 `max-width` 或 `margin-inline`；`admin-content-max-width` 残留引用为 0；管理端未定义 token 为 0；`git diff --check` 通过。
- 潜在影响：PC 端数据概览、表格和图表会重新使用侧栏之外的全部可用宽度；只改变桌面布局，不影响业务交互、数据、权限或 API。
- 逐项回滚：从 `.local/ui-change-backups/batch-007/web/src/styles/globals.css` 恢复样式文件，从 `.local/ui-change-backups/batch-007/docs/design/admin-ui-change-log.md` 恢复台账；修改前 SHA-256 分别为 `d4623f7b0df4e53a18f9a99a140d3d54f60e2b9ce0c6e63c029c40f0182b04f9` 和 `88ff51f3809d0d76ce1048bcc9402f5c605adb0077415d22cececba800f62158`。

## 批次 008：基于真实 PC 视口的宽度与空白校正

- 日期时间：2026-08-27 21:04 CST
- 目的：根据实际 2048×942 PC 有效视口的浏览器测量，消除残留的过宽页边距、概览内容过度拉伸和低数据量表格的巨大空白。
- 修改前状况：实测侧栏为 224px，主内容从 x=252px 开始，其中 28px 为页边距；概览内容宽 1768px，单个 KPI 卡约 442px，趋势图约 1718px，扫读距离过长；用户列表只有 1 条数据时，表格框仍被 `flex: 1` 强制撑到约 769px 高。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将 PC 内容水平内边距从 28px 收至 20px；只对数据概览内容设置 1600px 的左对齐最大宽度，不再居中也不影响通用表格页；使页面直接子级的列表表格框按内容高度收缩，数据较多时仍以 `calc(100dvh - 172px)` 为上限并在内部滚动。
- 验证结果：在真实已登录的 2048×941 PC 有效视口复测：侧栏保持 224px，页面内容起点由 x=252px 收至 x=244px，即侧栏后保留 20px 标准页边距；仅 1 条数据的用户列表表格框由约 769px 高收缩为 164px，计算出的最大高度仍为 769.6px，确认多数据时仍可受控滚动。批次当时概览面板按预期限制为 1600px；随后在批次 009 根据跨页面对齐复核取消该限制。PostCSS 解析通过，未发现未定义的 `--admin-*` 变量，目标文件 `git diff --check` 通过。
- 潜在影响：数据概览在超宽屏右侧可出现适度留白，但左侧始终紧贴标准页边距；普通列表的少量数据不再用边框表面撑满整页，大数据量列表仍保留最大高度和滚动能力；移动断点、业务数据和交互不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-008/web/src/styles/globals.css` 恢复样式文件，从 `.local/ui-change-backups/batch-008/docs/design/admin-ui-change-log.md` 恢复台账；修改前 SHA-256 分别为 `bb843fdfc1fd3635865d1394c58341cb84c4e97faa52a9b424149d14687aa17a` 和 `71f040c5380f683d01b20e86deffc402e94a9247ef4f75bae77e158916a2436d`。

## 批次 009：恢复概览对齐并校正设置卡列比例

- 日期时间：2026-08-27 21:07 CST
- 目的：修正批次 008 中概览页左对齐最大宽度导致的右边界不一致，并解决真实设置页中摘要列过宽的问题。
- 修改前状况：批次 008 后概览面板宽 1600px，在 1784px 可用内容中右侧留出 184px，与页头分隔线和其他列表页的右边界不一致；“登录与注册”实测设置卡为四等分，摘要列宽约 446px，远超标题和描述的需要。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除 `.admin-analytics-panel` 的 1600px 最大宽度和右侧自动外边距，使概览区恢复与页头、筛选区和页边界一致；将非堆叠设置卡的第一列改为 `clamp(220px, 18vw, 280px)`，其余三列继续由内容区跨列使用。
- 验证结果：在真实已登录的 2048×941 PC 有效视口复测：概览面板与页头均从 x=244px 开始、宽 1784px、结束于 x=2028px，左右边界完全一致；设置卡总宽 1784px，摘要列由约 445.6px 收至 280px，表单内容区增至约 1502.4px，实际网格为 `280px 500.8px 500.8px 500.8px`。PostCSS 解析通过，桌面 20px 页边距、低数据表格收缩规则、概览无残留最大宽度及设置列比例均通过静态断言；未发现未定义的 `--admin-*` 变量，目标文件 `git diff --check` 通过。
- 潜在影响：概览页在当前 2048px 有效视口内使用全部可用宽度；设置页摘要列会缩小、表单内容区会扩大，但仍保留 220px 的最小摘要宽度；不影响数据、表单字段、保存行为或移动断点。
- 逐项回滚：从 `.local/ui-change-backups/batch-009/web/src/styles/globals.css` 恢复样式文件，从 `.local/ui-change-backups/batch-009/docs/design/admin-ui-change-log.md` 恢复台账；修改前 SHA-256 分别为 `1fcbcbd0107c4c29e51a5f39c5a37650a1b6ae21c305138b401c03f2050be892` 和 `956bdd7d87657e168530f258e9eb377ac0283e8fc4b2c8156786f374693f4bf0`。

## 批次 010：增强亮暗主题层级与表格分界

- 日期时间：2026-08-27 21:16 CST
- 目的：解决管理后台在亮色和暗色主题中页面、卡片、表头与数据行层级过近，导致界面发糊、表格分界不明显的问题。
- 修改前状况：两个主题的 `--admin-card-border` 和 `--admin-divider` 对比度均仅约 8%，卡片无投影；页面底与卡片表面接近，表格数据行缺少受管理端 token 统一控制的明确分隔，暗色图表悬浮提示仍使用白色默认表面。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为亮色主题建立浅灰页面底、白色卡片、浅灰表头/次级区三个稳定表面层级，为暗色主题建立 `#111315` 页面底、`#1a1d20` 卡片和 `#22262a` 次级区；将卡片边框提高到亮色 15%、暗色 16%，新增主题化的行分隔与悬停 token；给侧栏增加分界线，统一表格外框、表头下边线、逐行分隔、分页底色和设置摘要/页脚层级；将 Recharts 悬浮提示改为主题表面和主题文字；同步补充设计规范。
- 验证结果：在实际已登录页面分别切换亮暗主题并复测数据概览和用户管理。亮色实测页面/卡片/表头为 `rgb(243,244,246)` / `rgb(255,255,255)` / `rgb(247,248,250)`，表格外框 15%、行线 9%；暗色实测为 `rgb(17,19,21)` / `rgb(26,29,32)` / `rgb(34,38,42)`，表格外框 16%、行线约 8.5%；暗色图表提示实测为 `rgb(34,38,42)`，文字使用亮色主题前景。两主题下侧栏边界、表头、数据行和分页区均可辨识，测试后已恢复用户原来的亮色主题。PostCSS 解析、管理端 token 完整性断言、概览 TSX 独立解析、目标文件 `git diff --check` 及三份回滚备份存在性检查均通过。
- 潜在影响：仅调整管理端颜色 token、边框、轻量阴影和图表提示视觉；不会改变表格数据、排序、筛选、分页、主题选择逻辑、业务接口或权限。共享 token 会同步改善管理端抽屉和弹窗的层级，但未新增移动端专属布局。
- 逐项回滚：从 `.local/ui-change-backups/batch-010/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `074c3a58eb408b3520e70fdfd0997fdfc7e4f59ec12b81abfaf931235ee4b893`、`7cab40d66a09c464cf7d70196a32f55a13aa05238d7963e56928635bfad2233c` 和 `49f1dc85badf6e34d8ff2de65235289c7a224a8efa637e581c148af2b76b75a5`。

## 批次 011：收敛 PC 表单宽度并增加切换动效

- 日期时间：2026-08-27 21:20 CST
- 目的：改善超宽屏设置表单的阅读与录入跨度，统一列表操作区控件节奏，并缓和页面与主题切换过于生硬、主题动画首帧闪烁的问题。
- 修改前状况：2048px 有效视口下设置卡宽 1784px，双列表单单个输入框约 720px，标签与输入内容的视线移动距离过长；列表操作区虽然大多接近 36px，但边框、背景和按钮字重没有统一收口；管理页面切换没有进入反馈，主题表面会瞬间跳色。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：PC 非堆叠设置卡增加 1440px 左对齐最大宽度，使摘要列保持 280px、双列表单字段回到可读范围；加强表单标签与帮助信息的字号、字重和颜色层级；统一列表工具栏按钮、输入、选择和日期控件为 36px 高及一致的边框、圆角和表面；增加 190ms 页面淡入上移，以及 180ms 主题表面、边框、文字和控件状态过渡；为 `prefers-reduced-motion` 用户关闭进入动画并将过渡降至近零；主题圆形揭示动画开始前将新主题快照固定为触发点的 0px 裁剪，并在揭示期间暂停管理端自身颜色过渡，消除首帧整页闪烁和双重插值拖影。
- 验证结果：在真实已登录的 2048px PC 视口复测“登录与注册”和“用户管理”：设置卡由 1784px 收至 1440px，单个双列输入框由约 720.8px 收至 548.8px；亮暗主题中卡片和输入表面均保持批次 010 的层级；用户列表搜索、筛选及操作按钮实测均为 36px；页面容器计算动画为 `admin-page-enter 190ms`，主题组件计算过渡为 180ms。明暗主题往返实测时，动画激活首帧的裁剪变量为 `circle(0px at 1968px 28px)`，中间帧新主题快照按圆形半径正常展开，400ms 后动画标记完整清理；未再出现首帧闪屏或尾帧二次变色。测试结束后重新加载确认亮色主题持久化。
- 潜在影响：设置卡在大于 1440px 的可用宽度中会保留右侧自然留白，但始终从标准左边距开始；动画仅应用于 PC 管理端视觉层，不改变路由、表单值、保存行为或业务接口；系统开启“减少动态效果”时不会播放进入动画。
- 逐项回滚：从 `.local/ui-change-backups/batch-011/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `af502fb7e725ca43c7be8bf22f9cf40f1c9f0eccf72c2b52d96aca93064d7077`、`8618937ebaea7011f12ea9981e91fdbd48435d2bf81921966004dcaebe8be7df` 和 `55b79aec0d4802c1aa1b340928c7768433097688bb9af2ebd6cd2b4a20e97f6c`。

## 批次 012：消除主题动画中段感知闪烁

- 日期时间：2026-08-27 21:57 CST
- 目的：解决明暗主题圆形揭示边界经过页面中央后产生一次明显亮度跳变、被感知为闪屏的问题。
- 修改前状况：逐帧检查确认圆形半径从触发按钮连续扩展、没有代码断帧，但白色与近黑色主题之间的高反差圆形边界会在动画中段覆盖大面积页面；当边界穿过主内容和侧栏时，整屏平均亮度瞬间变化，视觉效果仍像闪了一下。
- 涉及文件：`web/src/components/ui/animated-theme-toggler.tsx`、`web/src/components/layout/workspace-top-bar.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为通用主题切换器增加 `fade` 变体，以新主题快照透明度代替几何裁剪；顶栏主题按钮指定 220ms `fade`，取消扫过屏幕中央的高对比边界；通过 `data-magicui-theme-vt-mode` 区分淡入和形状动画，淡入模式首帧固定为透明且不应用裁剪；保留其他显式形状变体及画布降级路径的兼容性。
- 验证结果：在真实工作台中往返切换主题并采样动画时间线：淡入期间模式始终为 `fade`、`clip-path` 始终为 `none`，新主题快照透明度连续过渡至 1；动画完成后 `data-magicui-theme-vt` 与模式标记均正常清理，主题状态保持稳定。未再观察到圆形边界经过页面中央后的亮度突变。PostCSS 解析与淡入模式静态断言通过，TypeScript 全量检查输出中两个本批 TSX 文件均无错误，目标文件 `git diff --check` 与回滚备份存在性检查通过。
- 潜在影响：工作台顶栏的明暗主题动画由圆形揭示变为更短的整页淡入；主题值、持久化、按钮状态、画布主题选择和减少动态效果逻辑不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-012/` 按原相对路径恢复 `web/src/components/ui/animated-theme-toggler.tsx`、`web/src/components/layout/workspace-top-bar.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `011b87992d61a4b13ffb3fc5120d98a6c328dd977ac02637b2fd9d96efeb309e`、`9a97578fe6e35f7354942497476083ef0a8d570ca5905c5c934fd8f1a20283d4`、`f5f3313dfc8e51ce20dcb759c9469885240f045a7f494b0e1cf8d21182d92c9f`、`9908efb807b735f6bf75b758207ee07243b0ccd055e8aa3ae4ca8891d1229d2d` 和 `d339b1231c0729d218cc6d1233fd23441186ef60c419b2eae2287708f1ff2843`。

## 批次 013：统一后台弹窗结构与渠道编辑宽度

- 日期时间：2026-08-27 22:03 CST
- 目的：统一管理后台弹窗的标题、正文、底部操作层级，修复系统渠道编辑弹窗被通用宽屏样式意外放大的问题。
- 修改前状况：渠道弹窗组件声明 `width={760}`，但 `workspace-modal-wide` 使用 `!important` 将实际宽度覆盖为 920px，单列表单横向跨度过大；弹窗容器统一使用 20px/24px 内边距，标题仅 25px 高且无独立背景，正文与 36px 高的底部操作区缺少清晰边界。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将渠道弹窗实际 PC 宽度恢复为 760px；为管理端通用弹窗建立 60px 标题区、可滚动正文和约 64px 固定底部操作栏；统一 24px 水平内边距、主题化表面、边框、阴影、关闭按钮状态以及 36px 底部按钮；标题区与底部栏增加主题分隔，正文使用稳定滚动条槽位。
- 验证结果：在真实已登录的 2048×941 PC 视口打开“编辑系统渠道”复测：弹窗由 920px 收至 760px，正文输入区为 712px；标题区实测 60px，正文最大高度 620px，底部栏约 64.8px。亮色下正文/底部为白色与 `rgb(247,248,250)`，暗色下容器/底部为 `rgb(26,29,32)` 与 `rgb(34,38,42)`，暗色外框为 16%、标题分隔为 12%，两主题的滚动、关闭和取消操作正常；未提交或修改任何渠道数据。PostCSS 解析、弹窗规则静态断言、目标文件 `git diff --check` 和三份回滚备份存在性检查通过，测试结束后恢复亮色主题并确认弹窗已关闭。
- 潜在影响：带 `admin-modal-root` 或 `admin-channel-modal-root` 的管理弹窗会共享新的标题、正文和底部栏结构；内容滚动与按钮行为不变。渠道弹窗在 PC 上变窄，但仍保留 712px 的可用表单宽度；移动视口继续受 `calc(100vw - 32px)` 保护。
- 逐项回滚：从 `.local/ui-change-backups/batch-013/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `ff2d0b5ca6f7905a0a086d15235039352976734b3450f5e10d57fb02ab76e9a4`、`18426b7f8f3693aceee30a7bfc510d29f529cd867f295c58221a07b9a5d2a7cd` 和 `5af94b0a74b762198f694ae32fbd3c6e02e19845500e4e14ea8c50387fb87351`。

## 批次 014：后台右上角增加独立主题切换

- 日期时间：2026-08-27 22:06 CST
- 目的：让管理员在后台页面右上角直接切换亮暗主题，避免每次返回创作台，同时不占用侧栏底部空间。
- 修改前状况：管理后台会读取并呈现全局主题，但自身没有切换入口，管理员必须离开当前后台页面才能更改主题。实施过程中曾尝试把入口放在侧栏底部并复用前台 View Transition 按钮，但根据界面层级复核改到页面标题栏右上角；同时发现浏览器中止主题动画后，全局进行中锁可能残留。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/components/ui/animated-theme-toggler.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在共享 `AdminPageFrame` 的页面操作区末尾新增月亮/太阳纯图标按钮，因此所有 PC 后台页面都会在标题栏最右侧显示主题入口；按钮直接更新现有 `useThemeStore`，由后台 180ms 表面过渡完成视觉切换，不依赖前台 View Transition 动画锁；按钮提供“切换到深色主题/切换到浅色主题”的动态辅助名称和底部提示；同时为通用动画组件增加 `duration + 500ms` 保底清理，防止浏览器失焦或中止动画时永久锁死后续主题切换。
- 验证结果：在真实 `/admin/channels` 页面往返切换明暗主题，URL 和当前页面保持不变，根主题类、右上角按钮图标/辅助名称与 Ant Design 后台主题同步更新；按钮位于标题栏最右侧，统一为 36×36px，与“新增系统渠道”保持 8px 间距；侧栏内不存在主题按钮。后台切换不依赖前台动画锁，实测连续点击可用；随后恢复亮色主题。前端样式解析通过，本批两个 TSX 文件在全量类型检查输出中均无诊断，目标文件 `git diff --check`、入口位置静态断言及五份回滚备份存在性检查均通过。
- 潜在影响：仅在所有 PC 后台页面标题栏右上角增加主题入口并增强通用主题动画锁的容错；主题仍使用同一持久化 store，因此前后台保持一致。未新增移动端入口，未改变路由、权限、后台业务或接口。
- 逐项回滚：从 `.local/ui-change-backups/batch-014/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/components/ui/animated-theme-toggler.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `d8ae46fbb7bb06f0f9dcd9e83e06415cb352c7bce9c793afd6a3d9fb2b496104`、`6d22837e1ae59a65db78f867248a166d7bfa604525ee702723c070ac65f9a7d7`、`bbb9447aada152279852b83f2ecf88b00b526a163b130e189d13cacf78ead67f`、`7ab4a7cf48d09cd7cdd51e6e743140f77776f8229a9627fa15fc6ea6f3ffbb8a` 和 `aa3b1b08b41279b41f52d927ad4b698030bfb0332f2aa41e3019c7d8a6cff2a7`。

## 批次 015：统一侧栏与主内容的底色和导航层级

- 日期时间：2026-08-27 22:17 CST
- 目的：消除侧栏与主内容像两个独立系统拼接的割裂感，同时保持导航分组、当前位置和辅助操作清晰可辨。
- 修改前状况：亮色主题侧栏为纯白 `rgb(255,255,255)`，主内容为浅灰 `rgb(243,244,246)`；暗色主题侧栏为 `#16181b`，主内容为 `#111315`。两块大面积异色在 224px 边界处形成明显硬切，当前菜单又主要依赖半透明底色，整体层级不够统一。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：亮暗主题的 `--admin-sidebar` 均改为引用 `--admin-layer-0`，使侧栏、页头承载区和主内容共享连续基底；保留侧栏右侧细分隔线；导航项增加透明占位边框，当前项使用 `--admin-layer-1`、卡片边框和轻阴影，悬停只提升一个轻量表面层级；侧栏底部辅助操作区增加顶部分隔线；同步将侧栏表面与层级规则写入设计规范。
- 验证结果：在真实 2048×941 PC 插件管理页分别复测亮暗主题。亮色侧栏和主区均为 `rgb(243,244,246)`，当前项为白色、15% 边框和 1px 轻阴影；暗色侧栏和主区均为 `rgb(17,19,21)`，当前项为 `rgb(26,29,32)` 和 16% 边框。侧栏右侧及底部操作区分隔清楚；展开宽度 224px、折叠宽度 64px，折叠后当前项仍保持 34px 高及完整边框。主题往返和折叠往返均正常，测试结束后恢复亮色展开状态。PostCSS 样式解析、目标规则静态断言、三份回滚备份存在性检查均通过。
- 潜在影响：侧栏不再通过整块异色与内容区区分，改由边线和导航层级表达；后台卡片、表格、表单、路由、权限、业务交互和移动端布局不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-015/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `495643a6bd3672cc3c9395df9479f4ee8a9c0188b639cdbafc42770d5684b43a`、`95589ae34ca090b059be3282691725dcb158a171b2e5c03ce95e2444df2ccca9` 和 `ce4420138a123413f867ca67c5a78f92025f9c468fa058e3abf47b2a2e82481d`。

## 批次 016：统一 PC 设置页工作区与表单节奏

- 日期时间：2026-08-27 22:25 CST
- 目的：统一功能、策略、登录、邮件、存储、绘图、方舟、响应拦截和第三方配置页的工作区宽度、卡片间距、摘要结构、正文留白及保存栏位置。
- 修改前状况：设置页顶部留白虽大多为 16px，但卡片间距混用 12px、16px 和 24px；存储页使用 1784px 全宽堆叠卡片，而主要表单页为 1440px 左摘要/右内容结构；存储页首字段紧贴内容上边缘，表单正文混用 16px 与 20px 内边距；保存区高度约 61px，响应拦截页缺少页头说明。
- 涉及文件：`web/src/pages/admin/admin-route-pages.tsx`、`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/pages/admin/components/access-settings-panel.tsx`、`web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/pages/admin/settings/libtv-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为九类 PC 设置页统一增加 `admin-settings-stack`，固定 1440px 左对齐工作区、页头后 16px 留白和卡片间 16px 间距，并覆盖旧 `space-y-*` 产生的额外外边距；将存储和响应拦截由全宽堆叠摘要改为 280px 左摘要与右侧内容；将策略、存储、绘图、方舟和第三方配置的表单型正文统一为 20px 内边距；PC 表单项统一 18px 垂直节奏、标签下方 6px 间距；保存栏统一至少 64px 高、20px 水平留白，主操作保持在右侧；为响应拦截补充“替换用户可见的上游异常”页头说明；同步补充设置页设计规范。
- 验证结果：在真实 2048×941 PC 环境逐页复测九个设置入口。所有卡片起点均为 x=244、y=125，工作区与卡片宽均为 1440px，摘要列 280px、内容区约 1158px，顶部留白和多卡间距均为 16px；存储页由 1784px 收至 1440px并恢复 20px 顶部留白，响应拦截说明正常显示；保存栏实测约 65px，表单项底部间距 18px；所有页面均无横向溢出。暗色下卡片、摘要、正文和保存栏分别使用既定一级/二级表面，长表单阅读正常；测试结束后恢复亮色主题。PostCSS 样式解析通过，本批九个 TSX 文件在全量类型检查输出中均无诊断，目标文件 `git diff --check`、静态规则断言和十二份回滚备份存在性检查均通过。
- 潜在影响：PC 设置页内容不再占满超宽屏，存储和响应拦截的摘要移动到左侧，字段区可用宽度约 1158px；设置数据、表单值、保存逻辑、确认交互、接口和权限不变。移动端现有堆叠规则未作调整。
- 逐项回滚：从 `.local/ui-change-backups/batch-016/` 按原相对路径恢复上述十二个文件。修改前 SHA-256 依次为 `774a0178995213d2acf670d7dc686b7a4b537af6ef5fea86a01a6cef94d1eb51`、`790734c9df73b2388c85d26af2d9ce412dc0118919af61455617569beee3963a`、`4790c10dae5c13c58bff497f637e97c96a3bf56050ab5242cc37389c3249b11c`、`40651a960f3795f9239e824b4b6703beb81cde652718ea79c89238497ffdf392`、`6068bebb5f29c3710cf14626cd528a8d17da938e7bbcace1c5e5cc846888e58a`、`0ecf45932a9b1decbec13022fa4539087beca66bfcf80dd2629b7cb3f46c431a`、`63fc1fe87f1701b3b033770e8a15a524e31fac51d1b995cd4577c0541e8cf76d`、`298c51ea0c3273a41ddc2571df5522723d2563e96abca667ede02e456981fbaf`、`5e785bf966f78b2d822f922328d8857981bccd1b194b9d1fae4b749cd897353f`、`b438388dafc92ab97ad2b165a95536e577e0d286b3a27efccae05e6afc99afc8`、`87f4a589c5ade6971efc741c0cb133c5b4985a1117d89f3ee777208664609f44` 和 `1fca0a006dcc292c1ec589823ba734b158501ad11df275f777aa1ac8edc5fc86`。

## 批次 017：将后台分页统一移到表格外部

- 日期时间：2026-08-27 22:30 CST
- 目的：让总数、每页条数和翻页控件直接显示在表格下方，不再被表格卡片外框和底色收纳。
- 修改前状况：分页作为 `admin-table-frame` 的内部子层，使用次级表面、顶部边线和约 61px 高度，与表头和数据行一起被同一圆角外框包住；少量数据时尤其像表格内多出一行。
- 涉及文件：`web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在共享 `AdminDataTable` 中将分页节点移到 `admin-table-frame` 之后，使所有后台列表一次性采用“表格卡片 + 下方独立分页行”；分页行改为透明、无边框、无模糊背景，与表格保持 10px 间距并收至 36px 高；移除分页组件原有 16px 顶部外边距；将主页面表格最大高度从 `calc(100dvh - 172px)` 调整为 `calc(100dvh - 218px)`，为外置分页预留可视空间；同步更新表格设计规范。
- 验证结果：在真实 2048×941 PC 环境复测用户管理：表格框高约 103px，分页从框内约 61px 次级表面变为框外 36px 透明工具行，与表格间距 10px，父级由 `admin-table-frame` 改为 `admin-data-table`。继续抽查系统渠道、请求明细和提示词模板，三页分页均为透明、0px 边框、36px 高、10px 间距且无横向溢出；暗色主题下同样保持透明页面底色，随后恢复亮色用户页。PostCSS 样式解析、共享组件结构断言通过，`admin-ui.tsx` 在全量类型检查输出中无诊断，目标文件 `git diff --check` 和四份回滚备份存在性检查均通过。
- 潜在影响：所有使用 `AdminDataTable` 且提供 `footer` 的后台主表和嵌套表都会采用外置分页；数据、筛选、页码计算、每页条数、翻页行为和接口不变。满屏数据表的内部可滚动高度减少约 46px，以确保外置分页仍位于当前 PC 视口内。
- 逐项回滚：从 `.local/ui-change-backups/batch-017/` 按原相对路径恢复 `web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `9b8c7840994803e8705aa30ca206b08082c9ccabb0a1e497e91344c8780a5ae1`、`e84ab521ef518bfeb2fbb5a20b237d6314b2fe79f07459a2ad2416610a16e238`、`a1cc21a8a2f7429d908145cba4e6facd2f29e38b1f9853b26522b57b5ecdbb83` 和 `334dc77e259bd016504a76b5e2c9cb8e5b734626e2f7c11cd3a7e9921252b516`。

## 批次 018：将外置分页固定到 PC 内容区底部

- 日期时间：2026-08-27 22:34 CST
- 目的：纠正批次 017 对“放在底下”的理解，使分页栏不是紧跟表格，而是无论数据多少都固定在当前后台内容工作区的最底部。
- 修改前状况：批次 017 已将分页移出表格外框，但分页仍以固定 10px 间距紧跟表格；用户页只有 1 条数据时，分页位于 y=286，下面留下大块空白，没有贴住内容区底部。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将外置分页容器的顶部外边距改为自动弹性外边距，使空余高度全部位于表格与分页之间；分页容器使用 46px 保留高度，其中顶部 10px 作为与满数据表格的安全间隔，内部工具行继续保持 36px；不使用 `position: fixed` 或覆盖层，避免遮挡表格内容和影响侧栏宽度；同步明确 PC 主列表分页固定在内容工作区底部的规范。
- 验证结果：在真实 PC 视口复测用户管理：表格底部约 y=276，分页工具行由 y=286 移至 y=906，底边与约 941px 视口底部在亚像素取整范围内重合，中间自然留出约 618px；系统渠道页面截图确认总数在左、页容量和翻页在右并稳定贴底。继续抽查用户管理、请求明细和提示词模板，三页表格高度分别不同，但分页工具行底边均保持约 y=942，且无横向溢出；暗色主题同样固定贴底并保持透明无边框，随后恢复亮色用户页。PostCSS 解析、底部弹性规则静态断言、目标文件 `git diff --check` 和三份回滚备份存在性检查均通过。
- 潜在影响：提供分页的后台弹性表格会把分页推到各自可用工作区底部；少量数据时表格与分页之间会出现预期留白，多数据时仍由表格内部滚动且分页不被遮挡。分页数据、页码计算、翻页交互、接口及移动端规则不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-018/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `993f1470185a6735177710494d7a71d81dd13c2928daa426bc19a9febed29d22`、`dc9a685db504e47d05ec366a9cf7a4709868880054caac4fa19e8810fa7e60a0` 和 `7ad59e976aeaa720a76b90c1f3af33ef05ccc9e5709db2db1657234f6040b129`。

## 批次 019：恢复底部分页栏的实体表面

- 日期时间：2026-08-27 22:36 CST
- 目的：保留分页固定在 PC 内容区底部的正确位置，同时撤销批次 017、018 中不符合预期的透明无边框视觉。
- 修改前状况：分页已固定到内容区底部，但容器完全透明且无边框，在大面积页面底色上缺少稳定承载，看起来像散落在页面边缘；用户提出应恢复第 016 批附近的非透明层级感。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：分页容器继续使用自动弹性外边距固定在底部，但改为 `--admin-layer-1` 一级表面、完整主题边框、10px 圆角和轻阴影；容器统一为 52px 高、7px 垂直与 12px 水平留白，内部分页工具行保持 36px；将满数据表格最大高度从 `calc(100dvh - 218px)` 微调为 `calc(100dvh - 224px)`，为实体底栏增加的 6px 高度预留空间；同步更新设计规范。为保证台账完整，没有删除批次 017、018，而是以本批明确记录纠正结果。
- 验证结果：在真实 PC 用户管理页复测，亮色分页栏为白色一级表面、主题边框、10px 圆角和轻阴影，高 52px并稳定贴住内容区底部；总数保持左对齐，页容量与翻页保持右对齐。暗色下分页栏为 `rgb(26,29,32)`，边框约 12%，轻阴影正常，底边仍与约 941px 视口底部在亚像素取整范围内重合，页面无横向溢出；随后恢复亮色用户页。PostCSS 解析、实体表面规则静态断言、目标文件 `git diff --check` 和三份回滚备份存在性检查均通过。
- 潜在影响：所有共用后台分页的 PC 列表将显示实体底栏并固定在可用内容区底部；数据、筛选、翻页、每页条数、表格滚动、接口及移动端规则不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-019/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `2438052787933ff1f609e7d91863fb6c0de02cd09641df71cd67a4db8818bd67`、`1f79001a75c74e9b405bbe0f24041cf38cc0b7d746cdd9772c5a0710ad42bf72` 和 `9937264181c3f31972d9071e7dd8189f3a57f36820df31cf98cec45228461066`。

## 批次 020：完整回滚分页到第 016 批状态

- 日期时间：2026-08-27 22:38 CST
- 目的：按用户要求撤销批次 017、018、019 的全部分页结构与视觉调整，使运行中的界面代码恢复到第 016 批完成后的准确状态。
- 修改前状况：分页已被移到表格外部并固定在内容区底部，先后经历透明工具行和实体卡片底栏两种方案，均未符合最终预期。
- 涉及文件：`web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将分页节点重新放回 `admin-table-frame` 内部并恢复 `has-pagination` 状态类；恢复 44px 最小分页区、次级表面、顶部边线与模糊背景；恢复分页组件原有顶部外边距和主表最大高度 `calc(100dvh - 172px)`；移除设计规范中批次 017–019 新增的外置、贴底与实体底栏约束。为遵守追加式变更制度，保留批次 017–019 的历史记录并以本批记录实际回滚，而不删除台账历史。
- 验证结果：`admin-ui.tsx`、`globals.css` 和设计规范已与 `.local/ui-change-backups/batch-017/` 中保存的“批次 017 修改前”文件逐字比对一致，确认代码准确回到第 016 批状态。真实亮色用户管理页复测：分页父级恢复为 `admin-table-frame has-pagination`，分页区位于表格内部、使用 `rgb(247,248,250)` 次级表面和顶部边线，实测约 61px 高；未触发任何数据操作。PostCSS 解析通过，`admin-ui.tsx` 在全量类型检查输出中无诊断，目标文件 `git diff --check` 和四份本批回滚备份存在性检查均通过。
- 潜在影响：批次 017–019 对分页的外置、固定底部和独立实体底栏效果全部撤销；分页数据、页码计算、翻页操作、业务接口以及第 016 批之前的其他后台 UI 优化保持不变。
- 逐项回滚：如需撤销本次回滚并恢复批次 019 状态，从 `.local/ui-change-backups/batch-020/` 按原相对路径恢复 `web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；本次回滚前 SHA-256 分别为 `2fc21a7a94311b8d52b2825204d38986d00c80bc431426c47cda807452971559`、`081ae3756e6a90427e73f5aafbe74d8ebc2d937863965831f6176ea4a92509f4`、`11eb06dba06cdaff1b2bc8fd6d24143c85d64ae9cc0707549104d3bf492575d8` 和 `ed72d4a8aaaa9e424344a269b70b48b4706465e4575440452dc09b06966faf78`。

## 批次 021：表格卡片填满工作区并将内部分页置底

- 日期时间：2026-08-27 22:42 CST
- 目的：依据用户提供的参考图，让分页保留在表格卡片内部，同时使表格卡片填满 PC 页面的剩余高度，分页稳定显示在卡片最底部。
- 修改前状况：第 020 批回滚后，分页结构与样式已恢复到第 016 批，但直接主表仍使用 `flex: 0 1 auto` 和 `calc(100dvh - 172px)` 最大高度；少量数据时表格卡片按内容收缩，分页紧跟最后一行，无法呈现参考图中的整页表格工作区。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：仅调整 PC 主页面直属 `AdminDataTable` 的表格高度策略，将表格框由内容收缩改为 `flex: 1 1 auto`，并取消原有最大高度限制；保持分页节点、次级表面、顶部边线和同一卡片内的结构完全不变。表格表面继续占用剩余空间，`admin-table-scroll` 在内部滚动，因此表头和底部分页不随数据滚动；同步更新设计规范。
- 验证结果：在真实 PC 的渠道模型管理页复测 78 条数据，表格卡片从筛选区下方一直延伸到视口底部，数据区在内部滚动，分页显示“1–20 / 共 78 条”并稳定位于卡片底部，视觉结构与用户参考图一致。继续在只有 1 条数据的用户管理页复测：表格卡片 y=173 至约 y=942、高约 769px，数据表面高约 707px，分页位于 y=880 至约 y=941，父级仍为 `admin-table-frame has-pagination`；页面无横向溢出。暗色下数据表面为 `rgb(26,29,32)`、分页为 `rgb(34,38,42)`，位置保持不变；随后恢复亮色用户页。PostCSS 解析、目标高度规则静态断言、`git diff --check` 和三份回滚备份存在性检查均通过。
- 潜在影响：所有 PC 主列表在数据较少时会保留完整高度的空白数据表面，在数据较多时改为数据区内部滚动；分页、筛选、行操作、页码计算、接口以及弹窗和嵌套表格不变，移动端规则不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-021/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `e84ab521ef518bfeb2fbb5a20b237d6314b2fe79f07459a2ad2416610a16e238`、`a1cc21a8a2f7429d908145cba4e6facd2f29e38b1f9853b26522b57b5ecdbb83` 和 `e7ed1689eb3b341fc0c066fc87ff9aa29ee128a36a49dd5f2353fca70be8c9f2`。

## 批次 022：收紧内部分页栏并增加底部安全间距

- 日期时间：2026-08-27 22:44 CST
- 目的：解决批次 021 的表格卡片完全贴住内容区底边、分页栏上下留白过大显得厚重的问题。
- 修改前状况：PC 主表格卡片底边与视口底部基本重合，没有呼吸空间；分页内部复用了 `PaginationBar` 自带的 16px 顶部外边距，使分页区域实测约 61px 高，明显大于表头和普通工具栏。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为 PC 主表格框增加 16px 底部外边距，使卡片不再贴住工作区底边；在管理端分页容器中覆盖通用分页组件的顶部外边距为 0，保留原有 44px 最小高度、次级表面、顶部边线和内部左右布局；同步明确表格底部安全间距与分页高度规范。
- 验证结果：在真实 PC 用户管理页复测，表格框底部由约 y=942 收至 y=926，与约 941px 视口形成约 15–16px 间距；分页区域由约 61px 收至约 45px，内部工具行 44px，顶部外边距为 0；分页仍位于 `admin-table-frame has-pagination` 内部，数据表面继续填满其余空间并可滚动。截图确认总数、页容量和翻页控件垂直居中，卡片底部留白自然。暗色主题下分页使用 `rgb(34,38,42)` 次级表面，间距和高度一致，无横向溢出；随后恢复亮色用户页。PostCSS 解析、目标规则检查、`git diff --check` 和三份回滚备份存在性检查均通过。
- 潜在影响：PC 主列表整体表格框高度减少约 16px，同时分页区域减少约 16px，因此数据表面的实际可用高度基本不变；分页、表格滚动、筛选、接口和移动端规则不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-022/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `0761cd5213472c8be18639c7fb7b46af13b006ace38b1e05f7e677d30cc6082a`、`040b07e03f18794ef83cf9a65c9132b9066427c7c455e069f6ee4f1c0d2f9498` 和 `4a16dfa12ab468af044f1bb9638a16410db78db5d31e1f11ac8022dc1c3be1f3`。

## 批次 023：平台资源入口验收与搜索语义补齐

- 日期时间：2026-08-27 22:49 CST
- 目的：在进入“运营”模块前，对用户管理、系统渠道、插件管理和提示词模板四个入口进行完整 PC 复核，并补齐搜索控件的一致性与可访问性。
- 修改前状况：四个入口的页头、工具栏、表格或卡片层级、分页及明暗主题视觉已经统一，且没有横向溢出；但用户管理、插件管理和提示词模板的搜索输入框仅使用占位文字说明用途，输入内容后该提示会消失，与已经提供明确搜索语义的系统渠道页不一致。
- 涉及文件：`web/src/pages/admin/users/users-panel.tsx`、`web/src/pages/admin/plugins/plugins-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：分别为用户、插件和提示词模板搜索框增加“搜索用户”“搜索插件”“搜索提示词模板”的明确 `aria-label`；系统渠道已有“搜索系统渠道”标签，保持不变；在设计规范中新增搜索输入不能只依赖占位文字传达用途的约束。未调整筛选逻辑、查询参数、列表数据或任何业务操作。
- 验证结果：在真实 2048×941 PC 环境逐页复核四个入口。用户、系统渠道和提示词模板的表格框均从 y=173 延伸至 y=926，底部保留约 15–16px，内部分页约 45px；插件管理保持三张摘要卡、单行筛选和双列插件卡片，所有页面横向溢出均为 0。亮暗主题逐页切换后，三张表格页暗色数据表面为 `rgb(26,29,32)`、分页为 `rgb(34,38,42)`，边界清晰且布局不跳动；四个搜索框均取得对应的明确无障碍名称，测试结束后恢复亮色主题。
- 潜在影响：仅提升三个搜索输入框的读屏和自动化识别语义；页面视觉、搜索行为、URL 状态、接口、权限及移动端布局不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-023/` 按原相对路径恢复 `web/src/pages/admin/users/users-panel.tsx`、`web/src/pages/admin/plugins/plugins-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `01b87e3a548ca0eaf45ea485338cb176c3c29c7d966e15dadd168198a848a118`、`5d7848522872450998d3277289fb901dfe79f9fb09a5804a524e7eed7ccc7f2e`、`4e00ca01b7af10c3e26f57a368fe2f6eb2f5fcd1fb9d11b9cb40613f6e26b341`、`9472820f9f8948288699b14826d7e42a7a99df8c347a59674cd2e6f321eb2f33` 和 `4b16af9d0258340d572dafab0efaaf073b8144ec67e7bbc7d42e3513d9276516`。

## 批次 024：重构插件管理为统一管理表格

- 日期时间：2026-08-27 23:03 CST
- 目的：解决插件管理双列大卡片信息密度低、长页面难以巡检、筛选随页面滚动消失以及亮色主题系统插件标签不可读的问题，并与其他后台资源页统一。
- 修改前状况：25 个插件以两列、每张约 886×171px 的大卡片展示，页面内容高约 2748px、主工作区整页滚动；滚到中部时标题、138px 高统计卡和筛选栏均离开视口。大量系统插件重复展示“未提供插件说明”并留下大面积空白，左右折返阅读不利于比较；亮色主题 `ant-tag-default` 实测为黑底、近黑文字，“系统插件”标签几乎不可读。
- 涉及文件：`web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除双列插件卡片和整页滚动，改为紧凑四项总览条、统一搜索/类型/状态筛选栏以及单列管理表格；主信息列合并图标、名称、版本、ID、说明或错误信息，另设类型与来源、作用范围、平台状态和操作列；使用主题化 `AdminStatusBadge` 取代存在亮色对比问题的默认标签；保留每个插件的平台开关及上传插件卸载入口；增加平台开放/停用筛选、有效筛选标签和一键重置；增加客户端 20/50/100 条分页，分页保留在表格卡片底部；启用表格原生固定表头，使数据区内部滚动时列名保持可见；为两个筛选选择器增加明确无障碍名称；同步写入插件管理专用布局规范。
- 验证结果：在真实 2048×941 PC 环境验证。重构后主页面不再整页滚动，表格框 y=269 至 y=926，底部保留约 15–16px，数据滚动区高约 611px，分页栏约 45px；行高由原卡片 171px 收至约 64–69px，同屏可见约 9 行。滚动数据区 420px 后，42px 表头仍固定在 y=269；第 2 页正确显示第 21–25 条，搜索 OpenAI 自动回到第 1 页并得到 6 条结果，停用筛选仅返回 Agnes，重置恢复 25 条。亮色“系统协议”改为可读的中性状态标识，暗色下类型与开放状态对比正常；页面横向溢出为 0，测试结束后恢复亮色主题。
- 潜在影响：插件列表的展示结构、筛选条件和客户端分页发生变化；默认首屏仅展示前 20 条，其余通过第 2 页访问。插件数据来源、刷新、上传、卸载、平台启停接口、状态保存、用户启用数量与权限逻辑不变；移动端未作专项调整。
- 逐项回滚：从 `.local/ui-change-backups/batch-024/` 按原相对路径恢复 `web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `68b471214587f7a404147394524091ee44cfd15c2ee8e9c708dc5b8ed647cb30`、`0a484bbd5ac7ebd24bd09252c61dc44355f0f63bbc30d94856453d99375a07e4` 和 `671041d39909d0a2265212fe062326a55e4185fcb7f083825910695fabc3a166`。

## 批次 025：收紧插件来源信息并补全卸载入口

- 日期时间：2026-08-27 23:07 CST
- 目的：根据实际页面反馈，减少类型列中重复且影响扫描的“可信来源”信息，并让右侧操作列明确呈现卸载入口。
- 修改前状况：每行类型标识后都重复显示盾牌图标和“可信来源”，在窄类型列形成第二行视觉噪声；内置插件的操作列只显示一条横杠，无法直接说明该位置的操作含义，也不利于与上传插件的可卸载状态对比。
- 涉及文件：`web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将列名“类型与来源”收紧为“类型”，可信插件不再重复展示来源文字，仅对未验证来源追加警告标识；将操作列明确命名为“卸载”，所有行统一展示带删除图标的卸载入口。上传的自定义插件保留可点击危险操作，内置插件显示禁用状态并通过悬停说明“内置插件不可卸载”；同步将来源与卸载展示原则写入设计规范。
- 验证结果：在真实 2048×941 PC 插件管理页复测，列表中“可信来源”重复文本数量为 0，表头依次为插件、类型、作用范围、平台状态、卸载；当前首屏 20 行均在右侧显示卸载入口，内置插件按钮为禁用且携带原因提示，页面横向溢出为 0。亮色下类型标识与禁用操作层级清晰，暗色下禁用按钮文字为 25% 前景色、类型标识保持清晰对比；测试结束后恢复亮色主题。当前数据没有上传的自定义插件，启用态卸载分支通过代码路径检查确认仍调用原有 `remove` 流程。
- 潜在影响：可信来源不再在每一行重复显示；内置插件操作列由横杠改为不可点击的“卸载”按钮。插件信任数据、上传插件卸载确认、接口、平台启停、筛选和分页逻辑不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-025/` 按原相对路径恢复 `web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `4500b423a2f435886d2b05f2e88debb5fcbaa66ed9d92b20d1eb58eb1664fc0d`、`5688918317d92daf6e2f7c549f84583cf1b3b0b622bd7b03c704a64e71a60523` 和 `199da601b172ceb9bb5ac2b621695db34e6717d51e973ebb64ab3feae92301d4`。

## 批次 026：卸载列改为纯图标操作

- 日期时间：2026-08-27 23:12 CST
- 目的：去除卸载列中与表头重复的行内“卸载”文字，进一步收紧操作列并降低重复信息干扰。
- 修改前状况：表头已经明确标注“卸载”，但每行按钮仍同时显示垃圾桶图标和“卸载”文字；在窄操作列中形成重复文案，也使禁用状态显得偏重。
- 涉及文件：`web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：上传插件和内置插件的行内卸载按钮均改为仅显示垃圾桶图标；操作列声明宽度由 100px 收至 72px并居中；上传插件图标按钮提供“卸载 + 插件名”的 `aria-label`，内置插件图标按钮继续禁用，并提供“插件名为内置插件，不可卸载”的无障碍名称与悬停说明；同步更新插件操作列规范。
- 验证结果：在真实 2048×941 PC 插件管理页复测，卸载列标题居中，首屏行内按钮可见文字均为空，仅保留图标；8 个抽查内置插件按钮均为禁用状态并具有准确的插件级无障碍名称，页面横向溢出为 0。亮色下禁用图标层级清晰，暗色下图标使用 25% 前景色且不抢占平台状态；测试结束后恢复亮色主题。
- 潜在影响：卸载操作不再显示行内文字，需要通过列标题、图标和悬停说明识别；上传插件的卸载确认及接口、内置插件不可卸载约束、筛选、分页和平台启停逻辑不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-026/` 按原相对路径恢复 `web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `7c3fddf6511a454c4ec9baa4efed781780df72c98ac29b040932957fd387ed61`、`0344425f8de632a80f71cdb3445404926b6940613ea8b74b652de760d56125bd` 和 `1105aa318211f1af6a1f59726b067815d5d4ddab1020d097a8d243699438d14b`。

## 批次 027：移除插件筛选栏的重复标签

- 日期时间：2026-08-27 23:14 CST
- 目的：去除类型和状态下拉框右侧重复展示的筛选标签，保持插件工具栏简洁协调。
- 修改前状况：选择插件类型或平台状态后，下拉框本身已经显示当前值，但工具栏右侧又生成“类型：…”和“状态：…”标签，信息重复并占用较多横向空间。
- 涉及文件：`web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除插件页 `toolbarActiveFilters` 及不再使用的 `AdminFilterChip` 引用；保留搜索框、类型下拉框、状态下拉框、筛选生效状态和统一重置按钮。类型与状态仍直接在下拉框中显示，存在任意筛选时右侧仅出现一个“重置”操作；同步更新插件筛选规范。
- 验证结果：在真实 2048×941 PC 插件管理页同时应用类型和平台开放筛选，筛选标签容器数量为 0，下拉框直接显示当前类型与状态，右侧只显示“重置”，筛选后得到 5 条匹配数据且页面横向溢出为 0；点击重置后恢复“1–20 / 共 25 条”，重置按钮按预期隐藏，亮色主题保持不变。
- 潜在影响：用户不能再通过单个筛选标签的关闭按钮逐项移除条件，改为直接修改对应下拉框或使用统一重置；搜索、类型和状态筛选结果、分页、插件启停和接口不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-027/` 按原相对路径恢复 `web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `8d64c3fcf047505f77043c3c2482f3ca78662e79d26f77cafdf9c2aa4ff96453`、`7029d48ef22f5fab315250d75261f511cd3352cd817ebca316ccd0c94b0649ae` 和 `01cb29ab06a7918b2ebbf38db128054b18db07fbfdc64ce9f9fec0597ebcf0e1`。

## 批次 028：统一资源表格列对齐并展开单项菜单

- 日期时间：2026-08-27 23:22 CST
- 目的：修正用户管理表头与内容对齐不一致的问题，取消只有单个剩余动作的“更多”菜单，并将同一规则同步到其他平台资源入口。
- 修改前状况：用户管理的邮箱、角色、状态和注册时间等短字段仍按左侧起点排列，积分右对齐，操作列右对齐，表头与内容在宽列中显得参差；详情和编辑已直接显示，但停用/启用用户单独藏在“更多”菜单。提示词模板的“更多”同样只包含删除版本一个动作；渠道和插件的结构化短字段对齐方式也未完全统一。
- 涉及文件：`web/src/pages/admin/users/users-columns.tsx`、`web/src/pages/admin/channels/channels-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`web/src/pages/admin/plugins/plugins-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：用户名称继续左对齐，邮箱、当前积分、角色、状态、注册时间及操作的表头和内容统一居中；用户操作列扩展并直接显示详情、编辑用户、停用/重新启用，不再使用单项“更多”。系统渠道保留渠道主信息左对齐，将模型、最大并发、凭证、状态和操作居中；其更多菜单仍包含停用/启用与删除两项，继续保留。提示词模板保留模板类型与版本左对齐，将输出、状态、更新时间和操作居中，并直接展开启用与删除两个次操作。插件管理将类型、作用范围和平台状态统一居中。设计规范新增主信息左对齐、结构化短字段与操作居中，以及单项菜单必须直接展示的统一规则。
- 验证结果：在真实 2048×941 PC 环境逐页复测。用户页除选择框和用户主信息外，邮箱、积分、角色、状态、注册时间、操作的表头与首行内容均为 center，操作区直接显示“详情 / 编辑用户 / 停用用户”，更多按钮数量为 0；当前账号不可停用约束保持，停用按钮正确禁用。渠道页模型、并发、凭证、状态和操作均居中，更多菜单仍准确包含“停用渠道 / 删除渠道”两项。提示词模板的输出、状态、时间和操作均居中，启用与删除直接显示，更多按钮数量为 0。插件页类型、作用范围、平台状态和卸载均居中。四页横向溢出均为 0；暗色用户页对齐一致，测试结束后恢复亮色主题。
- 潜在影响：用户和提示词模板操作列变宽，原单项更多菜单改为直接按钮；系统渠道的双项更多菜单继续保留。操作确认、禁用条件、接口、筛选、分页和移动端布局逻辑不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-028/` 按原相对路径恢复上述六个文件；修改前 SHA-256 依次为 `8592e72c928af7202395ffdd33b87ce4a5ecfb1ed033d8720945f89cf513fa2d`、`95fde3c969dcd33c4f0ff902343428b59415d9c02819ed4c3885bb4cd579f2d1`、`8f4145edcffb984c84832ccf492f483e064b37d3470a18520cbcb9b407fd459d`、`f83f6c748ecd5e52906968374aaea24ecdb9e961a198b1124a392f9a2fef45a7`、`e619e6f22a96a38bd2dc556eac03a542afd175c35b36f01853cbc571ad3dd9e9` 和 `c843d7f972cdc207067cd527d5f9398474bd6bbdff3ddf5d07afd7a45d818f29`。

## 批次 029：统一平台资源筛选控件

- 日期时间：2026-08-27 23:29 CST
- 目的：统一用户管理搜索栏右侧控件与系统渠道、插件管理、提示词模板的筛选样式、尺寸、文案和反馈方式。
- 修改前状况：用户管理的角色和状态使用自定义 Dropdown + Button，默认仅显示“角色 / 状态”，而其他资源页使用 Ant Select 并显示“全部类型 / 全部状态”；按钮箭头、内边距和选中反馈均不同。用户、渠道和提示词模板还会在选择后生成重复筛选标签，与已精简的插件页不一致。
- 涉及文件：`web/src/pages/admin/users/users-panel.tsx`、`web/src/pages/admin/channels/channels-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：用户角色和状态改为与其他入口一致的 Ant Select，宽度均为 128px，默认文案改为“全部角色 / 全部状态”，移除原自定义 FilterMenu 和 ChevronDown；用户、渠道和提示词模板移除重复的筛选标签，与插件页统一为选择框直接显示当前值、有筛选时仅显示单个重置按钮；为用户角色/状态、渠道状态、提示词类型/状态补充明确 `aria-label`；在设计规范中固化资源页筛选控件尺寸、反馈和可访问性规则。
- 验证结果：在真实 2048×941 PC 环境逐页复测。四个入口搜索框均为 360×36px；用户角色、用户状态、渠道状态、提示词状态和插件状态均为 128×36px，提示词类型为 160×36px，插件类型为 176×36px。四页筛选标签容器数量均为 0，且横向溢出均为 0。用户角色选择“管理员”后 URL 正确更新为 `?role=admin`、列表返回 1 条并显示重置按钮；重置后恢复默认筛选。暗色主题下输入框与选择框统一使用 `rgb(34,38,42)` 表面、18% 边框及 36px 高度，测试结束后恢复亮色用户页。
- 潜在影响：用户页角色与状态筛选由按钮菜单改为标准选择框；用户、渠道和提示词模板不再提供筛选标签的逐项关闭按钮，改为直接修改选择框或统一重置。筛选参数、接口请求、分页、列表数据、权限和移动端逻辑不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-029/` 按原相对路径恢复 `web/src/pages/admin/users/users-panel.tsx`、`web/src/pages/admin/channels/channels-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `b0537dd2c8ebbbe1a7ccb62c9e7d0064443984c906a71ed0d0e8a4dfa6b8ed70`、`bec2da94b22a241bc3c9311f8c0c6a3f007439d8c36c475f82eafdb94ceda15a`、`481cd939f51301b9d76eb05a1c49cabc5f2c4e9f1882d76f86b49adb1be24c8d`、`96762ae6d5ffe0cbe7ecdeb37c66252217900c8f1ac215e8054a3cdb1a40e430` 和 `a6597ea4ceba1f58e4b11e89d5028a3ef0dd3d9cc4f1821c3b433b4f0e8346c9`。

## 批次 030：侧栏中部边缘收纳与图标模式

- 日期时间：2026-08-27 23:32 CST
- 目的：将 PC 管理后台侧栏的收纳入口移到侧栏与内容区的中部边缘，并让收起状态保留完整的图标导航，减少顶部品牌区拥挤。
- 修改前状况：收纳按钮位于侧栏顶部品牌区域；侧栏收起后品牌标识也随文字一起消失，顶部只剩收纳按钮，视觉重心不稳定。收纳动作与真正发生宽度变化的侧栏边界距离较远，也不够直观。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除顶部品牌区的收纳按钮，在侧栏与主内容分界线的垂直中部新增胶囊形边缘按钮；展开时按钮跨在 224px 分界线两侧，收起时随侧栏移动到 64px 分界线；收起状态继续展示品牌图标、各导航图标和底部功能图标，仅隐藏文字；保留原有本地状态记忆，不改变路由、导航权限或功能入口；补充悬停、键盘焦点、亮暗主题表面以及“展开侧栏 / 收起侧栏”的提示和无障碍名称；设计规范同步固化侧栏宽度、图标模式和边缘按钮位置。
- 验证结果：在真实 2048×941 PC 环境验证。展开时侧栏宽 224px、内容起点 x=224、边缘按钮 x=213 且宽 22px；收起时侧栏宽 64px、内容起点 x=64、边缘按钮 x=53，侧栏仍包含 21 个 SVG 图标且无横向溢出。收起后刷新页面，仍保持 64px 与“展开侧栏”状态，说明记忆机制有效；再次展开后恢复 224px，顶部收纳按钮数量为 0。暗色主题下按钮背景为 `rgb(26,29,32)`、边框为 16% 白色混合，层级与侧栏一致；测试结束后恢复浅色、展开状态。`globals.css` 已通过 PostCSS 解析，相关文件通过 `git diff --check`，回滚副本和四个修改前 SHA-256 均已复核。全量 TypeScript 检查仍被项目既有的 Tiptap 3.28.0/3.30.1 类型重复问题阻断，报错仅位于画布富文本与章节编辑文件，本批侧栏文件没有新增类型错误。
- 潜在影响：PC 端侧栏收纳入口由顶部移动到侧栏中部边缘；熟悉旧位置的用户需要适应新位置。收起状态比原来多保留品牌图标；路由、导航项目、feature flag、状态记忆键、业务接口和移动端导航均不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-030/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `d24b4caea54e17032d1bc06b11468abd85dd5dc6ec99fc41eb836ef26297f1a4`、`160bcb8fde505876024605b98943b7945bfbcb21703c0841ecdcf70a0dbf0640`、`ad5ee8859b0685da3913cd92b9291be62f6aed67754df2d698c09e1da80bb3fe` 和 `f46eafee4c799a1dced1c9722cfd4c34c3ae81300e291a82320a3c0cb5294936`。

## 批次 031：强化侧栏分组归属并弱化收纳把手

- 日期时间：2026-08-27 23:38 CST
- 目的：让侧栏的分组标题与所属入口形成明确的可视层级，同时降低中部收纳按钮的突兀感。
- 修改前状况：“概览、平台资源、运营、系统配置”等标题与入口主要依靠上下间距区分，入口左边缘和标题接近，无法直观看出归属关系；中部收纳按钮为 22×46px 的高对比悬浮胶囊，并带明显阴影，在长侧栏分界线上过度抢眼。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为每个展开态导航分组增加统一的组内入口容器；分组标题保持左侧基准，组内入口整体向右内缩，并在入口左侧增加贯穿该组的低对比竖线，形成“标题 → 竖线 → 所属入口”的层级关系；适当增加组间距离。收纳状态不绘制归属线，继续使用原有分隔线和纯图标模式。中部收纳按钮缩小为 18×34px，图标同步缩小，取消阴影，默认使用侧栏同色背景和 68% 不透明度，仅在悬停时提升背景与对比。
- 验证结果：在真实 2048×941 PC 环境验证。展开态四个分组标题起点均为 x=12，归属线为 x=21，首个入口起点约 x=29.8、可用宽度约 181.4px，长标题“第三方参数配置”完整可见，页面横向溢出为 0；当前项边框、图标、文字和竖线层级协调。收纳态侧栏仍为 64px，归属线不占宽度，图标与分组分隔线保持正常。按钮展开位置 x=215、收纳位置 x=55，尺寸均为 18×34px，背景与侧栏相同、无阴影。暗色主题下归属线约为 10.45% 白色混合，按钮使用 `rgb(17,19,21)` 侧栏底色和 12% 白色边框；测试结束后恢复浅色展开状态。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`；定向 TypeScript 输出中没有 `admin-shell.tsx` 错误。
- 潜在影响：展开态导航入口的水平可用宽度减少约 17px，但当前最长入口文字仍可完整显示；收纳按钮默认对比降低，需要在侧栏分界线中部识别。导航路由、权限、feature flag、收纳记忆、业务接口和移动端导航不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-031/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `af81a6bafcc242fb84582878bdef6791fda2d2dd3870eb9aea41761be21be145`、`8535f6850071ecf401c395ee558d7708e77da58e7c5f95f06235e4d06db42a03`、`7bc7907899425da24041184f5a7c8a411d2bc8276776326a2e888850fab76bf5` 和 `9f8633600c4fc09bf3b983eda06157d530cd15ba0ed91ef87f82d9e9be38fdbf`。

## 批次 032：重设计树状分组标题与边界缺口把手

- 日期时间：2026-08-27 23:44 CST
- 目的：解决侧栏分界线穿过收纳按钮的问题，并将用户提供的分组归属思路完善为更精致、可识别当前分组的完整侧栏设计。
- 修改前状况：收纳按钮整体设置 68% 不透明度，侧栏右侧分界线会透过按钮背景，在控件中间形成穿透感；分组标题虽然已有竖线和缩进，但仍是普通粗体文字，没有标题节点、当前分组反馈或视觉收束，整体偏机械。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：收纳控件改为 20×36px 的边界缺口式把手，使用完全不透明的侧栏底色，并通过 3px 同色外围遮罩切断侧栏分界线；面板图标改为更轻量的左/右方向箭头，保持边界位置、悬停反馈和状态记忆。分组标题重构为“圆形节点 + 小号标题 + 右侧渐隐短线”的树状分组头；当前路由所属分组自动使用实心节点和主文字色，其余分组保持空心节点和弱化文字；组内竖线与标题节点对齐，入口保留适度缩进和更充分的文字宽度。收纳状态不渲染分组标题，树线宽度为 0，仅保留原有图标和分组短分隔。
- 验证结果：在真实 2048×941 PC 环境验证。展开态当前“平台资源”分组正确显示实心节点，其他分组为空心节点；标题起点 x=12、树线 x=16、入口起点约 x=25.8，可用宽度约 185.4px，最长入口文字完整，横向溢出为 0。边界把手位于 x=214、宽 20px、高 36px，背景为 `rgb(243,244,246)`，3px 同色遮罩完整覆盖分界线，按钮内部无穿透线。收纳态侧栏宽 64px、把手 x=54，四个组内容器边线宽度均为 0；再次展开后状态正常。暗色主题下遮罩自动使用 `rgb(17,19,21)`，当前分组节点与标题使用主题主文字色，页面无溢出；测试结束后恢复浅色展开状态。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`；定向 TypeScript 输出中没有 `admin-shell.tsx` 错误。
- 潜在影响：分组标题的字号由 12px 调整为 11px并增加字距，当前分组会比其他标题更醒目；收纳图标由面板符号改为左右箭头。导航项目、路由、权限、feature flag、业务接口、收纳状态记忆和移动端导航不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-032/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `eb2cecc4fd5cc4120ba592e788a9ddc646368f131e82770921f0038f9dc391bf`、`75799b84904ab0c4ceaed59676f35944a321ec0816f07409f98a18616187e693`、`e93d7af9101def4254539bc25b5ccc4f90a1c1d8e5282639f723625fc49d8509` 和 `2d78643cdcb2eca80c51c0c15080fffb156ed2df1e2e5b3db5c33268a4b1d7e4`。

## 批次 033：增强侧栏文字与当前入口对比

- 日期时间：2026-08-27 23:47 CST
- 目的：解决亮色和暗色主题下侧栏文字偏淡、当前选择入口不够醒目的问题，确保整页缩放时仍能快速辨认导航层级和当前位置。
- 修改前状况：普通入口最终计算颜色仅为约 72%–74% 前景色，非当前分组标题约为 60%–62%；亮色当前项仅使用白色对 `#f3f4f6`，暗色当前项仅使用 `#1a1d20` 对 `#111315`，底色差和边框都较弱。后置的共享后台文字规则还会覆盖侧栏专用颜色，使前面的增强设置无法完整生效。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：普通入口统一提高为 13px、500 字重和 82% 前景色，图标提高到 16px、1.9 描边和 64% 前景色；分组标题提高为 12px、700 字重和 68% 前景色，标题渐隐线及树线同步略微增强。当前入口改用三级强调表面、26% 前景色边框、700 字重和轻阴影，并继续保留左侧位置指示；悬停项使用更清楚的主题混合表面和 16% 边框。拆分后置共享规则，使其不再把入口和分组标题覆盖回旧的弱对比颜色。
- 验证结果：在真实 2048×941 PC 环境逐项测量。亮色普通入口最终为 82% 深色、13px/500，分组标题为 68%、12px/700；当前入口背景为 `rgb(236,239,243)`、26% 深色边框和 700 字重。暗色普通入口同样为 82% 浅色，分组标题为 68%；当前入口背景为 `rgb(43,48,53)`、26% 浅色边框和 700 字重。两套主题横向溢出均为 0。导航到“积分运营”后当前入口与“运营”分组同步强调，返回“系统渠道”后正确恢复到“平台资源”，路由和选中联动正常；测试结束后恢复浅色系统渠道页。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`。
- 潜在影响：侧栏整体文字比上一版更清楚，当前入口背景和边框更明显；信息密度与布局尺寸基本不变。导航路由、权限、feature flag、业务接口、收纳状态、树状结构和移动端导航不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-033/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `63729a879bc0b9df4d98d26cc42886ebc446b1f5856dd80ee79cadcb8cd51ccb`、`5f621a96d3318b843db8ad291e01dd3f9284278aba198189602078b85631475c` 和 `64bb90fe3f9da4a5c951b8e188de467c8b0acc19a30b4dd815241c4f2e9898a0`。

## 批次 034：修复管理后台 Tooltip 主题文字对比

- 日期时间：2026-08-27 23:52 CST
- 目的：修复收起侧栏悬停提示在暗色主题下出现深底黑字的问题，并统一管理后台所有 Tooltip 的亮暗主题文字、背景、边框和箭头。
- 修改前状况：全局 Ant Tooltip 的背景颜色与文字 token 来源不一致；暗色管理后台使用深色提示背景，但 `colorTextLightSolid` 会跟随暗色主按钮采用黑色文字，形成几乎不可读的深底黑字。管理后台页面又没有挂载创作区的浮层主题作用域，因此已有浮层规则无法覆盖。收起后的纯图标导航链接也没有自身无障碍名称，只依赖悬停提示表达入口含义。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：管理后台挂载期间在 `body` 添加独立 `admin-overlays` 作用域，离开后台时自动清理；为该作用域分别定义亮暗 Tooltip 背景、文字、边框和阴影变量，并同步覆盖提示箭头。亮色使用白底 `#171717` 文字，暗色使用 `#2b3035` 底和 `#fafafa` 文字，字号统一 12px/500。该规则覆盖后台侧栏、主题切换及其他 Ant Tooltip，但不影响创作端。为收起状态的每个导航入口及“返回创作台”链接补充明确 `aria-label`。
- 验证结果：在真实 2048×941 PC 管理后台验证。暗色作用域最终变量为背景 `#2b3035`、文字 `#fafafa`、22% 白色边框；亮色为背景 `#ffffff`、文字 `#171717`、22% 深色边框，主题切换时作用域和变量即时更新。收起状态下“积分运营”链接可通过无障碍名称准确定位，获得键盘焦点后当前元素名称为“积分运营”；页面横向溢出为 0。测试结束后恢复浅色系统渠道页，侧栏保持用户检查时的收起状态。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`；定向 TypeScript 输出中没有 `admin-shell.tsx` 错误。
- 潜在影响：管理后台的 Ant Tooltip 统一改用专属亮暗配色，不再沿用可能冲突的全局按钮文字 token；进入后台时 `body` 增加一个仅用于浮层作用域的类名，离开时清理。导航路由、权限、点击行为、主题状态、业务接口和创作端浮层不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-034/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `19fb161d722d3084b85be813eb934042a652ec298f141cc39b144f8e40f319ee`、`008563c4e1003c9d93e66f1ddbebae85f68dd652f3936e184df629548ca4fcf1`、`1c1d67e3d1c064443c45edd07f1cbd55b4895a9c0db2e2bd699825a03f95fb04` 和 `0f7d9e25bd47f1dcadc2acf36f76f2ed8ea6b4d548957584b36bb7dc3c310f6d`。

## 批次 035：侧栏图标提示改为强反色并兼容新版容器

- 日期时间：2026-08-28 00:00 CST
- 目的：进一步提升收起侧栏图标提示的辨识度，并解决新版 Ant Tooltip 实际文字容器未命中旧样式选择器的问题。
- 修改前状况：管理后台已经建立独立 Tooltip 主题变量，但侧栏提示仍沿用普通浮层层级；更关键的是当前 Ant 版本实际使用 `.ant-tooltip-container` 承载文字，而原规则只覆盖旧版 `.ant-tooltip-inner`。因此箭头颜色已经变化，文字容器仍使用组件默认的深底黑字，暗色主题下依旧不清楚。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为侧栏导航、更新日志、返回创作台和边界收纳把手的 Tooltip 统一添加 `admin-sidebar-tooltip` 专用浮层类；侧栏提示改为主题反色方案，亮色界面使用 `#171717` 深底白字，暗色界面使用 `#f5f5f5` 浅底 `#171717` 深字，并使用 13px/650、强化边框和对应阴影。提示箭头与浮层同步反色。所有后台 Tooltip 选择器同时兼容 `.ant-tooltip-inner` 和新版 `.ant-tooltip-container`，不再依赖旧版内部结构。
- 验证结果：在真实 2048×941 PC 环境通过点击收起侧栏图标保持真实指针悬停，成功抓取可见 Tooltip。暗色“兑换码”提示框实际为 `rgb(245,245,245)` 背景、`rgb(23,23,23)` 文字、88% 白色边框、13px/650，浮层尺寸约 56.6×36px，截图中呈明显浅色提示块；亮色“插件管理”提示为 `rgb(23,23,23)` 背景、纯白文字、13px/650，尺寸约 68.3×35.3px。两套主题均已确认专用根类、提示文字和箭头生效。测试结束后恢复浅色系统渠道页并保留侧栏收起状态。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`；定向 TypeScript 输出中没有 `admin-shell.tsx` 错误。
- 潜在影响：收起侧栏提示比普通后台 Tooltip 更醒目，暗色界面会显示浅色提示块，这是为快速识别图标入口而采用的有意反色设计。导航、主题、路由、权限、业务接口和展开态文字不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-035/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `ee5115973143fe81b2b2c829bad8df26170ad6bb13abe80824f7abceef3d81b9`、`7e3643b4063e313cb13df34ea2d2e900d917c687d9b5a082e0ec145c76a222bc`、`357ce20f32a75dcd86a39782d7ac5b3290209859ac9339481d7f5bbcc6ddb594` 和 `7eb232d624b1092f91cb1d8890cff27c97366db5b2b1e6bd23c941b062dbdb2f`。

## 批次 036：侧栏提示背景按文案自适应

- 日期时间：2026-08-28 00:01 CST
- 目的：让收起侧栏的提示背景根据实际文字长度自动收紧或扩展，避免短文案留出多余背景、长文案被固定宽度挤压。
- 修改前状况：侧栏提示已经具备高对比反色，但尺寸仍主要依赖组件默认布局，没有明确规定内容驱动宽度、内边距和长文案换行边界；不同 Ant 内部规则还可能覆盖预期内边距。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：侧栏 Tooltip 根容器和实际文字容器统一使用 `width: max-content`，移除隐含最小宽度；内边距明确为上下 6px、左右 9px；短文字自动收紧，长文字自然扩展。最大宽度限制为 220px与视口减 24px中的较小值，只有超过安全宽度时才允许自然换行，并保留新版与旧版 Tooltip 容器兼容。
- 验证结果：在真实 2048×941 PC 环境通过实际点击并保持指针悬停测量。亮色“兑换码”提示宽约 58.6px、高 36px；“第三方参数配置”宽约 110.6px、高 36px；暗色“系统公告”宽约 71.6px、高 36px。三者根容器宽度均与文字容器完全一致，内边距均为 6px 9px，最大宽度为 220px，亮暗反色正常且页面横向溢出为 0。测试结束后恢复浅色系统渠道页并保留侧栏收起状态。`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`。
- 潜在影响：侧栏提示框不再保持近似统一宽度，而会随文案长度变化；超过 220px 的异常长文案会自动换行。提示语义、导航、主题、业务接口和其他普通后台 Tooltip 不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-036/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `e0f389235c600025b4a85b9dcba4cb8a9b3d639d47b1f0ac50efa6bd4c2ac2e7`、`50d38b6e70b2d2a1cf681098ac1444e36d92d1f290447e448c9b0fe7fe43631c` 和 `6f19bdf1242a2116a0a4315a25fbec0de3a87b4d341c6ed662499975d59fdd17`。

## 批次 037：积分运营重构为列表优先工作台

- 日期时间：2026-08-28 00:30 CST
- 目的：完成运营区第一批重构，让异常计费核对成为积分运营的默认主任务；将策略配置和人工调账从常驻大表单调整为可控浮层，提升 PC 端表格空间、账务核对效率和高风险操作安全性。
- 修改前状况：页面顶部以等权双卡长期展示积分策略和人工调账，在 1024–1279px 或较矮视口会纵向堆叠并显著压缩计费表；数字输入框实际宽度不足，六位小数难以核对；模型倍率依赖 `模型=倍率` 自由文本；人工调账点击后直接写账，没有用户余额、预计余额和处理依据的二次确认；筛选值被控件和筛选标签重复展示；结算弹窗没有后台浮层主题，且把预授权额描述成冻结积分或最终扣费，Token 订单语义不准确。
- 涉及文件：`web/src/pages/admin/admin-route-pages.tsx`、`web/src/pages/admin/components/credit-operations-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：积分运营页头新增“积分策略”和“人工调账”两个明确入口，主体改为全高异常计费核对表；搜索、队列下拉和统一重置沿用平台资源规范，删除重复筛选标签并补充资源明确的 `aria-label`；时间、金额、状态和操作等结构化列统一居中，分页固定在同一卡片底部。积分策略进入右侧抽屉，基础数字框撑满各列，模型倍率改为可逐行新增、删除和校验的结构化编辑，并明确只影响后续订单。人工调账进入独立抽屉，远程用户搜索增加 300ms 延迟与请求顺序保护，选中后显示当前可用/冻结积分；提交前必须经过用户、变化量、当前余额、预计余额和处理依据摘要，最终确认前不调用写接口，明显余额不足时前端提前阻止。单条和批量计费核对统一使用后台确认层，展示订单数量、预授权总额、用户、模型、场景和订单编号；文案统一为“确认结算 / 退回预授权”，保留 Token 订单按用量结算、批量最多当前页、部分成功与失败项继续核对等原业务语义。列表请求增加旧响应防覆盖和越界页回退；共享页头按钮高度与已选批量栏表面同步后台主题。所有新抽屉、确认层和摘要均使用 `--admin-*` 亮暗主题 token。
- 验证结果：在真实 `2048×986` PC 管理后台完成浅色与深色双主题检查，覆盖积分运营主列表、积分策略抽屉、模型倍率新增行、人工调账抽屉、用户远程选择、余额摘要及调账二次确认；确认摘要正确显示 `99 → 100.5` 的预览，验收后使用“返回修改”关闭，未执行真实调账或策略保存。页面根节点、页面框架和表格均无纵向溢出，横向溢出为 `0`；表格卡片约 `1784×812px`，底部分页稳定。筛选后出现统一“重置”和“没有符合筛选条件的数据”，重置后恢复“当前没有待核对订单”。本次两个 TypeScript 文件没有定向类型错误，组件通过 Prettier 检查，`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`。全量类型检查仍被项目原有 Tiptap `3.28.0/3.30.1` 混装错误阻断；生产打包完成 `11502` 个模块转换后，常规压缩被现有空 `lightningcss` 安装目录阻断，关闭压缩后继续暴露同一 Tiptap `createWidgetDecoration` 版本不匹配，均与本批文件无关。
- 潜在影响：积分运营的策略和调账不再常驻页面，管理员需从页头进入抽屉；人工调账比原流程多一步核对确认；模型倍率输入由自由文本变为结构化行。计费、调账和策略 API、微积分换算精度、后端权限、审计写入、待核对队列组合规则和批量部分成功行为不变。共享影响仅限后台页头 Ant 按钮统一为 36px 高、后台批量栏使用管理端表面 token。
- 逐项回滚：从 `.local/ui-change-backups/batch-037/` 按原相对路径恢复 `web/src/pages/admin/components/credit-operations-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `e86904d3df64364dc50f964cd8ff205be249a14e0fc9904a3771e2ad5d174bda`、`072ff669c90926e6ebcfef6a0a75282fe754587b412e798feefa7bb1b3f8c7e2`、`31e107e8f3bd02473dee25a75176fe838b9a0f3ade5a5bb0b53a25ea16c03aea`、`ae09da1db4e2176b6a23daa5ea7ade5bb5d529b025b1cfe4dbc8c394d2a9fcc9` 和 `2b4cc9d60c1a34d39cfc56eb1a1e166c8ada198b3b25388bccb1930e3926f9bd`。

## 批次 038：兑换码重构为安全的批次运营工作台

- 日期时间：2026-08-28 00:53 CST
- 目的：完成运营区第二批重构，让批次列表与核销追踪成为兑换码页面的默认主任务；把批量生成移入受控流程，并统一批次状态、明细、筛选、危险操作、主题层级和键盘焦点。
- 修改前状况：生成表单长期占据列表上方，暗色下表面与页面基底融在一起，且与新增页头入口重复；填写后点击即直接生成，没有单码积分、数量、总额度、有效期和备注的最终核对。创建成功通过本地插入破坏当前搜索/到期筛选；列表及明细请求没有完整的乱序、错误和越界页处理；“有效”实际只表示批次未到期，容易被误解为仍有可用码；筛选值被下拉框和标签重复展示。单码禁用后只修改本地行，在“可用”筛选下会留下不应出现的记录，父批次统计也不同步；写入期间仍可关闭明细。生成结果浮层未进入后台主题，复制异常未处理，大批量明文会全部渲染；抽屉与确认层同时存在时还会触发 Ant 双焦点锁递归。
- 涉及文件：`web/src/pages/admin/redemption-codes/redemption-codes-page.tsx`、`web/src/pages/admin/components/redemption-codes-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页头新增唯一主操作“生成批次”，主体改为填满剩余高度的批次列表并保留 16px 底部安全间距；批次列合并备注与创建时间，金额、数量、四类状态分布、过期时间和操作按结构化字段居中，筛选改为“全部到期状态 / 批次未到期 / 批次已到期”，删除重复标签并补充明确无障碍名称、统一重置、错误空态和请求顺序保护。生成进入 600px 固定底栏抽屉，校验 6 位积分精度、1–5000 整数数量、未来到期时间、500 字备注和 JavaScript 安全整数；表单实时展示单码积分、数量与“批次总面值”，第一次提交只建立核对摘要，最终确认前不调用写接口。确认层显示单码积分、数量、批次总面值、有效期和备注；提交中用同步锁阻止重复执行并禁止关闭。核对层出现时抽屉先退出、返回修改后恢复原值，避免两个焦点锁递归。创建成功从服务端按当前筛选重载，不再本地插入；网络、超时或 5xx 造成结果不确定时绝不自动重试，自动切回未筛选完整列表、持续显示核对提示，并锁定页头和空态的所有生成入口，直到完整列表成功刷新。批次禁用确认补充批次、可用数量、单码积分和受影响总面值；明细顶部增加批次摘要，状态筛选使用查询值 `available` 与返回状态 `unused` 的正确映射，未知状态安全降级。单码禁用期间锁定浮层、筛选、复制和其他行操作，写入后保持锁定直到明细和父列表都完成服务端刷新；查询失败会清空旧数据，避免旧行落入新筛选语义。生成结果和旧批次警告统一使用后台主题 token；结果只预览前 200 个，复制与 TXT 仍包含全部，并在关闭时清除内存明文，下载文件名加入批次短 ID；三处剪贴板操作均处理权限失败。主表改由统一外层负责滚动并设置 1140px 最小内容宽度，消除 Ant 自动布局额外产生的 16px 假横向滚动；新浮层改用 Ant 6 的 `size` 与 `mask.closable` 接口，不产生废弃警告。
- 验证结果：在已登录真实管理后台完成 `2048×986` 和 `1440×900` PC 浅色/深色验收。搜索与中文到期筛选只显示统一重置，过滤空态正确；生成抽屉宽 600px，标题、可滚动正文、固定底栏及亮暗层级清楚，默认 `10 × 10` 的核对摘要显示正确。连续两轮“打开抽屉 → 核对并继续 → 返回修改”均保留表单值，确认层出现时抽屉不在可见层，返回后焦点先回到抽屉再按 Tab 到中文关闭按钮；干净控制台为 0 warning、0 error，`Maximum call stack` 为 0。两档宽度下文档横向与纵向溢出均为 0；主表外层、Ant 内容层和 table 的 `clientWidth/scrollWidth` 分别为 `1782/1782` 与 `1174/1174`，底部间距约 15.6–16px。全程只到“返回修改”，没有点击最终生成、禁用批次或禁用单码，批次数量保持 0。两个兑换码 TypeScript 文件无定向类型错误，Prettier 检查通过，`globals.css` 通过 PostCSS 解析，相关文件通过 `git diff --check`。全量类型检查仍被项目原有 Tiptap `3.28.0/3.30.1` 混装错误阻断；生产构建完成 11,502 个模块转换后，常规压缩被现有空 `lightningcss` 包阻断，关闭压缩后继续暴露同一 Tiptap `createWidgetDecoration` 缺失导出；现有测试脚本因当前环境未安装 Bun 未启动，均与本批文件无关。
- 潜在影响：管理员生成批次比原流程多一次摘要核对；响应结果不确定时，生成入口会暂时锁定，需成功刷新完整列表后恢复。批次状态区会同时展示四类计数，信息密度略高；明细禁用期间暂时禁止关闭和切换筛选。生成、列表、明细、禁用 API，请求字段，微积分换算，后端权限、加密和审计逻辑不变。后端创建接口仍没有持久化幂等键，前端已经禁止自动重试并建立人工核对锁，但跨刷新或跨会话的严格幂等仍需后续后端协议支持。
- 逐项回滚：从 `.local/ui-change-backups/batch-038/` 按原相对路径恢复 `web/src/pages/admin/components/redemption-codes-panel.tsx`、`web/src/pages/admin/redemption-codes/redemption-codes-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `b2dbf6cb9307470c882e15f4a09246178ca28c1089e6cdc8468158145f4a7c1e`、`8b0cdad1b18b4750619236a10d77cee3fb6ce2e272903332d127811deafe0c90`、`17ff346d9d2453ca18b56d551682d3f9c2ab5a237b3f64b31452791374b7e25d`、`39f4218eb1b7c952168486ad36b456452124b328cb7d8dcfa4a900678a1d6a64` 和 `5445050c015aa7246df350c3947476396843cb5f4f5302afd24838695d16b465`。若只回滚某一项，按该文件原相对路径单独恢复；回滚整个批次时覆盖这五个文件即可，不需要初始化或使用 Git。

## 批次 039：系统公告重构为可核对的发布工作台

- 日期时间：2026-08-28 01:25 CST
- 目的：完成运营区第三批重构，让公告列表、发布状态和关闭记录成为默认主任务；将新发布、编辑重新发布、关闭和结果不确定的核对收敛为真实、一致、键盘可用的 PC 运营流程。
- 修改前状况：页面以普通弹窗承载发布，页头没有唯一主操作，筛选重复生成标签，列宽在 1440px PC 视口容易裁切；“编辑”未显示其会刷新发布时间、恢复 active 并清除全部旧已读，“立即展示/移除”也与用户端 5 分钟轮询不符。编辑器称正文为纯文本，但用户端会解析受控 HTML，列表、预览和最终核对效果不一致。列表请求无旧响应防覆盖、越界页回退和成功体结构校验；发布或关闭返回不确定时没有持久核对锁，重试可能重复通知。抽屉与确认层还存在焦点逃到 BODY/插件 iframe、关闭后不回到触发器、复开保留滚动位置和表单首错不获焦的问题。
- 涉及文件：`web/src/pages/admin/components/admin-announcements-panel.tsx`、`web/src/pages/admin/components/admin-announcement-safety.ts`（新增）、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/components/layout/workspace-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页头新增唯一主操作“发布公告”，主体改为公告、类型、发布生命周期和操作四列列表，去掉重复筛选标签，搜索、状态、重置、刷新和底部分页统一现有运营页语言；表格使用 860px 最小内容宽并由外层滚动，与视口底保留 16px。新建与编辑进入 680px 固定底栏抽屉，说明编辑即重新发布、旧已读会清除以及用户端通常 5 分钟内同步；类型指导、实时用户端预览和最终核对层都使用管理端亮暗 token。列表摘要、实时预览、最终确认与用户端统一复用 `AnnouncementContent`，只渲染白名单标签和 http/https 链接。发布和关闭的最终成功体校验 ID、状态、时间、标题、正文、类型及 active 的 `closedAt`；列表校验页码、每页条数、总数与每条关键字段，并用请求序号防旧响应覆盖。不确定响应不自动重试，将操作类型、目标 ID、新旧标题、请求正文、类型和时间保存到当前标签页 sessionStorage，刷新后依标题分页定位并比对目标；页头、空态、行内及 mutation handler 全部受同步锁阻断，只有“刷新完整列表”与“我已核对”两步都完成才恢复写入。两类浮层新增可见控件焦点环、正反向 Tab 闭环、首错聚焦、复开滚动归零和触发器焦点恢复；分页条数 Select 新增明确 aria-label。
- 验证结果：在已登录真实管理后台完成 `2048×1152` 与 `1440×900` PC 亮色/暗色验收。四列表格完整，页面无横向裁切，分页距底约 16px；抽屉宽 680px、正文可滚动、底栏固定，受控 HTML 的强调、列表和链接在预览与确认层结果一致，链接保持 `_blank`/`noopener noreferrer`。搜索、两个 Select、首错表单和纯图标均有明确键盘焦点；Drawer/Modal 正反向 Tab 均未落入 `BODY` 或浏览器插件 iframe，取消后回到页头发布按钮，复开滚动位置为 0；干净控制台 `warning/error=[]`。长标题、无断点标识和长正文在 520px 确认层中无横溢出，长正文仅内部纵向滚动。全程只到“返回修改”，未执行真实发布或关闭；不确定结果条因不应为验收制造写请求，使用源码结构、断词、最小宽度和内部滚动静态验证。Prettier、PostCSS 解析、目标 `git diff --check` 均通过；公告相关文件无定向 TypeScript 诊断，两轮独立源码复核最终通过。后端 `go test ./internal/service -run '^TestAnnouncement' -count=1` 通过。全量 TypeScript 仍被项目原有 Tiptap 3.28/3.30 混装错误阻断；Vite 成功转换 11,503 个模块后被既有缺失的 `lightningcss/index.js` 阻断，`--minify=false` 则继续暴露 Tiptap `createWidgetDecoration` 缺失导出；现有前端测试脚本因当前环境未安装 Bun 未启动，均与本批文件无关。
- 潜在影响：管理员发布或重新发布比旧流程多一次内容与后果核对；编辑按钮明确为“编辑发布/重新发布”，关闭后保留历史行。结果不确定时当前标签页持续锁定公告写操作，需严格列表刷新和目标定位成功后人工确认；如浏览器禁用 sessionStorage，只能在当前页面生命周期保持锁定。公告 API、请求字段、权限、用户端轮询和后端业务逻辑未改。已识别但未在 UI 批次越界修改的后端风险包括：缺少 revision/乐观锁，旧页已读可误标新版本，写入缺幂等键与管理员审计，列表/未读数非同一快照，已读接口缺少解码前请求体上限。
- 逐项回滚：从 `.local/ui-change-backups/batch-039/` 按原相对路径恢复 `web/src/pages/admin/components/admin-announcements-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/components/layout/workspace-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `e6dae265575d61ca37c2a665f0ea3b2b68cd590490864789b8f94f169d837b21`、`61241b6614897fbce2ad9ef4ab1460ac9ab00cb7dd8334a328122364c784bf03`、`ead842de6b068cfa9fa720b109433d683695cdeff5d209d1c436cf7c4a003601`、`a80229e54511555b6fd4b01094b858595597d221b81505cff8ea5ec672e3d0c1`、`135dd5a6686f5bcd9e0c94202cae1a69c0dafe49c2801f772dfe0db1de620ad7` 和 `517c121e905e7f6d1067a2e8fab53b0374eba665bdceded2d9208d7fe18c0013`。`web/src/pages/admin/components/admin-announcement-safety.ts` 为本批新文件，单项回滚时删除它；整批回滚时恢复六个旧文件并删除该新文件，不需要初始化、提交或使用 Git。

## 批次 040：请求明细重构为调用、计费与恢复核对台

- 日期时间：2026-08-28 02:26 CST
- 目的：完成运营区第四批重构，使请求明细优先服务于调用追踪、任务状态、成本核对和异常恢复；统一 PC 端筛选、表格、详情、焦点和亮暗主题，并为上游任务人工恢复建立前后端一致的安全边界。
- 修改前状况：列表默认日期使用本地时间字符串，URL 中缺失、无效、倒序或过长的时间范围会被静默修正，前后端筛选语义可能不一致；日期面板混有英文月份和星期且日期格无完整朗读名称。请求种类、状态、成本和耗时的展示语义不完整，列表行点击与“详情”入口重复，表格选择框缺少明确名称。详情主要平铺原始字段，追踪编号、订单、成本构成、任务状态和敏感载荷边界不清；人工查询是否可用只由前端猜测，旧后端或数据缺失时可能误显示入口，且账务未结算后缺少跨重载的防重复锁。服务端列表与导出对日期参数采用不同路径，非法显式范围可能退化为默认 30 天，容易让管理员误判查询与导出结果。
- 涉及文件：`web/src/pages/admin/logs/logs-page.tsx`、`web/src/pages/admin/logs/admin-api-log-contract.ts`（新增）、`web/src/pages/admin/logs/admin-api-log-safety.ts`（新增）、`web/src/pages/admin/components/api-log-detail-drawer.tsx`、`web/src/services/api/auth.ts`、`web/src/components/layout/app-providers.tsx`、`web/src/styles/globals.css`、`backend/internal/service/provider_task_recovery.go`、`backend/internal/service/analytics.go`、`backend/internal/handler/auth.go`、`backend/internal/service/admin_api_log_contract_test.go`（新增）、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：列表统一采用 UTC 完整日，默认展示最近 30 个完整自然日，URL 日期严格校验并限制最多 366 天；日期选择器明确显示 `UTC · ≤366 天`，禁用越界日期，日期面板全中文且每个日期格提供完整年月日朗读名称。搜索、请求种类、状态、刷新、重置、导出和固定卡片底部分页沿用运营页规范；主信息左对齐，任务、状态、耗时、成本与操作居中，移除行点击，仅保留明确“详情”，为全选和逐行选择框补充中文名称。新增运行时响应校验与统一状态、耗时、成本格式化，列表错误、空数据和筛选空结果分开表达；总成本始终按后端总成本展示，不再受固定请求费是否计费影响。详情抽屉按调用概览、任务与渠道、计费与追踪、请求与响应分组，补充 trace/request/billing 编号复制、载荷敏感信息警告、键盘焦点闭环及关闭后的稳定回焦。后端详情以新增可选字段返回权威恢复资格，读取与真实恢复共用同一判断；仅允许当前用户的失败视频任务、受支持协议、已记录上游任务 ID 且账务未退款的场景，旧后端或资格缺失一律安全关闭。人工查询确认明确同时“尝试恢复”，显示订单与预计成本；请求结果不确定或账务未结算时把锁写入当前标签页会话，禁止重复查询，并引导在新窗口核对积分运营。列表和 CSV 导出共用日期规范化：显式范围必须成对、有效、正序且不超过 366 天，合法 `dateTo` 继续包含当天，非法请求明确返回参数错误；未传日期仍保留原 30 天兼容行为。新增边界与只读资格测试，保证资格评估不写任务状态。
- 验证结果：在已登录真实后台完成 `2048×1152` 与 `1440×900` PC 亮色/暗色验收。页面、表格和滚动区横向溢出均为 0，底部分页与视口保留约 16px；默认日期正确显示 `2026-07-29 → 2026-08-27`，日期面板月份、星期和导航均为中文，日期格朗读为完整年月日。筛选、刷新、重置、错误态、状态徽标、成本、耗时和详情分组在双主题下层级清楚；表格选择框名称、详情首焦点、关闭回焦和载荷预览浮层焦点闭环均通过。失败任务详情在缺少上游任务 ID 时显示权威原因且不出现人工查询入口；验收未点击导出、人工查询或任何写操作。干净整页重载后控制台 warning/error 均为 0。定向服务测试 `TestNormalizeAdminAPICallLogFilter`、`TestAdminProviderTaskRecoveryEligibilityIsReadOnly`、`TestEnrichAPICallLog` 通过，handler 编译检查通过；请求明细相关前端文件无定向 TypeScript 诊断，组件与设计规范通过 Prettier，CSS 通过 PostCSS 解析，相关改动通过 `git diff --check`。变更记录的格式检查只提示第 21 行旧基线表格尚未按当前格式器补齐列宽，本批新增内容无格式差异；为保持历史记录最小改动，没有重排该旧表格。全量服务测试仍有 6 个与本批无关的既有失败，集中在本地私网 URL 安全策略和运行时策略预期；全量 TypeScript 仍被项目原有 Tiptap 3.28/3.30 混装错误阻断。`pnpm run build` 因当前环境没有 Bun 未启动；Vite 关闭压缩后已完成 11,506 个模块转换，最终仍被同一 Tiptap `createWidgetDecoration` 缺失导出阻断；常规压缩另受现有空 `lightningcss` 安装目录阻断。
- 潜在影响：显式传入不完整、无效、倒序或超过 366 天的请求明细日期现在返回参数错误，不再静默回退；合法范围和无日期默认行为不变。详情响应只新增可选的 `providerTaskRecovery` 字段，原 `log` 数据和路由兼容；应用级 Day.js 中文语言会使其他使用 Day.js 的日期控件一并中文化。人工恢复入口比旧版更保守，只有服务端权威资格为可用时显示，真实提交时仍会再次校验。当前列表仍采用 offset 分页且只按创建时间排序，大数据快速写入时可能发生跨页漂移；列表装饰仍需加载用户和渠道全集，导出仍有 10,000 条上限、公式注入与不可用成本按零表达等后续治理点；不存在的明细当前后端可能仍映射为通用错误，载荷脱敏也仍需服务端进一步加强。
- 逐项回滚：从 `.local/ui-change-backups/batch-040/` 按原相对路径恢复 `web/src/pages/admin/logs/logs-page.tsx`、`web/src/pages/admin/components/api-log-detail-drawer.tsx`、`web/src/services/api/auth.ts`、`web/src/components/layout/app-providers.tsx`、`web/src/styles/globals.css`、`backend/internal/service/provider_task_recovery.go`、`backend/internal/service/analytics.go`、`backend/internal/handler/auth.go`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `63cea126c73ce18c2cbc78e644da911dc050b086c46151eb939ecfb14a7ae860`、`6625a08cdc35d3f53a25e0f83bf5a67af2429416c700e4fd5341792cad34a93b`、`95b46e81cec89afa7c0d078a2833d73e210a1c653526e751a1d6baa701c63085`、`6737655068c904ab590d360e1ae4d9b7e483bd58213d5eee9d2b7905dc654fbd`、`d343001741d72a756863aebe5ea10751da61fb7f422ff3c152d861188a531965`、`610f7af9560fb74b8b61d5806e2a113e8abb6f27934bd36fc8f802574b3b7cbe`、`0e634bfbb4d221849c1f441ba660151897dee58c44bee02864dde73c7c9e74a1`、`ca818bd4cee1e78de0681776462a3e7b0f9f9e575dd0f85b986eb9eaa6d2a640`、`c36d897e5a931961ca70ce70d15de660ca1f2f48d6f1bae2eb4da831a06ce163` 和 `db149f9a6067aab7a12d0b6c0ba601521244b877f46f69912c5210ec6956cbd8`。`web/src/pages/admin/logs/admin-api-log-contract.ts`、`web/src/pages/admin/logs/admin-api-log-safety.ts` 和 `backend/internal/service/admin_api_log_contract_test.go` 为本批新文件，单项回滚时删除相应文件；整批回滚时恢复上述十个旧文件并删除这三个新文件，不需要初始化、提交或使用 Git。

## 批次 041：功能开放重构为可核对的全站开关控制台

- 日期时间：2026-08-28 02:45 CST
- 目的：开始系统配置区重构，让全站功能开关在 PC 端具备清晰的分组、有效状态、依赖关系、配置来源和统一核对流程，消除单次误触立即改变用户入口、计费或模型来源的风险。
- 修改前状况：七个可写开关分散在“用户功能开放”和“管理后台功能”两张宽卡片中，1440px 工作区左侧摘要列长期留白，右侧长行难以快速比较；原始路由标签比业务影响更醒目。除积分和前台模型关闭外，其余 Switch 点击后立即调用写接口，管理员无法组合调整、统一核对或撤销；读取失败只有短暂消息，没有页面级重试，刷新请求、旧响应与错误状态也未形成明确反馈。页面没有使用后端已经返回的配置来源、更新时间、操作人和桌面本地渠道只读能力；插件中心与系统插件可见性的依赖只表现为一个禁用开关，未说明保留偏好但当前不生效。保存响应没有运行时字段校验，未保存修改也没有浏览器刷新或后台内部导航保护。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面顶部新增持续可见的状态与操作栏，正常状态说明所有开关先在本页暂存，存在改动时显示待保存数量、“尚未生效”、撤销、刷新和“核对并保存”；开关点击不再调用 API，最终确认前不会发生写入。新增用户功能、用户模型来源、普通用户插件和配置来源四项概览，并显示后端 `configured`、`updatedAt`、`updatedBy` 的真实信息。主体按“用户工作台、插件策略、模型与运行能力”重组为双列规则卡；移除技术路由标签，改用业务范围、当前状态和开启/关闭后果。系统插件可见性明确依赖插件中心：父项关闭时保留原偏好、禁用子开关并显示“随插件中心关闭”；有效开放数和概览按真实有效状态计算。桌面本地渠道作为部署环境只读能力独立展示，不混入保存请求。刷新加入请求序号保护，初次读取失败显示可重试页面，已有数据刷新失败时保留上次成功状态；成功读取同步全局功能状态。最终核对层逐项展示“开放/关闭”前后状态和真实影响，关闭类调整使用危险主操作；成功响应必须包含七个有效布尔值并与提交完全一致，否则安全报错。保存失败不自动重试，保留暂存内容并提示重新读取服务端状态；未保存调整同时通过 `beforeunload` 和 React Router blocker 保护浏览器刷新与后台内部导航。新增亮暗主题卡片边界、待保存强调、只读状态、错误态、加载骨架和减少动画规则，所有颜色继续使用管理端 token。
- 验证结果：在已登录真实后台完成默认 `2048×986` 与较窄 PC 视口（浏览器视口覆盖设置为 `1440×900`，当前环境按 1.25 缩放后内容报告为 `1152×720`）亮色/暗色验收，文档横向溢出均为 0。默认宽度下三组设置卡均为 1440px，较窄视口双列选项仍保持约 424px 可用宽度，文字、状态、Switch 与边界完整；滚动约 747px 后顶部操作栏稳定在 `top=0`，不会遮住卡片操作。暂存开启前台模型后，页面正确出现“1 项调整待保存”，概览切换为前台模型，但管理员导航没有提前出现 `/admin/models`，证明全局状态未在保存前改变；核对层准确显示“关闭 → 开放”和对应影响，取消后焦点返回“核对并保存”。暂存关闭插件中心后，普通用户插件概览变为“入口关闭”，有效开放数为 `0/2`，系统插件可见性保持勾选偏好但不可操作并显示依赖说明。带未保存修改点击“绘图工具”时出现离开保护，选择继续编辑后仍停留当前页；所有验收修改随后通过“撤销改动”恢复，没有点击最终“保存并生效”，未执行真实写操作。暗色下选项表面为 `rgb(34, 38, 42)`、边框为 16% 白色混合，待保存使用清晰警示边线；最终恢复亮色、无改动、无浮层和默认视口。干净整页重载后控制台 warning/error 为 0。功能开放相关 Go 服务测试全部通过；本批组件无定向 TypeScript 诊断，Prettier、PostCSS 解析和 `git diff --check` 通过。全量 TypeScript 的 30 个诊断仍全部来自项目既有 Tiptap 3.28/3.30 混装；`pnpm run build` 因当前环境缺少 Bun 未启动，Vite 常规构建完成 11,506 个模块转换后被既有空 `lightningcss` 安装目录阻断，关闭压缩后继续被同一 Tiptap `createWidgetDecoration` 缺失导出阻断。
- 潜在影响：功能开关由“单项点击立即保存”改为“多项暂存、统一核对并保存”，管理员需要完成一次明确的最终确认；这是有意增加的全站配置安全步骤。刷新会同步服务端当前功能到本管理员标签页的全局状态，可能随真实配置显示或隐藏“前台模型”等依赖入口；暂存期间不会改变导航和其他用户状态。插件中心关闭时系统插件可见性偏好继续保留，重新开启插件中心后会恢复其原偏好，后端存储语义不变。读取响应缺少任一七个可写布尔值时页面现在安全进入错误态，不再用不完整数据渲染。现有 GET/PATCH 路由、请求字段、权限、默认值、审计和服务端功能判断均未修改；本批仍只优化 PC 体验，没有展开移动端布局。
- 逐项回滚：从 `.local/ui-change-backups/batch-041/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `b3ff974dfe9c0ab610aa6c928ab907a0f29ab84199916d4695007ea7812bad0f`、`7af1d92168a639b377c1ac2c73526e89f77d1d65f092db69d96a421ce95c30cc`、`bfac3ca0724b60c663f4942b9cee28d833bfc3a91487efd65525f0189b5920bf` 和 `a53f0051cb24e7e3e1afcd8b9c6cf6448a8ce0e6d718cace9d24cd5eca941f4d`。四个文件均为本批修改前原样副本，整批或单项回滚都只需覆盖对应文件，不需要初始化、提交或使用 Git。

## 批次 042：功能开放适配高分辨率缩放后的超宽工作区

- 日期时间：2026-08-28 03:04 CST
- 目的：修复高分辨率 PC 在浏览器缩放后“功能开放”内容仍停留在 1440px、右侧形成大面积空白的问题，同时保持常规 PC 的卡片密度和可读行长。
- 修改前状况：该页复用了设置页通用 `.admin-settings-stack` 的 `max-width: 1440px`。在约 4096 CSS 像素级的可用视口中，页头会铺满，但状态栏、概览和三组规则都固定在左侧 1440px，右侧剩余空间没有内容；如果只移除宽度上限，四项用户工作台仍保持两列，单张规则卡会被过度拉宽。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为功能开放栈增加高于通用设置规则的本页宽度覆盖，使状态栏、概览和设置分组随 PC 主内容区扩展，其他设置页继续保持 1440px 阅读宽度；为包含四项规则的用户工作台网格增加明确密集型标识，在 2200px 以上改为四列，插件策略和模型能力仍维持两列；超宽状态下限制说明与影响文字的最大行长，避免内容随卡片无限拉长。同步补充功能开放宽屏布局规范。
- 验证结果：使用真实已登录管理后台模拟截图同级的高分辨率缩放状态。浏览器覆盖视口设为 `4096×1320`，当前环境按 1.25 缩放后页面报告 `3277×1056`；功能区宽度为约 `3013px`，右侧仅保留约 `20px` 正常页边距，用户工作台四列各约 `737px`，文档横向溢出为 0。常规覆盖视口 `2048×1232`（页面报告 `1638×985`）时功能区约 `1374px`、用户工作台保持两列；较窄 PC 覆盖视口 `1440×900`（页面报告 `1152×720`）时两列各约 `424px`，两种宽度横向溢出均为 0。亮色与暗色均完成实页检查，暗色卡片表面、边界和主文字保持既有 token；最终恢复亮色、默认视口、无暂存改动和无浮层，页面控制台无 warning/error。组件和设计规范通过 Prettier，CSS 通过 PostCSS 解析，目标文件通过 `git diff --check`，本批文件无定向 TypeScript 诊断。Vite 关闭压缩后成功转换 11,506 个模块，最终仍被项目既有 Tiptap 3.28/3.30 混装导致的 `createWidgetDecoration` 缺失导出阻断，与本批修改无关。
- 潜在影响：功能开放页在超宽显示器上会占用完整主工作区，概览与两项规则组的卡片外框同步变宽，但说明正文保持受控行长；2200px 断点以上用户工作台从两列变四列，页面纵向高度相应减少。功能开关状态、暂存与保存流程、API、权限、其他设置页宽度和移动端规则均未改动。
- 逐项回滚：从 `.local/ui-change-backups/batch-042/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `dfdbd1db89c66d357bd3ca709412b6adeed9e9b15530aefc0353ebe5daa5f230`、`48b76df473bc27c3367b08515699a9c0a11efa62701210fa1974997b6c82d806`、`8418a9a9c20a9a580de7e3b6696ec36a552945e4a7a504ff705b468f8cbb1846` 和 `952307e229028e8d54993f7d4a8e4d13cc1b0fa0c06196af35355fce82bee0bd`。四个文件均为本批修改前原样副本，整批或单项回滚都只需覆盖对应文件，不需要初始化、提交或使用 Git。

## 批次 043：统一功能开放主内容的表面层级

- 日期时间：2026-08-28 03:19 CST
- 目的：消除功能开放页分组标题、内容容器和内部规则卡之间灰白背景交替造成的拼接感，让宽屏主内容更完整、稳定，同时保持规则卡边界清晰。
- 修改前状况：堆叠分组的标题区使用 `admin-layer-2` 灰底，内容区使用 `admin-layer-1` 白底，内部规则卡再次使用 `admin-layer-2` 灰底；宽屏下一组内容横向延伸很长，三层表面形成明显的“灰色标题带、白色内容带、灰色规则块”条纹。分组自身只有阴影没有实体边框，背景交界比业务分组边界更醒目。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：仅在 `.admin-feature-availability` 范围内为业务分组增加管理端卡片边界；分组标题区和内容区统一使用 `admin-layer-1`，保留细分隔线表达结构；内部规则卡改为 `admin-layer-2` 与主表面的 48% 混合色，降低大面积灰块感，同时保留现有边框、圆角和状态层级。待保存规则继续使用警示色轻混合，只读规则使用页面底色与主表面的轻混合，避免两类状态被统一背景抹平。同步把连续一级表面和轻量二级规则卡写入设计规范。
- 验证结果：在真实已登录后台完成超宽和常规 PC 的亮暗主题验收。亮色下分组、标题和内容均为 `rgb(255, 255, 255)`，规则卡为约 `rgb(251, 252, 253)`，分组和规则卡分别保留 15% 黑色边界；暗色下分组、标题和内容均为 `rgb(26, 29, 32)`，规则卡为约 `rgb(30, 33, 37)`，边界为 16% 白色混合，标题文字继续使用高对比主文字 token。超宽状态右侧约 20px 正常页边距，常规 PC 重载后横向溢出为 0；最终恢复亮色、无暂存改动、无浮层，控制台 warning/error 均为 0。CSS 通过 PostCSS 解析，设计规范通过 Prettier，目标文件通过 `git diff --check`。Vite 关闭压缩后成功转换 11,506 个模块，最终仍被项目既有 Tiptap 3.28/3.30 混装导致的 `createWidgetDecoration` 缺失导出阻断，与本批样式修改无关。
- 潜在影响：功能开放页的分组标题不再使用独立灰色底带，视觉分组主要由外框、分隔线、间距和标题承担；内部规则卡底色更轻，但边框对比不变。调整严格限定在功能开放页面，其他设置页、亮暗主题 token、开关状态、暂存与保存流程、接口和移动端规则均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-043/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `2d5604894922796d45b9b95b1bedb4fb45bc40052cb680f51c1393d916530865`、`81bd9980af4cbe6ef69324d60fe8e4524cc053089c0c8e24b20bde16a4c315ee` 和 `11628ca957305e23e06e1586ab47414cd8fce4e601529d2bb440bfb014f3688c`。三个文件均为本批修改前原样副本，整批或单项回滚都只需覆盖对应文件，不需要初始化、提交或使用 Git。

## 批次 044：绘图工具重构为默认编辑器与授权控制台

- 日期时间：2026-08-28 03:35 CST
- 目的：完成系统配置区“绘图工具”的 PC 端重构，清楚区分新建默认编辑器和 tldraw 授权的不同影响范围，补齐状态来源、读取与保存安全、宽屏布局、亮暗主题和键盘交互。
- 修改前状况：默认引擎、tldraw License Key 和保存操作挤在一张 1440px 横向表单里，页面其余区域大面积空置，超宽视口右侧可留下约 2039px 空白；Segmented 只显示两个名称，没有说明可用条件、当前选择和具体后果。页面文案笼统声称配置只影响新建绘图，但移除 tldraw 授权会使当前部署无法打开已有 tldraw 节点。界面把非空密钥描述成“有效”，实际前后端都只判断是否提供，不能验证 tldraw 是否接受。读取失败只显示短暂消息，随后仍可能用会话旧状态开放保存；读取和保存响应没有运行时结构校验，也没有刷新覆盖保护、撤销、最终核对或未保存离开保护。License Key 标签没有关联输入框，禁用 tldraw 后也没有可操作的引导。
- 涉及文件：`web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“状态与操作栏、三项概览、默认编辑器、tldraw 授权”四层结构；概览显示新建默认编辑器、tldraw 实际可用性、后台或部署环境授权来源，以及管理员配置来源、更新时间和操作人。Excalidraw 与 tldraw 改为带业务说明、可用状态和影响范围的可键盘操作规则卡；无授权点击 tldraw 不产生修改，并把焦点引导到授权字段。授权独立成组，明确其会影响全部 tldraw 绘图，只承诺密钥“已提供”，说明浏览器端用途和无法预验证。常规 PC 保持 1440px 单列；2200px 以上状态与概览随主区扩展，默认编辑器与授权两个业务区并排，避免右侧空白和单表单无限拉长。读取加入请求序号、结构校验、页面级错误与重试；已有数据刷新失败时保留上一次成功配置并显示行内错误。默认编辑器和密钥修改只在本页暂存，提供撤销、带放弃确认的刷新、浏览器刷新与后台导航保护；取消离开后恢复到原触发器或稳定操作按钮。最终核对层只显示授权状态不显示密钥内容，移除最后一份有效授权时明确警告已有 tldraw 绘图将无法打开。成功响应必须再次校验默认编辑器和服务端裁剪后的密钥与提交一致；失败不自动重试并要求重新读取核对。
- 验证结果：在真实已登录后台完成交互、亮暗主题和三档 PC 宽度验收，全程未点击最终“确认保存”，没有执行绘图配置写请求。无授权点击 tldraw 后焦点进入 `admin-tldraw-license-key`，默认选择和脏状态保持不变；输入仅用于验收的测试密钥后显示 1 项暂存，选择 tldraw 后显示 2 项暂存，概览同步预览但全局配置未保存。核对层正确显示 `Excalidraw → tldraw` 和“未配置 → 已配置”，且不包含测试密钥原文；点击资源与策略被离开保护阻止，选择继续编辑后焦点回到稳定的撤销按钮。所有测试内容随后撤销并整页重载。较窄 PC 页面报告 `1309×818`，工作区约 1045px，编辑器卡约 502px，授权区约 626/375px；常规 PC 页面报告 `1862×1120`，保持 1440px 单列；超宽页面报告 `3723×1200`，工作区约 3460px，两个业务区各约 1722px，右侧约 19px，三档横向溢出均为 0。暗色分组表面为 `rgb(26, 29, 32)`，规则卡保持清晰选中边界和高对比文字；最终恢复亮色、无暂存、空测试字段、无浮层，控制台 warning/error 为 0。绘图引擎后端定向测试通过；页面和设计规范通过 Prettier，CSS 通过 PostCSS 解析，目标文件通过 `git diff --check`，本批页面无定向 TypeScript 诊断。全量 TypeScript 的 30 个诊断仍全部来自项目既有 Tiptap 3.28/3.30 混装；Vite 关闭压缩后转换 11,506 个模块，最终仍被同一 `createWidgetDecoration` 缺失导出阻断，与本批无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存绘图工具配置；无授权时 tldraw 不再表现为一个没有解释的禁用分段，而是可读取、可触发授权引导但不会被选中的规则卡。超宽视口会把两个配置域并排，常规 PC 仍保持原阅读宽度。本批保留原 GET/PATCH 路由、字段、权限、服务端存储、审计和画布运行逻辑，不修改移动端。服务端仍无法验证 License Key 是否真实有效，也没有幂等键；此外设置保存成功后若审计追加失败，接口可能返回错误但配置已经写入，因此前端在不确定结果时只提示刷新核对而不自动重试。
- 逐项回滚：从 `.local/ui-change-backups/batch-044/` 按原相对路径恢复 `web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `f2e6d8b98a83c7022e1aec57911d932a19adba47504601da5a7b08e394f90e04`、`95de3c96841fa8fa76fe475819f2526a8d6964ac0f36f4ef9e2144084b578370`、`190f3f4ed4dd1f3aac4e12c59bcbf529bf20f18b2418d75d5290a1e2c8d28901` 和 `d0235dbce48540d9dfdd25cb575d11b66c90140a99ccbee636bc293736f7233b`。四个文件均为本批修改前原样副本，整批或单项回滚都只需覆盖对应文件，不需要初始化、提交或使用 Git。

## 批次 045：资源与策略重构为可核对的运行策略控制台

- 日期时间：2026-08-28 03:56 CST
- 目的：完成系统配置区“资源与策略”的 PC 端重构，让 42 项账号配额、任务调度、频控和渠道保护参数具备清晰的配置来源、分组浏览、暂存反馈、保存核对与超宽布局，同时保持既有运行策略 API、权限、默认值和即时生效语义。
- 修改前状况：页面把 42 个数值项连续铺在五张普通设置卡中，只有页头“重置”和“自用模式”两个等权按钮；没有配置来源与关键值概览、分组目录或真实待保存数量。“自用模式”会把全部配置推到高上限，却无需先说明覆盖范围；保存只有页尾按钮，点击后直接提交，没有前后值核对、后台导航保护、响应结构校验或跨字段容量校验。初次读取失败只弹短消息，刷新覆盖、旧响应和不确定保存结果没有明确处理；服务端未保存自定义配置时，零时间还会被格式化成“1/1/1 08:05:43”。通用 1440px 上限使约 2327px 视口中的策略区只占左侧 1440px，右侧保留约 643px 无意义空白；原 `InputNumber` 单体只有约 90px，九位数量难以核对，且旧 `addonAfter` 写法在当前 Ant Design 中产生弃用警告。
- 涉及文件：`web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“状态与操作栏、四项概览、策略目录、五个策略域”结构；状态栏显示服务端同步、系统默认或管理员配置以及真实暂存数量，按需提供撤销、刷新、自用模式草稿、恢复系统默认和核对保存。概览展示配置来源、待保存数、Worker 并发和账号活动任务，参数变化时同步预览但不提前影响服务端。策略目录展示五组的参数数与待保存数，可定位到对应卡片并避开顶部粘性状态栏。常规 PC 维持 1440px 三列参数，较窄 PC 改两列；2200px 以上状态、概览、目录和五张策略卡填满主工作区，参数改为四列。数值控件改为完整列宽的输入与固定单位组合，标签、输入 ID 和无障碍名称明确关联，移除弃用的 `addonAfter`。自用模式先解释会覆盖 42 项草稿和熔断值，只读取并填入本页；恢复默认仅在存在管理员配置且没有暂存时展示，执行前明确说明会删除自定义配置并立即生效。全部普通调整按 42 个字段的真实差异暂存，最终核对层按策略域列出每项“原值 → 新值”和单位；浏览器刷新与后台内部导航均保护未保存内容，取消离开后恢复焦点。读取加入请求序号保护、页面级错误与重试，已有数据刷新失败时保留上次成功内容；运行时校验全部 42 个整数和配置来源，保存前增加“单文件不大于账号文件总容量”校验，成功响应必须与提交值完全一致。保存或恢复失败不自动重试并要求刷新核对；系统默认零时间不再展示伪造日期。亮暗主题、加载骨架、错误态、确认层、焦点态和减少动画均使用现有管理端 token。
- 验证结果：在真实已登录后台完成只读与草稿级交互验收，全程未点击“确认保存并生效”、未确认“填入草稿”、未执行“恢复系统默认”，没有发出策略写请求。将 Worker 并发从 3 暂改为 4 时，状态栏、概览和目录均显示 1 项待保存；核对层准确显示“3 个 → 4 个”。点击“绘图工具”被离开保护拦截，选择继续编辑后仍停留本页；自用模式确认层明确说明 42 项高上限、1 秒熔断等待和仅填草稿。所有测试值随后撤销。亮色与暗色均完成实页检查：暗色一级表面为 `rgb(26, 29, 32)`、输入为 `rgb(34, 38, 42)`，主要文字保持高对比；最终恢复亮色、零暂存、无弹窗和顶部滚动位置。当前约 `2327×1070` 超宽视口中，页面与资源卡宽约 `2063px`，四个参数列各约 `420px`，右侧约 `20px`，横向溢出为 0；数值与单位组合填满 420px 列，单位区约 58px。干净新标签页未出现 console warning/error，错误的“1/1/1”时间不再出现。运行策略、上传配额和存储配额相关 Go 服务测试通过；页面和设计规范通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`。全量 TypeScript 仍有 30 个项目既有 Tiptap 3.28/3.30 混装诊断；Vite 关闭压缩后成功转换 11,506 个模块，最终仍被同一 `createWidgetDecoration` 缺失导出阻断，与本批修改无关。
- 潜在影响：管理员现在需要先暂存、查看字段级核对，再执行一次明确确认才能保存普通策略调整；自用模式多了一次“填入草稿”确认，恢复默认只在当前确实为管理员配置且无暂存时显示，这是有意增加的运行配置安全步骤。超宽 PC 会使用完整主工作区并扩大数值输入，常规 PC 仍保持原阅读宽度，较窄 PC 只调整为两列；本批没有扩展移动端设计。刷新会丢弃草稿前先确认；服务端响应缺少任一字段、配置来源无效或返回值与提交不一致时现在会安全拒绝继续。现有 GET/PUT/DELETE 路由、请求字段、权限、默认值、审计、热更新和运行时策略消费逻辑均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-045/` 按原相对路径恢复 `web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `10a30387f0fef647a2389ccb9a0ddf4a3390863f9979d30373e94d21d4ddf226`、`47983d93478d2ce917644f67b26663a585bb2d66fe13b70ed1c0e6b2c6cf0092`、`b61ebd281ad50bfdea945bfa93e784520c5b0a6702f836e1dbf5df859cc181c7` 和 `ad90cad44b12cec01cb0f22cd1d0929bfc96b63446fd4b544afaa7934db257a8`。四个文件均为本批修改前原样副本，整批或单项回滚都只需覆盖对应文件，不需要初始化、提交或使用 Git。

## 批次 046：修复绘图工具在常见缩放档位下的右侧空白

- 日期时间：2026-08-28 04:05 CST
- 目的：统一绘图工具页在高分辨率 PC 常见浏览器缩放档位下的宽度行为，消除内容被固定在左侧 1440px、右侧形成大面积空白的问题；保持已经正常的功能开放页不变。
- 修改前状况：绘图工具只有在页面 CSS 视口达到 2200px 时才解除设置页通用的 1440px 上限。在用户截图对应的 Chrome 125% 缩放状态中，页面实际 CSS 视口为 2048px、主内容可用宽度为 1784px，但绘图工具栈仍只有 1440px，右侧除 20px 正常页边距外额外空出约 344px；两个业务区继续纵向堆叠。功能开放页已有独立满宽规则，显示正常。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将绘图工具专属的“解除 1440px 上限、默认编辑器与授权区双列、两张业务卡等高”规则从 2200px 断点前移到 1600px；低于该断点仍沿用通用设置页的 1440px 以内单列布局。2200px 断点继续只承载资源与策略及功能开放各自的超宽规则，没有修改功能开放选择器、网格或页面组件。同步明确绘图工具在常见高分辨率缩放档位下的宽度规范。
- 验证结果：在真实已登录管理后台、Chrome 125% 缩放对应的 `2048px` CSS 视口中复测，绘图工具栈由 `1440px` 扩展为 `1784px`，右侧仅保留 `20px` 正常页边距；两个业务区改为 `884px + 884px`，等高约 `278px`，页面横向溢出为 `0`。精确检查断点两侧：`1599px` CSS 视口保持单列和通用宽度，`1600px` 起改为两列并填满主区，两者横向溢出均为 `0`。暗色主题下两张一级卡片均为 `rgb(26, 29, 32)`、16% 浅色边界和高对比文字，满宽规则保持生效；验收后恢复亮色和默认视口，没有修改或保存绘图配置。功能开放页源文件与专属样式未改动。
- 潜在影响：绘图工具在 `1600px` 及以上 CSS 视口会比上一版更早进入满宽双列状态，页面纵向高度缩短；在断点附近每个业务区约 660px，现有内部双卡与授权输入/说明仍可完整排布。较窄 PC、功能开放、资源与策略、其他设置页、移动端规则、主题 token、配置值、接口、权限和保存流程均不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-046/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `6da44604cf2da57031545409a4b6c441a7f7e049d643b7a16d2f5a91a3f1ca17`、`d2b4935a63f2e05aba7db39ad410d93046859e77a37bea6c12ee7d5137bbfd70` 和 `c7e31a6b7e49dcfb0b8b6a3e1b086664765738699f23f213503e98fcd4c2a458`。三个文件均为本批修改前原样副本，可整批或单项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 047：统一剩余系统配置页的宽屏工作区

- 日期时间：2026-08-28 04:12 CST
- 目的：统一修复资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置在高分辨率 PC 常见浏览器缩放档位下的右侧空白；保持已经正常的功能开放和已单独修复的绘图工具行为不变。
- 修改前状况：七个入口均复用设置页通用的 1440px 栈和普通设置卡上限。在用户当前 Chrome 125% 缩放对应的 `2048px` CSS 视口中，主内容可用宽度为 `1784px`，但每页的设置栈和卡片都只有 `1440px`，右侧统一留下 `364px`，其中约 `344px` 是无意义空白。资源与策略另有 2200px 才满宽的专属规则，因此同样没有进入宽屏状态。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在 `1600px` 以上统一解除管理后台系统设置直属栈的 1440px 上限，同时解除满宽设置栈中直属普通设置卡的第二层 1440px 上限；规则覆盖七个剩余入口，也继续兼容功能开放与绘图工具的既有布局，不需要给七个页面逐一增加类名或修改组件。资源与策略的内部策略卡同步从 `1600px` 起满宽；参数网格单独在 `1800px` 起由三列改四列，避免刚进入满宽时单列只有约 238px。原来 2200px 的断点只保留功能开放超宽四列规则。同步把系统设置满宽阈值、输入宽度约束和资源策略分列阈值写入设计规范。
- 验证结果：在真实已登录后台、Chrome 125% 缩放对应的 `2048px` CSS 视口中逐页复测。资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截、第三方参数配置的设置栈和首张业务卡均为 `1784px`，右侧均只保留 `20px` 正常页边距，七页横向溢出均为 `0`。资源与策略在当前宽度使用四列，每列约 `350px`；精确断点验证中，`1600px` 使用三列、每列约 `325px`，`1800px` 使用四列、每列约 `288px`，两档均无溢出。七页暗色主题逐一验证，一级卡片均为 `rgb(26, 29, 32)`、16% 浅色边界和高对比文字，宽度与亮色一致。验收后恢复亮色、默认视口和资源与策略页，无控制台 warning/error；全程没有修改表单、切换业务开关或保存任何配置。
- 潜在影响：七个系统配置入口在 `1600px` 及以上 CSS 视口会使用完整主工作区，摘要列保持既有上限，表单继续由页面原有的两列、三列或结构化行控制宽度；页面纵向结构和业务字段不变。资源与策略比上一版更早进入满宽，并在 `1800px` 起使用四列。较窄 PC、移动端、功能开放规则矩阵、绘图工具双业务区、主题 token、表单值、接口、权限和保存流程均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-047/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `9f76abacbce2203d13b3431fd9e1e540ed2e7a882e25339d693dd79a66fd887a`、`7c4a958e28f04710f019d1847984dc8329aeb9bf8278a642ce02f2389614f0c8` 和 `53555b65d398880658cf91dde2f4d46ac97f86662d78a2c1be03c033be56120b`。三个文件均为本批修改前原样副本，可整批或单项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 048：登录与注册重构为分域访问控制台

- 日期时间：2026-08-28 04:29 CST
- 目的：完成系统配置区“登录与注册”的 PC 端重构，把新用户注册和 Linux.do OAuth 明确拆成两个独立生效域，补齐状态概览、草稿反馈、安全确认、异常恢复、宽屏排版和亮暗主题一致性，同时保持现有接口、字段、权限和登录业务兼容。
- 修改前状况：页面虽然已在批次 047 后填满主工作区，但注册开关点击后会直接写入，未先说明本地注册、未绑定 Linux.do 首次登录和已有账号分别受到的影响；Linux.do 凭据、OAuth 地址、Scopes 和用户字段映射连续堆在一张大卡中，缺少二级层级。Linux.do 修改没有真实待保存状态、撤销、刷新覆盖确认、浏览器刷新或后台导航保护，也没有保存前核对；读取失败只有短暂提示，旧响应和保存响应未做页面级保护。密钥等敏感字段与普通输入处在同一审阅路径，宽屏下信息层级弱且难以快速判断当前入口、密钥和端点状态。
- 涉及文件：`web/src/pages/admin/components/access-settings-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、注册策略、Linux.do 配置”四层结构；概览展示新用户注册、Linux.do 入口、应用密钥和四个 OAuth 端点的服务端状态。注册策略保留独立即时保存语义，但点击开关先展示影响说明，最终确认前不调用写接口。Linux.do 的入口、凭据、OAuth 地址、Scopes 和五项用户字段映射统一进入本页草稿，提供真实待保存状态、撤销、刷新覆盖确认、浏览器刷新和后台导航保护；保存前核对入口前后状态与密钥处理方式，核对层不展示 Client Secret 或任意普通文本输入值。凭据与连接地址分成清晰二级组，高级字段映射使用默认折叠且具备原生键盘语义的详情区。读取加入请求序号保护、页面级错误与重试，已有数据刷新失败时保留上次成功状态；保存前按服务端语义校验 Client、HTTPS 端点和回调地址，允许本地回环 HTTP；成功响应校验全部公开字段与密钥存在状态，失败不自动重试。新增样式全部限定在 `.admin-access-*` 范围，补齐常规、宽屏、窄 PC、亮暗主题、焦点和减少动画状态。
- 验证结果：在真实已登录后台完成只读和草稿级实页验收，全程未确认注册开关、未点击最终 Linux.do 保存，没有发出任何配置写请求。注册开关确认层正确说明关闭后本地注册与未绑定 Linux.do 首次登录会被拒绝、已有账号仍可登录，取消后状态不变。临时填写 Client ID 后出现待保存状态，访问“邮件服务”被导航保护拦截；保存核对层只显示入口和密钥配置状态，不包含临时输入原文，返回修改并撤销后字段恢复为空、脏状态清零。高级映射可展开并展示五项字段。`2048px` 视口中设置栈宽 `1784px`、右侧约 `20px`、概览四等分且无横向溢出；`1600px` 保持四列概览和双列凭据，`1278px` 自动变为两列概览并纵向排列状态栏，两档均无溢出。亮色和暗色均完成卡片、边界、文字与开关检查，暗色一级表面为 `rgb(26, 29, 32)` 且保持高对比；最终恢复亮色、默认视口、无草稿、无浮层，干净新标签页 console warning/error 为 0。页面和设计规范通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`。Vite 关闭压缩后转换 11,506 个模块，最终仍被项目既有 Tiptap 3.28/3.30 混装导致的 `createWidgetDecoration` 缺失导出阻断，与本批无关。
- 潜在影响：注册策略多了一次明确确认，Linux.do 普通调整现在需要先暂存、核对再保存；刷新或离开存在草稿的页面会先询问，这是有意增加的配置安全步骤。高级字段映射默认收起，管理员需要主动展开后编辑；敏感密钥不会进入核对层。较窄 PC 只改变列数和操作栏排列，本批不扩展移动端设计。现有 GET/PATCH 路由、请求字段、服务端存储、权限、审计和登录流程均未修改；服务端若在配置写入后审计失败，仍可能出现接口返回失败但状态已改变的既有不确定性，因此前端失败后只提示重新读取核对，不自动重试。
- 逐项回滚：从 `.local/ui-change-backups/batch-048/` 按原相对路径恢复 `web/src/pages/admin/components/access-settings-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `b9554987c08b1f956296caab5a339e99a808e7125f3b73957e782ab67e0a92e5`、`02cbc1f91177db3d3bea6ccb12f2df3c1691e57f2fd9f02f10b6c75d6d37db53`、`9dd28928ba05251cd68ba866b89e2168c6c7c174d63f2d7191ccbd8dddece1fa` 和 `37a9b7677872c37c4c7592bcf573d2fd855556d8970f77d6436e7ed658a284ac`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 049：邮件服务重构为可核对的 SMTP 配置控制台

- 日期时间：2026-08-28 04:45 CST
- 目的：完成系统配置区“邮件服务”的 PC 端重构，把注册验证码投递、SMTP 服务器、身份验证和发件人身份组织成一组可理解、可暂存、可核对的配置域；保持现有邮件 API、字段、权限、服务端加密和注册验证码业务兼容，不虚构后端不存在的测试能力。
- 修改前状况：页面只有一张横向大表单，启用开关、连接加密、SMTP 地址、账号密码和发件人信息没有二级层级；当前只显示“未启用”和密钥状态，无法快速判断服务器、加密方式、认证与发件身份是否齐全。任意修改都没有待保存提示、撤销、刷新覆盖确认、浏览器刷新或后台导航保护，点击保存前也没有影响核对；初次读取失败只显示短暂消息，读取旧响应和保存响应缺少运行时结构校验。原界面没有说明保存配置不会测试 SMTP 连接或发送邮件，容易把“已保存”误解为“已验证可用”。
- 涉及文件：`web/src/pages/admin/components/email-settings-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、注册验证码投递、SMTP 连接与发件身份”四层结构；概览展示投递状态、SMTP 服务器、连接安全和发件身份，并随草稿预览但不提前改变服务端。投递 Switch 改为统一草稿的一部分，不再表现为独立即时写入；服务器连接、SMTP 身份验证和发件人身份拆成三个有标题、图标和说明的二级组，端口使用完整宽度的数值输入。全部字段提供真实待保存状态、撤销、刷新覆盖确认、浏览器刷新与后台导航保护；最终核对层展示启用前后状态、服务器、加密方式、验证方式和 From 身份，不展示 SMTP 密码，并明确保存不会主动连接或发送测试邮件。读取加入请求序号、页面级错误与重试，已有数据刷新失败时保留上次成功状态；启用前按服务端语义校验主机、端口、发件邮箱、账号密码组合和发件人换行，停用状态允许保留不完整草稿。成功响应校验全部公开字段与新密码存在状态，失败不自动重试。移除邮件路由中重复的外层设置栈，使组件自身的设置栈在 1600px 以上继续遵循批次 047 的满宽规则；新增样式全部限定在 `.admin-email-*` 范围，并覆盖亮暗主题、较窄 PC、焦点和减少动画。
- 验证结果：在真实已登录后台完成只读与草稿级实页验收，全程未点击最终“确认保存”，没有发出邮件配置写请求、SMTP 连接或测试邮件。使用虚构主机、账号、密码、发件邮箱和名称并暂时开启投递后，顶部、概览和两张业务卡均正确显示待保存状态；核对层准确显示“未启用 → 启用”、服务器与 STARTTLS、替换密码和 From 身份，且不包含测试密码原文。点击“存储服务”被离开保护拦截，选择继续编辑后仍停留邮件页；撤销后测试值、开关和脏状态全部清除。默认 `2048px` CSS 视口中设置栈宽 `1784px`、右侧 `20px`、概览四列各约 `445.6px`，连接三列约 `853.2/284.4/568.8px`，无横向溢出；`1600px` CSS 视口中栈宽 `1336px`、概览四列各约 `333.6px`，右侧 `20px`；`1278px` CSS 视口中操作栏纵向排列、概览两列各约 `506.4px`、主机独占一行且端口与加密各约 `477.4px`，右侧约 `19.6px`，三档均无溢出。暗色一级卡片为 `rgb(26, 29, 32)`、边界为 16% 浅色混合、输入为 `rgb(34, 38, 42)`，标题保持高对比；最终恢复亮色、默认视口、无草稿和无浮层，console warning/error 为 0。页面、路由和设计规范通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`。Vite 关闭压缩后转换 11,506 个模块，最终仍被项目既有 Tiptap 3.28/3.30 混装导致的 `createWidgetDecoration` 缺失导出阻断。邮件名称定向的 Go 测试命令通过但当前没有匹配用例；完整 `internal/service` 套件的 6 项既有失败来自私网地址防护、七牛配置和视频恢复策略，与本批未改动的后端代码无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存投递开关和 SMTP 字段，页面纵向高度会比原单卡表单增加，但服务器、验证和发件人关系更明确。密码留空继续表示保留服务端已有值，页面没有提供清除已保存密码的入口，也不会声称配置已通过连接测试；若需要真实测试连接或试发，必须后续增加受权限保护的后端接口与独立审计，不能仅靠前端模拟。本批不扩展移动端设计；现有 GET/PATCH 路由、请求字段、默认值、服务端加密、注册验证码发送与校验逻辑均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-049/` 按原相对路径恢复 `web/src/pages/admin/components/email-settings-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `1f26dd62e0d4232b8dd06cd6a5044ba8416d06a8cf4ccb186566e9dd74e26cc0`、`2126c71c1b267faf6af3833e6fef2bd4a6a5c6bfed8446ebd6835488a3ed11a2`、`d42e02b8d02b9e0efe3a25b86b2ef7d12bc438ac61c461c47a754ec7f636b4b4`、`18ef7b4f23cbe9af828f5059ce59536e56084e0ba38958dcefc0c57162892b1a` 和 `99a428d01d29570832fc0125e26c94b446553fe6687008752ca7d281006d11af`。五个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 050：存储服务重构为新资源去向控制台

- 日期时间：2026-08-28 05:00 CST
- 目的：完成系统配置区“存储服务”的 PC 端重构，把新增资源默认去向、历史资源读取依据、云厂商接入与服务端凭据组织成可理解、可暂存、可核对的配置流程；保持现有对象存储接口、字段、权限、历史资源兼容与服务端安全策略不变，不虚构后端不存在的连接或上传测试能力。
- 修改前状况：页面只有一张横向大卡和分段选择器，本地地址、Region、Endpoint、CDN、Bucket、路径及密钥缺少二级分组；管理员无法快速判断新增资源去向、读取链路、密钥和配置来源，也没有说明云厂商切换只影响新增资源、历史资源如何读取。默认零值更新时间会显示为 `1/1/1 08:05:43`。表单没有真实待保存状态、撤销、刷新覆盖确认、浏览器刷新或后台导航保护，保存前没有影响核对；读取失败只有短暂提示，读取旧响应和保存响应缺少运行时结构及一致性校验。
- 涉及文件：`web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、新资源存储位置、当前模式接入配置”四层结构；概览展示新增资源存储、读取链路、访问凭据和配置来源。服务器本地、阿里云 OSS、腾讯云 COS 与七牛云 Kodo 改为具备 `radiogroup/radio` 语义的规则卡，明确切换不迁移、覆盖或删除历史资源；云厂商切换前单独确认清空厂商草稿，说明最终保存后服务端才归档上一厂商凭据。服务器本地使用公开根地址和当前站点快捷填充；云存储按存储位置、连接与读取出口、服务端访问凭据分组，并分别说明腾讯 Endpoint 自动生成、七牛无绑定域名时后端代理等真实语义。全部调整在本页暂存，提供撤销、刷新覆盖确认、浏览器刷新和后台导航保护；最终核对新增资源去向、写入位置、读取链路、凭据处理与历史资源影响，不展示 Secret 明文，并明确保存不会连接服务、上传文件或验证密钥。读取加入请求序号、页面级错误与重试，已有数据刷新失败时保留上次成功状态；保存前按公开服务端规则校验 URL、CDN 根域名、Bucket 与凭据，成功响应校验全部公开字段和密钥存在状态，失败不自动重试。无有效更新时间时改为“系统默认”，不再渲染零值日期。新增样式全部限定在 `.admin-storage-*` 范围，覆盖常规宽屏、较窄 PC、亮暗主题、焦点和减少动画状态。
- 验证结果：在真实已登录后台完成只读与草稿级实页验收，全程未点击最终“确认保存”，没有保存配置、连接存储服务或上传文件。临时填写虚构的本地根地址后，顶部、概览和配置卡正确显示待保存状态；核对层展示新增资源去向、写入位置、读取链路、凭据处理与历史资源说明。点击“方舟素材库”被离开保护拦截，继续编辑后仍停留当前页，撤销可完全恢复服务端状态。切换阿里云并填写虚构 Region、Bucket、Endpoint、CDN、AccessKey 和 Secret 后，核对层不包含 Secret 原文；再切换腾讯云时出现清空草稿和历史凭据归档确认。默认 `2048px` CSS 视口中设置栈宽 `1784px`、右侧 `20px`、四个模式卡各约 `426.6px`，页面横向溢出为 `0`；`1600px` 视口中栈宽 `1336px`、四个模式卡各约 `314.6px`；`1278px` 视口中操作栏纵向排列，概览与模式选择均改为两列，栈宽约 `1014.4px`、右侧约 `19.6px`，三档均无横向溢出。暗色主题一级卡片为 `rgb(26, 29, 32)`、普通选择卡为 `rgb(34, 38, 42)`，选中边界和文字保持高对比；验收后恢复亮色、默认视口、无草稿和无浮层，console warning/error 为 0。组件通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`；存储本地地址相关 Go 服务测试通过。全量 TypeScript 仍有 30 项项目既有 Tiptap 3.28/3.30 混装诊断；Vite 成功转换 11,506 个模块后仍被同一 `createWidgetDecoration` 缺失导出阻断，与本批修改无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存存储位置或接入字段；刷新或离开存在草稿的页面会先询问，这是有意增加的配置安全步骤。切换到另一云厂商会先清空当前厂商的未保存连接字段，但路径前缀保留，且只有最终保存才改变服务端；较窄 PC 只调整列数，本批不扩展移动端设计。页面只执行公开格式校验，私网主机、协议与出站许可仍以服务端策略为最终依据；保存成功不代表密钥或 Bucket 已通过真实连接验证。现有 GET/PATCH 路由、请求字段、服务端密钥保存、历史凭据归档、资源读取和权限逻辑均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-050/` 按原相对路径恢复 `web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `af9f2993f8b992fb8b847567506c3b81094ce2af04903c7eb810c4f04ba0a8f4`、`d58423e5230654ce0ddf42b325671f301af40584648ade42270bd0497cf7b385`、`78eb44bc52922c549e6be9b198e1e199ff1c82b81f11450119877b33dcaa7369` 和 `c84afc54e1febc773ef636f9897ee377506870fe6df128c1425e3f3170b5b856`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 051：方舟素材库重构为可信素材同步控制台

- 日期时间：2026-08-28 05:11 CST
- 目的：完成系统配置区“方舟素材库”的 PC 端重构，把 Seedance 可信参考素材的触发条件、方舟项目边界、IAM 凭据和保存影响组织成可理解、可暂存、可核对的部署级配置流程；保持现有 API、字段、权限、服务端密钥加密、素材绑定和审核流程兼容，不把该入口误做成素材浏览列表，也不虚构连接、上传或审核测试能力。
- 修改前状况：页面只有一张横向大卡，启用开关、Region、ProjectName、AccessKey 和 SecretKey 连续铺开，缺少状态概览和二级层级；界面没有完整说明什么请求、什么资源会触发可信素材同步，也没有说明停用、切换项目或更换 AccessKey 对已有方舟素材、素材绑定和默认素材组的实际影响。默认零值更新时间错误显示为 `1/1/1 08:05:43`。任意修改没有真实待保存状态、撤销、刷新覆盖确认、浏览器刷新或后台导航保护，保存前没有影响核对；读取失败只有短暂消息，旧读取响应和保存响应缺少运行时结构及一致性校验。
- 涉及文件：`web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、可信参考素材同步、方舟项目与 IAM 凭据”四层结构；概览展示同步状态、方舟项目、IAM 凭据和配置来源。同步开关改为统一草稿的一部分，不再表现为点击即写，并通过三步条件卡说明只有 Seedance/方舟视频任务、用户允许同步、参考图属于当前用户且为已就绪图片时才会触发；停用说明明确普通参考图继续使用原地址，已有方舟素材、审核结果和本地绑定不删除。项目范围和服务端 IAM 凭据拆成独立二级组，说明 Region、ProjectName 或 AccessKey 改变后服务端会清除缓存的默认素材组 ID，并在下一次真实同步时惰性重建。SecretKey 语义与服务端一致：AccessKey 不变时留空保留，AccessKey 改变后留空清除，启用同步前必须提供可用 SecretKey。全部字段提供待保存状态、撤销、刷新覆盖确认、浏览器刷新和后台导航保护；最终核对同步开关、项目、IAM 处理、素材组范围与停用影响，不展示 SecretKey 明文，并明确保存不会连接方舟、创建素材组、上传图片或等待审核。读取加入请求序号、页面级错误与重试，已有数据刷新失败时保留上次成功状态；保存响应校验全部公开字段和密钥存在状态，失败不自动重试。无有效更新时间时改为“系统默认”。新增样式全部限定在 `.admin-ark-*` 范围，覆盖常规宽屏、较窄 PC、亮暗主题、焦点和减少动画状态。
- 验证结果：在真实已登录后台完成只读与草稿级实页验收，全程未点击最终“确认保存”，没有保存配置、连接方舟、创建素材组、上传图片或发起审核。先在空配置下单独启用同步，页面正确拦截并提示填写 Region；随后使用虚构 Region、ProjectName、AccessKey 和 SecretKey 完成草稿，顶部、概览和两张业务卡均正确显示待保存状态。最终核对层展示“停用 → 启用”、项目、AccessKey、SecretKey 处理方式和素材组惰性重建，且不包含测试 SecretKey 原文。点击“模型响应拦截”被离开保护拦截，选择继续编辑后仍停留当前页；撤销后测试值、开关和脏状态全部清除。默认 `2048px` CSS 视口中设置栈宽 `1784px`、右侧 `20px`、横向溢出为 `0`；`1600px` 视口中栈宽 `1336px`、概览四列各约 `333.6px`、三张同步条件卡各约 `423.5px`、表单两列各约 `638.2px`；`1278px` 视口中操作栏纵向排列、概览两列各约 `506.4px`、条件卡各约 `316.3px`、表单两列各约 `477.4px`，右侧约 `19.6px`，三档均无横向溢出。暗色一级卡片和条件卡为 `rgb(26, 29, 32)`、边界为 16% 浅色混合，标题和辅助信息保持可读；验收后恢复亮色、默认视口、无草稿和无浮层，错误的零值日期不再出现，console warning/error 为 0。组件通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`；方舟控制面、自动同步、密钥与响应解析相关 Go 服务测试通过。全量 TypeScript 仍有 30 项项目既有 Tiptap 3.28/3.30 混装诊断；Vite 成功转换 11,506 个模块后仍被同一 `createWidgetDecoration` 缺失导出阻断，与本批修改无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存同步开关、项目或 IAM 字段；刷新或离开存在草稿的页面会先询问，这是有意增加的配置安全步骤。页面纵向高度比原单卡表单增加，但同步条件、项目边界和凭据影响更明确。更换 AccessKey 且不填写新 SecretKey 时，停用状态仍允许保存并会按服务端语义清除原 SecretKey；启用状态会在前端和服务端同时拒绝不完整凭据。Region、ProjectName 或 AccessKey 改变不会在保存时访问方舟，但下一次真实同步会创建新的默认素材组；已有绑定不删除。本批不扩展移动端设计；现有 GET/PATCH 路由、请求字段、服务端加密、用户资源归属校验、任务进度、素材创建与审核轮询均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-051/` 按原相对路径恢复 `web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `dcfec023ae70b3d85d00d87e6b20eae27bd7a55081ea0e6b29bb4df285dec6d0`、`4d23117c3349f4c53bb81d4742882631660cae641914d05ab0d36e7f6d8542ed`、`2bb92df68e36988b8bf7f347bbdcaba7461d854d7c822022d5d00e83cbcf84e1` 和 `93271ffd67351eb5bb67a053664e80481024fdfeb30613efa456d078ff8e7c17`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 052：模型响应拦截重构为有序规则工作台

- 日期时间：2026-08-28 05:21 CST
- 目的：完成系统配置区“模型响应拦截”的 PC 端重构，把用户可见错误投影的作用边界、匹配语义、规则优先级和无副作用预览组织成可理解、可暂存、可核对的规则工作台；保持现有接口、字段、权限、审计和服务端拦截逻辑兼容，不修改原始上游响应、内部错误或请求明细。
- 修改前状况：页面只有一张横向大卡，启用开关放在底部，规则为空时只显示一个添加入口；界面没有说明匹配会忽略英文大小写、采用包含判断、按顺序命中第一条后停止并整条替换，也没有明确原始响应和请求明细仍保留。规则不能调整顺序，看不到 100 条上限和 200/500 字限制，完全重复关键词没有提醒；没有本地预览，管理员只能保存后等待真实错误验证。任意修改没有待保存反馈、撤销、刷新覆盖确认、浏览器刷新或后台导航保护，保存前没有影响核对；读取失败只有短暂消息，读取和保存响应缺少运行时结构及规则顺序一致性校验。
- 涉及文件：`web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、全局拦截策略、规则与优先级、本地命中预览”五层结构；概览展示开关、规则数量、匹配方式和作用范围。全局策略明确只投影任务失败和代理请求最终返回给用户的可见错误，不改写上游响应体、内部错误、失败记录或请求明细；开关和规则使用统一草稿。规则区改为有序工作台，每条规则展示显式优先级、匹配输入、整条替换输入、200/500 字计数和上移、下移、删除操作；添加入口遵守 100 条上限，完全重复的忽略大小写关键词会高亮并提示后续同文案无法命中。新增本地预览区，完全在浏览器内复现服务端的首尾裁剪、忽略大小写包含和首条命中逻辑；停用时即使命中也显示原文，启用和调整顺序后即时展示不同整条替换结果，预览内容不进入保存、审计或请求明细。全部调整提供待保存状态、撤销、刷新覆盖确认、浏览器刷新和后台导航保护；最终核对开关、规则数量、规则变化和匹配语义，明确启用但零规则不会改变文案。读取加入请求序号、页面级错误与重试，已有数据刷新失败时保留上次成功状态；保存前按服务端上限和空值规则校验，保存响应校验开关、规则内容及顺序，失败不自动重试。新增样式全部限定在 `.admin-intercept-*` 范围，覆盖宽屏、较窄 PC、亮暗主题、焦点和减少动画状态。
- 验证结果：在真实已登录后台完成只读与草稿级实页验收，全程未点击最终“确认保存”，没有写入配置、调用模型或制造测试错误。添加两条分别为 `HTTP 429` 和 `http 429` 的虚构规则后，页面正确显示忽略大小写重复提示；本地预览输入 `Upstream HTTP 429 Too Many Requests` 时，全局停用状态显示“可命中第 1 条但全局停用”并保持原文，启用后整条替换为第一条文案，将第二条上移后立即改为第二条替换文案，验证顺序与首条命中一致。最终核对层展示“停用 → 启用”、`0 → 2` 条、规则变化和完整匹配语义，同时明确原始内容不改写。点击“第三方参数配置”被离开保护拦截，选择继续编辑后仍停留当前页；新增空规则会被完整性检查拦截，撤销后规则、开关和脏状态全部恢复。默认 `2048px` CSS 视口中设置栈宽 `1784px`、右侧 `20px`、横向溢出为 `0`；`1600px` 视口中栈宽 `1336px`、概览四列各约 `333.6px`、规则行列宽约 `68/473.8/579/112px`、预览两列各约 `639.2px`；`1278px` 视口中操作栏纵向排列、概览两列各约 `506.4px`、规则行列宽约 `60/338.9/414.3/104px`、预览两列各约 `478.4px`，右侧约 `19.6px`，三档均无横向溢出。暗色一级卡片为 `rgb(26, 29, 32)`、预览面为 `rgb(34, 38, 42)`、边界为 16% 浅色混合；亮色一级卡片为白色、预览面为 `rgb(247, 248, 250)`，两种主题标题和辅助信息均保持可读。验收后恢复亮色、默认视口、无草稿、无预览内容和无浮层，console warning/error 为 0。组件通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`；拦截匹配、空值校验和裁剪相关 Go 服务测试通过。全量 TypeScript 仍有 30 项项目既有 Tiptap 3.28/3.30 混装诊断；Vite 成功转换 11,506 个模块后仍被同一 `createWidgetDecoration` 缺失导出阻断，与本批修改无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存开关、规则内容或顺序；刷新或离开存在草稿的页面会先询问，这是有意增加的配置安全步骤。规则区比原界面占用更多纵向空间，但优先级、边界和限制更明确。本地预览只验证确定性的文本匹配，不代表真实模型、网络或上游异常已复现；宽泛或重复规则仍按服务端合同允许保存，界面只提示不额外阻断。启用但零规则继续是合法配置且不会改变文案。现有 GET/PATCH 路由、请求字段、服务端裁剪、100/200/500 上限、首条命中、任务终态和代理错误投影、审计及原始失败记录均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-052/` 按原相对路径恢复 `web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `5d56ba01904c4e6c6eb0500b26397e260723b933df9b64beef7202a992fc47c7`、`25688dc24a7de3b00abd28971364ab52302aef6538233c04f7dd80a2cf51f6d2`、`4143caabd74d830f5f5dbc65b1431ef485fd2ac206fe7e0ecaf9d51bbc1e9a53` 和 `1376a9d08da0dcdc7d17b5cf72e0e8f5131319625bb16437d71379ec6aaf9519`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 053：第三方参数配置重构为平台接入工作台

- 日期时间：2026-08-28 05:34 CST
- 目的：完成系统配置区“第三方参数配置”的 PC 端重构，把当前 LibTV 接入的平台状态、用户导入入口、服务端 Token 和只读连接验证组织成可理解、可暂存、可核对的配置流程；保持现有 GET/PATCH/POST 路由、请求字段、权限、服务端加密和画布导入接口兼容，不修改或保存真实第三方参数。
- 修改前状况：页面只有一张横向大卡，LibTV Token、启用开关和连接测试连续铺在同一区域，缺少平台与配置概览，也没有清楚区分“保存配置”和“使用已保存 Token 发起外部读取验证”。Token 清空是独立即时写操作，无法与停用入口一起暂存、撤销和最终核对；新 Token 尚未保存时，界面容易让管理员误以为测试会使用输入框中的新值。页面没有待保存状态、刷新覆盖确认、浏览器刷新或后台导航保护，保存前不展示入口、凭据和已有导入数据的影响；读取失败只有短暂消息，读取和保存响应缺少运行时结构与一致性校验。
- 涉及文件：`web/src/pages/admin/settings/libtv-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面改为“同步与操作栏、四项概览、LibTV 平台头、用户导入入口、服务端访问凭据、已保存凭据验证”六层结构；概览展示已接入平台、服务端凭据、用户入口和配置来源。用户入口说明停用只关闭新的导入，不删除或转换已有节点与连线，并以三步链路展示服务端凭据、按 UUID 读取和导入影策的关系。Token 新增、替换、保留和清除改为统一草稿语义；清除只先标记并同步暂存停用入口，最终确认前不调用写接口，可随时撤销。没有草稿或服务端 Token 时前端阻止启用；Token 留空保存继续保留服务端现值，核对层只展示“新增/替换/保留/清除”的处理方式，不显示 Token 明文。连接验证改名为“验证已保存凭据”，没有已保存 Token 时关闭按钮，并明确它会发起一次真实外部只读请求、只使用服务端当前 Token、不使用输入框中的未保存 Token，也不会向 LibTV 或当前影策画布写入内容。保存和连接验证彻底分离，保存本身不会读取外部画布；测试结果只保留在当前页面会话。全部调整提供待保存状态、撤销、刷新覆盖确认、浏览器刷新和后台导航保护；读取加入请求序号、页面级错误与重试，已有数据刷新失败时保留上次成功状态；保存响应校验启用状态和凭据存在状态，失败不自动重试。无有效更新时间显示系统默认。新增样式全部限定在 `.admin-third-party-*` 范围，覆盖宽屏、较窄 PC、亮暗主题和减少动画基线。
- 验证结果：在真实已登录后台完成只读与草稿级实页验收，全程未点击最终“确认保存”，没有写入或清除 Token、启用入口、导入画布，也没有发起真实 LibTV 连接验证。空配置下直接点击启用会被阻止；填入虚构 Token 后页面正确显示“待新增”和待保存状态，随后可启用入口，最终核对层展示“停用 → 启用”“新增服务端 Token”、凭据不回传和已有导入数据不删除，且不包含虚构 Token 原文。没有已保存 Token 时验证按钮保持关闭，说明文案准确提示先保存再验证。点击“模型响应拦截”被离开保护拦截，选择继续编辑后仍停留当前页；撤销后 Token、开关和脏状态全部恢复。默认 `2048px` CSS 视口中设置栈宽 `1784px`、右侧 `20px`、横向溢出为 `0`；`1600px` 视口中设置栈宽 `1336px`、两张业务域各约 `640.2px`；`1278px` 视口中设置栈宽约 `1014.4px`、概览两列各约 `506.4px`、业务域单列约 `972.8px`，操作栏仍为约 `74.1px` 单行且无内部溢出，三档均无横向溢出。暗色业务表面为 `rgb(34, 38, 42)`、边界为 16% 浅色混合，亮暗主题标题、辅助文案和状态均可读。验收后恢复亮色、默认视口、无草稿和无浮层，新建干净页面的 console warning/error 为 0。组件通过 Prettier，CSS 通过 PostCSS 解析，本批页面无定向 TypeScript 诊断，LibTV 服务测试通过。全量 TypeScript 仍有 30 项项目既有 Tiptap 3.28/3.30 混装诊断；Comfy Bridge 构建步骤通过，Vite 成功转换 11,506 个模块后被当前依赖安装中缺失的 `lightningcss/index.js` 阻断，与本批修改无关。
- 潜在影响：管理员现在需要先暂存并经过最终核对才能保存 LibTV Token、清除凭据或改变导入入口；刷新或离开存在草稿的页面会先询问，这是有意增加的配置安全步骤。清除 Token 不再点击即生效，而是标记为待清除并在最终保存时同时停用入口。连接验证只验证服务端已保存凭据，因此新增或替换 Token 后需要先保存，再主动执行验证；验证仍会产生一次对 LibTV 的真实只读网络请求。页面纵向高度比原单卡表单增加，但平台、凭据、入口与验证的边界更明确。本批不扩展移动端设计；现有接口、服务端密钥加密、管理员权限、用户项目归属、LibTV 读取和节点/连线转换逻辑均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-053/` 按原相对路径恢复 `web/src/pages/admin/settings/libtv-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `67f5857c08f099ceab7b496e6f0e7cebf1d48c4aeca001a98ba0741491b23ed9`、`f8b28784bfbc1f40c8082ae2bb8d719cf8373644cbe88637ef4c3e146bb1f4e7`、`27d3465ccb5ebe989ad665c7d15694c9cf61b98271befa2cb55b996e2243d481` 和 `712b7589d2b98fba32319ccd13ace3b3bc6e06f25f7d495c37962c65e6f039b1`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 054：后台全页面一致性巡检与较窄 PC 收口

- 日期时间：2026-08-28 05:46 CST
- 目的：在前述页面重构完成后，对后台全部 18 个可见入口进行一次 PC 端收口巡检，统一较窄 PC 下系统设置顶部操作栏的排版，并补齐存储服务服务器地址的输入语义；保持现有业务功能、接口、权限、表格结构和移动端范围不变。
- 修改前状况：数据概览、平台资源、运营和系统配置页面的主容器、表格分页、卡片层级与明暗主题已经基本统一，但 CSS 视口缩小到 `1278px` 时，登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和资源与策略会把顶部状态栏强制改成纵向两层，而同一区域的功能开放、绘图工具和第三方参数配置仍保持单行；这些页面实际有足够水平空间，强制换行会额外增加约 54px 高度并形成跨入口不一致。存储服务本地模式的“服务器访问地址”因为 `Form.Item` 内包裹组合控件，输入框没有继承可访问名称，只能以会在输入后消失的占位文字被识别。
- 涉及文件：`web/src/styles/globals.css`、`web/src/pages/admin/settings/storage-settings-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在现有 `max-width: 1279px` 响应式规则之后增加 `1100–1279px` PC 专用覆盖，让登录与注册、邮件、存储、方舟素材、响应拦截和资源策略六类操作栏恢复统一的单行左右布局，操作组使用自身宽度并靠右；低于 `1100px` 时仍沿用原有纵向回退，避免更窄界面挤压。第三方参数配置操作栏补入 `prefers-reduced-motion` 禁用过渡清单，使最后完成的设置页与其余入口遵循相同动画偏好。存储服务的服务器访问地址输入增加稳定的 `aria-label`，不再只依赖占位文字。设计规范新增设置页操作栏断点与单行容纳规则。
- 验证结果：真实已登录后台逐页覆盖数据概览、用户管理、系统渠道、插件管理、提示词模板、系统公告、积分运营、兑换码、请求明细，以及功能开放、绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置共 18 个入口；在亮色 `1600px` 与暗色 `1278px` CSS 视口下，全部页面标题、表格/设置栈、状态标签和操作按钮正常显示，18 页页面级横向溢出均为 `0`，表格宽内容继续只在自身滚动容器内处理。修复后六个原换行操作栏与第三方参数配置均为单行 `row`、高度约 `74.1px`，无内部或页面级溢出；在 `1098px` 视口下邮件操作栏正确回退为纵向、约 `128.1px`，仍无溢出。存储服务辅助树现在将输入识别为 `textbox "服务器访问地址"`。对视觉隐藏的移动导航、关闭抽屉和三个隐藏表单镜像控件进一步核对，其祖先均为 `display: none`，不进入真实键盘顺序，因此未做无关改动。验收全程未打开写入型抽屉、保存配置、切换业务开关或调用外部服务。组件与样式通过 Prettier，CSS 通过 PostCSS 解析，存储页面无定向 TypeScript 诊断，目标文件通过 `git diff --check`。全量 TypeScript 仍有 30 项项目既有 Tiptap 3.28/3.30 混装诊断；Comfy Bridge 构建步骤通过，Vite 成功转换 11,506 个模块后仍被当前依赖安装中缺失的 `lightningcss/index.js` 阻断，与本批修改无关。
- 潜在影响：`1100–1279px` CSS 视口中的六个设置页顶部内容减少一行高度，正文更早进入视区；操作栏文字区域允许收缩，但已验证当前最长文案和按钮组不会溢出。低于 `1100px` 的布局行为不变。服务器访问地址仅新增语义名称，不改变字段值、校验、保存载荷或“使用当前地址”行为。本批没有修改列表列宽、分页、筛选、接口、服务端逻辑或移动导航结构。
- 逐项回滚：从 `.local/ui-change-backups/batch-054/` 按原相对路径恢复 `web/src/styles/globals.css`、`web/src/pages/admin/settings/storage-settings-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `4ede51f5635140818fd264b4b5f10cae2f4bc7dc4e43870216daabcc2264d004`、`2a0a95420dad4fe5450a1af9b1ca4b4b5bea69b2719f7745b58b766f341708cf`、`a3e0ddd161cf96d678541d2ddff52e3c6b51458affe166c0809238b1bf01676a` 和 `6097d023e54826aae064512b54efc598c0d20a4e92351307da87d52c37cc32d1`。四个文件均为本批修改前原样副本，可整批或逐项覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 055：前端依赖树修复与后台 PC 视觉回归基线

- 日期时间：2026-08-28 06:06 CST
- 目的：解除前端全量类型检查和生产构建阻断，建立可重复的后台 PC 双主题、双尺寸视觉回归基线，并清理巡检中发现的 Ant Design 6 废弃属性提示；不升级业务能力、不修改接口、权限、数据结构或移动端布局。
- 修改前状况：项目正式安装与构建链路使用 Bun，但同一 `web/node_modules` 曾被 Bun 和 pnpm 先后写入，Vite 8.2.1 的嵌套 `lightningcss` 目录覆盖了正确包链接，导致 11,506 个模块转换后在 CSS 压缩阶段找不到 `lightningcss/index.js`。`@tiptap/core` 固定为 3.28.0，其余 Tiptap 包使用范围版本并被 pnpm 解析到 3.30.1/3.30.5，形成两套不兼容类型，产生 30 项 TypeScript 错误。两份锁文件对 Tiptap 与 Vite 的解析不一致，后台虽已逐页人工验收，但没有固定记录 CSS 视口、路由清单和硬性通过指标；真实巡检控制台还出现 Drawer `width`、`maskClosable` 和 Select `dropdownRender` 的 Ant 6 废弃提示。
- 涉及文件：`web/package.json`、`web/bun.lock`、`web/test/plugin-state-switch.test.ts`、`web/src/pages/admin/channels/channels-page.tsx`、`web/src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx`、`web/src/pages/admin/logical-models/logical-models-page.tsx`、`web/src/pages/admin/components/credit-operations-panel.tsx`、`web/src/pages/admin/users/users-drawer.tsx`、`web/src/pages/admin/users/users-panel.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-visual-regression-baseline.md`（新增）、`docs/design/admin-ui-change-log.md`。
- 具体改动：将直接使用的九个 Tiptap 包统一精确锁定为 `3.28.0`，并在正式 Bun 依赖声明和锁文件中对完整 Tiptap 包组加入 `3.28.0` 精确覆盖；Vite 精确锁定为 `8.1.5`。以 Bun 冻结锁文件重新建立安装树，不整体升级前端。项目原有 `pnpm-lock.yaml` 仅作为历史文件原样保留，不纳入本批依赖同步，也不新增 pnpm 专属配置；避免形成两套相互矛盾的安装标准。抽屉的 `width` 等价迁移为 `size`，Drawer/Modal 的 `maskClosable` 等价迁移为 `mask.closable`，用户远程选择的 `dropdownRender` 迁移为 `popupRender`，所有尺寸和保存期间关闭条件保持原值；插件状态测试同步检查重构后实际展示的“已开放 / 已停用”徽标文案，保留开关可访问标签中的完整平台动作说明。新增 PC 视觉回归基线文档，固定 18 个可见后台入口、亮色 `1600 × 1000`、暗色 `1278 × 900`、`1098px` 操作栏断点补充，以及标题、文档横向溢出、主框架右边界、主题层级、侧栏、控制台和写操作边界等通过条件；设计规范同步引用该基线并更新已解决风险。
- 验证结果：修复前复现 30 项 Tiptap TypeScript 错误和 Vite `lightningcss/index.js` 构建失败；修复后 `bun install --frozen-lockfile` 检查 1,746 个安装项且无变化，Bun 安装树中的 34 个 Tiptap 包清单版本全部为 3.28.0、Vite 为 8.1.5。全量 `tsc --noEmit` 为 0 错误；前端 86 个测试文件共 824 项全部通过，包含跨运行时 Dreamina 测试；Comfy Bridge、TypeScript 与 Vite 生产构建完整通过，转换 12,695 个模块并生成产物，只保留既有大分块体积提示。测试进程还输出既有 Ant Tag `bordered` 与 Button `iconPosition` 两条废弃属性提示，不影响通过结果且不来自本批触及文件。真实管理员登录态逐页检查 18 个入口：亮色 `1600 × 1000` 下页面框架宽 1,376px，暗色 `1278 × 900` 下约 1,054.4px，两组标题全部匹配、文档横向溢出均为 0、页面框架均延伸到视口右边界；表格宽内容只在自身容器内滚动。受影响入口用新建干净页面复核后，应用控制台 warning/error 为 0。测试全程未保存配置、调账、生成、停用、删除、恢复任务或调用外部验证，结束后恢复亮色、默认视口并关闭临时页面。
- 潜在影响：Tiptap 与 Vite 不再自动接受同一主版本内的新次版本，后续升级必须整组调整 `package.json` 与 `bun.lock`，这是为避免再次混装而采用的有意约束。现有 pnpm 锁文件不是正式构建依据，不能用 pnpm 覆盖同一 `node_modules`；统一使用项目既有的 Bun 冻结安装链路。Ant 属性迁移不改变抽屉宽度、遮罩关闭条件、焦点或业务写入逻辑。新增基线目前需要真实登录态人工或受控浏览器执行，尚未进入 CI 自动截图差异门禁；生产构建仍提示部分分块超过 500kB，与本批依赖修复无关。
- 逐项回滚：修改前原件和哈希清单位于 `.local/ui-change-backups/batch-055/MANIFEST.md`。按原相对路径恢复 `web/package.json`（`cb95a16b3ac7e545b9e9fde5f2f44019f4f29664d40a32024321076dbf2a8b61`）、`web/bun.lock`（`b2b7925179b801aaea6c3383800a23da6186f5fc9ecc14083bc685d10beb8dda`）、`plugin-state-switch.test.ts`（`9fac492613e826a9f0d8158b46a7506e9a8a8e4fe8dadff1356a50f8f21a4330`）、`channels-page.tsx`（`e32fee1f8801b67a14305bb4b8ea5817180715d4a2299485076557f44c2a5f52`）、`storyboard-prompts-page.tsx`（`267b65957b90eacb98f49367bb326fb1df9aad6a9d294ccf09ab3da8aa3eeb`）、`logical-models-page.tsx`（`6ab44cb18719f87285d1820eee2a7534560fe75faabf92952950277bf02ffbf4`）、`credit-operations-panel.tsx`（`a767283ce6a52ed4c8a34c09db6c52c7e16dacff1aab8519877ae4adfa7987e7`）、`users-drawer.tsx`（`6f354989682eb960b5e3819c7a35b08d0b60ad94accd85b3966da6aacda0848a`）、`users-panel.tsx`（`20d1fa2fca0440e2da6618788ea9cece8fbdae320812468b107038ff08f2d5f7`）、`admin-ui-design-standard.md`（`af7d868e6c36ceb10e1fd123159cdaec18916ec60c264ac4de88f5f38bc740a7`）和 `admin-ui-change-log.md`（`5129527ddb0b44d201e615c878a413ca5d886036ec5a4e5877fc9533bf41fad2`）；`admin-ui-visual-regression-baseline.md` 修改前不存在，回滚时将该单一文件移入本批备份目录保留后再移除项目副本。恢复依赖声明和 Bun 锁文件后，在 `web/` 执行 `bun install --frozen-lockfile` 重建生成目录即可；`pnpm-lock.yaml` 本批未修改，备份目录中的同哈希副本仅用于证明和核对。全程不需要初始化、提交或使用 Git。

## 批次 056：系统配置分类方案试做（已完整回退）

- 日期时间：2026-08-28 06:25–06:32 CST
- 目的：曾尝试将系统配置入口按三类分组，并在配置页增加同组入口；用户查看方向后要求立即暂停并回退，本记录用于证明试做未保留在当前项目界面。
- 修改前状况：系统配置九个入口连续平铺，部分名称抽象；各配置页只显示当前标题和说明，没有额外的分类上下文。
- 涉及文件：试做曾触及 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/pages/admin/settings/libtv-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`，并短暂新增 `web/test/admin-settings-navigation.test.ts`；上述界面、样式、规范和测试改动均已退出项目副本。当前仅保留本条变更记录和 `.local/ui-change-backups/batch-056/` 回退证据。
- 具体改动：试做版本曾加入三组侧栏小标题、重命名七个入口、页头分类路径和同组入口条；用户要求回退后，先把试做版本保存到 `.local/ui-change-backups/batch-056/rolled-back-attempt/`，再以批次开始前原件逐项覆盖恢复。短暂新增的测试先移出项目，用户随后明确要求删除该新增项后，项目路径和回退备份中的测试副本均已删除。
- 验证结果：九个应用源码/样式文件与设计规范恢复后的 SHA-256 均与 `.local/ui-change-backups/batch-056/MANIFEST.md` 中修改前哈希逐项一致；项目及批次备份中均不存在 `admin-settings-navigation.test.ts`。回退后 Comfy Bridge、全量 TypeScript 与 Vite 生产构建完整通过，转换 12,695 个模块并重新生成原界面产物，只保留既有大分块体积提示；`git diff --check` 通过。
- 潜在影响：当前应用源码、样式、页面名称、导航结构、设计规范和生成产物均回到批次 056 开始前状态；只新增回退审计记录与本地备份证据，不改变接口、业务数据或权限。
- 逐项回滚：本批当前状态本身即为已回退状态，不应恢复 `rolled-back-attempt/`。若需要核对，可比较 `.local/ui-change-backups/batch-056/` 根目录的修改前原件与当前项目；若将来明确要求重新采用试做方案，必须建立新的变更批次，不能直接把 `rolled-back-attempt/` 覆盖回项目。

## 批次 057：功能开放内部信息架构重构

- 日期时间：2026-08-28 06:38 CST
- 目的：只重构“功能开放”页面内部的呈现方式，让入口控制、插件依赖、模型来源与部署只读能力使用符合自身含义的结构；保持侧栏、入口名称、业务功能、接口与暂存核对流程不变。
- 修改前状况：页面虽然按用户工作台、插件策略、模型与运行能力分组，但七个可写项和一个只读能力都使用相近的大卡片，说明、当前影响、开关与只读状态拥有近似视觉权重；管理员需要逐卡阅读，难以快速区分普通入口开关、插件两级依赖、模型来源选择和环境能力。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：完整保留顶部同步、刷新、撤销、离开保护、最终核对和集中保存机制，把四张高概览卡压缩为一条扫描摘要，集中展示有效用户功能数、模型来源、插件范围与配置记录。用户工作台由 2×2 大卡片改为连续策略列表，增加“功能与范围 / 当前规则与影响 / 状态”列语义，每行优先突出当前生效结果，完整控制边界降为次级说明。插件策略明确标为第 1 步“插件中心”和第 2 步“系统插件可见性”，用连接线与缩进表现依赖；上游关闭时，下游保留原偏好但禁用操作并显示真实未生效原因。模型来源不再伪装成布尔 Switch，改为“系统渠道 / 前台模型目录”互斥选择，仍映射原 `frontendModelsEnabled` 字段；保存核对层同步使用来源名称，模型来源切换不再误判为危险的关闭操作。桌面本地渠道改为只读状态行，明确显示由部署环境决定且不进入保存请求。新增样式限定在 `.admin-feature-*` 范围，连续行只用分隔线、状态底色和依赖层级，覆盖宽屏、`1279px` 以下紧凑三列和 `1099px` 以下两段式 PC 回退，并遵循减少动画偏好。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，只保留项目既有的部分分块超过 500kB 提示。真实已登录后台在当前 Chrome `2048×941` CSS 视口完成亮色和暗色验收，主内容宽 1,784px，文档横向溢出为 0；页面显示 8 条策略行且旧卡片节点为 0，摘要、表头、行分隔、右侧控制、插件依赖线、来源选择和只读状态均正常。暂存“系统渠道 → 前台模型目录”后，页面正确显示 1 项待保存，互斥选择的 `aria-checked` 状态同步，核对层准确使用来源名称和对应影响；取消核对并撤销后恢复系统渠道。暂存关闭插件中心后，系统插件可见性自动禁用，并显示“依赖未生效、保留偏好但当前不生效”；随后已撤销。最终重载生产产物，来源恢复为系统渠道、无待保存状态、横向溢出为 0。验收全程未点击“保存并生效”，没有修改服务端功能配置或调用写接口。目标文件经 Prettier 格式化，CSS 已随 Vite/PostCSS 完整解析，`git diff --check` 无空白错误。当前环境没有可调用的 Bun 可执行文件，因此未重复运行依赖 Bun 的 824 项全量测试；本批不修改接口与业务计算，类型检查、生产构建和真实交互回归均已完成。
- 潜在影响：功能开放页纵向内容由卡片网格改为连续列表，在宽屏下更易横向比较，页面总高度与滚动位置会改变；`1099px` 以下 PC 会把说明移到控制项下一行以保证可读性。模型来源控件的视觉与核对文案发生变化，但仍提交同一布尔字段；插件下游依赖、有效值计算和保留偏好行为不变。侧栏、系统配置入口名称、其他设置页、权限、API、七个可写字段、桌面本地渠道只读字段、暂存与集中保存流程均未改变；本批不扩展移动端设计。
- 逐项回滚：从 `.local/ui-change-backups/batch-057/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `c0c870367176d8d0fee4da9bd243d3a47ddc7c27f4bcfb4c6ca9f6053de9b74b`、`eb78db38167d7cec5ca8568b4377958e4aeb94bbfbbfa48be79e45e76f2a7672`、`6f8928e607a55df948ed9e6391f3562af8305b6397cc7bee0012b9385d4ebdd1` 和 `e4d415d3927adea663730649ee84e48376cfe6b16f4513b9b6c09062569acdd4`。恢复前若文件包含后续批次，应先复制当前版本；完整清单与说明见 `.local/ui-change-backups/batch-057/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 058：功能开放三域控制台试作

- 日期时间：2026-08-28 06:54 CST
- 目的：按用户确认的“三域控制台”方案制作可直接查看的 PC 版本，减少每项功能占用高度，同时保持全部状态可见和完整影响可查。
- 修改前状况：批次 057 已把同质化大卡片改为连续策略列表，理解性明显改善，但每项仍常驻显示当前影响与完整范围说明，单行接近 100px；三个业务分组纵向堆叠，八项功能无法在首屏集中浏览。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除批次 057 的独立摘要条和三个纵向策略列表，将用户工作台、插件策略、模型与环境改为同一行的三个组级面板；只在业务域外层使用卡片边界。用户工作台四项采用 2×2 紧凑矩阵，插件和模型域各保留两行，使三个面板在宽屏下统一为 191px 高；每项控制行约 58px，仅显示图标、名称、必要步骤、当前状态和控件。选中行使用明确内侧标记，点击行只更新下方唯一的共用详情区；详情固定展示当前效果、控制范围和切换到另一状态后的影响，不依赖悬浮提示。插件范围继续以第 1/2 步、缩进与连接线表达依赖，上游关闭时下游禁用且选择后详情显示真实未生效原因。模型来源继续使用系统渠道/前台目录互斥选择，详情与最终核对使用完整“前台模型目录”名称；桌面本地渠道保留只读状态和独立详情。配置来源与更新时间并入顶部暂存操作栏，不再单独占用概览高度。业务域在 `1600px` 以下回流为两列、模型域占满下一行，在 `1099px` 以下回流为单列；详情同步从三列回流为单列。新增选中态使用 `aria-pressed` 与稳定 `aria-controls`，互斥来源继续暴露 radio 语义，键盘聚焦开关时会同步选中对应详情。保存、撤销、刷新、离开保护和写接口逻辑原样保留。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，只保留项目既有的部分分块超过 500kB 提示。真实已登录后台在 Chrome `2048×941` CSS 视口完成亮色和暗色验收：主区宽 1,784px，三个业务域均为 191px 高，页面显示 8 条控制行、1 个选中项和 1 个共用详情区；业务域顶部约 214.75px，详情底部约 575.22px，设置主体在首屏完整可见，文档横向溢出为 0。点击任务中心后，选中态与详情准确切换，显示当前效果、控制范围和关闭影响。暂存模型来源为前台目录后，radio 状态、待保存标记、顶部 1 项待保存和共用详情同步更新；最终核对层准确显示“系统渠道 → 前台模型目录”及实际影响，随后取消并撤销。暂存关闭插件中心后，插件域有效数变为 0/2，系统插件可见性自动禁用并显示未生效；选择下游后详情准确说明“保留偏好但当前不生效”，随后撤销。最终重新构建并加载生产产物，恢复深色主题、系统渠道、无待保存状态，三个业务域等高、8 行控制、单一选中项和零横向溢出。验收全程未点击“保存并生效”，没有修改服务端配置或调用写接口。目标文件经 Prettier 格式化，CSS 随 Vite/PostCSS 完整解析，`git diff --check` 无空白错误。当前环境没有可调用的 Bun 可执行文件，因此未重复运行依赖 Bun 的全量测试；类型检查、生产构建和真实交互回归均已完成。
- 潜在影响：功能说明不再常驻每一行，管理员需要点击功能行后在下方查看完整影响；当前效果和开关状态仍始终可见。宽屏首屏密度显著提高，用户工作台从四个纵向行改为 2×2 阅读顺序；`1600px` 以下业务域会按两列/单列重排，但功能顺序和状态不变。模型来源按钮为适应紧凑行在面板内显示“前台目录”，详情和保存核对仍显示完整名称。开关字段、模型来源布尔映射、插件依赖计算、七项保存载荷、桌面本地渠道只读字段、权限、API、暂存与集中保存流程、侧栏和其他设置页均未改变；本批不扩展移动端设计。
- 逐项回滚：从 `.local/ui-change-backups/batch-058/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `4604001d24c0d64cca3a5a8f3fedfde49f52c5e751c32cff2bf31b083d6c0017`、`a98e9ccbc1c94a91d43d3f9535605748e2fca52a9846d8c27e54a66f4e7901cb`、`65a3515916a3015e8049f8bd059473a81385d6d566f61e8019f0238abb7feea5` 和 `1af28436cf1a2ab6cf1da6c1951442fdecfb8f5119b4215e08e1f91d287dbb5e`。恢复前若文件包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-058/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 059：功能开关状态辨识增强

- 日期时间：2026-08-28 07:05 CST
- 目的：去除三域控制台功能行中与 Switch 重复的“开放/关闭”文字，并让暗色主题下的开启状态一眼可辨。
- 修改前状况：每个布尔功能行在 Switch 左侧重复显示“开放”，增加了无必要文字；暗色主题中已开启 Switch 使用接近白色的轨道，与关闭状态主要依靠明度和滑块位置区分，不够直观。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：从六个可写布尔功能行中移除 Switch 左侧重复的“开放/关闭”状态文字，控制列最小宽度由 94px 收窄为 64px；只在插件中心关闭导致下游控制失效时继续显示“未生效”，使异常原因保留而正常状态不重复。为功能开放页作用域重设通用开关状态变量：开启轨道使用后台成功绿色、悬浮时保持绿色强化并固定白色滑块；关闭轨道使用中性灰且增加内侧边界。页面专属变量沿用已有全局高优先级开关配对层，避免被通用 Ant Design 主题样式覆盖，其他页面的开关配色不变。同步把“正常状态不重复文字、明暗主题不能只靠滑块位置区分”的规则加入设计规范。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，仅保留项目既有的大分块提示。真实已登录后台分别完成亮色和暗色状态验证：六个正常功能行的控制列均不再包含“开放/关闭”；亮色开启轨道计算为 `oklch(0.52 0.14 155)`，暗色开启轨道为更明亮的 `oklch(0.72 0.14 155)`，暗色关闭轨道为中性灰并带 16% 浅色内边界，开关状态由颜色、滑块位置和辅助语义共同表达。暂存关闭短剧创作后确认关闭配色与“待保存”反馈正常，随后撤销；暂存关闭插件中心后确认下游系统插件可见性禁用且仍显示“未生效”，随后撤销。最终页面保持暗色主题、六项开关全部恢复开启、无待保存改动；验收未点击“保存并生效”，没有修改服务端配置或调用写接口。目标文件经 Prettier 格式化，CSS 随生产构建完整解析。
- 潜在影响：功能行横向信息更精简，正常状态完全由开关呈现；插件依赖异常仍有文字说明。开启色改为语义绿色后与其他后台页面的黑白开关视觉不同，但调整限定在功能开放页面，其他入口、字段状态、保存流程、API、权限与移动端规则均未改动。
- 逐项回滚：从 `.local/ui-change-backups/batch-059/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `62c51c901bb4857b61018cfcabd34d8b8af165f9aebc99d943808bf9beb79aeb`、`3e171126200982c487d2a3b50a0f871b812f595f8c5d0f07c120c6f0e69cb373`、`254eaaaa77b9aad84a026f2bf5b66fd51f1e20649fc43ff3a2ca37d2d8f3bd22` 和 `aa17e2d8f5b6a6e481a50a15ac2305d4863e753ed3c3289b7c8e0d2e5e7bb6bb`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-059/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 060：绘图工具两步配置台试作（已回滚）

- 日期时间：2026-08-28 07:15 CST
- 目的：降低绘图工具页面的卡片体量和重复信息，让管理员首先理解“默认编辑器只影响新建绘图，tldraw 授权还影响已有 tldraw 绘图”的配置关系。
- 修改前状况：页面先用三个 106px 高概览块展示默认编辑器、tldraw 可用性和配置来源，下面又用两张约 278px 高的大卡重复展示同一状态；编辑器选项常驻两段说明，默认选择和授权依赖的先后关系不明确，首屏信息虽整齐但理解成本较高。
- 涉及文件：`web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除三个大统计块与两张通用设置大卡的重复结构，顶部改为一条紧凑影响条，分别直接回答“之后新建的绘图使用什么”“已有 tldraw 绘图当前能否打开”“配置来自哪里”。主体改为两步配置台：步骤 1 选择新建绘图默认编辑器，步骤 2 仅在使用 tldraw 时配置浏览器端授权；宽屏并列等高，常规 PC 回流为单列。Excalidraw 与 tldraw 从约 156px 的大选项卡压缩成约 67px 的互斥选择行，常驻显示类型、名称、必要说明和可选状态，当前选择的完整影响归入组底说明。授权区把密钥输入与当前授权影响收敛到同一面板，并明确未配置授权只影响 tldraw、继续使用 Excalidraw 不受影响。互斥选择改用 `radiogroup/radio` 语义；未授权 tldraw 不再错误声明为禁用项，点击或键盘触发时仍会把焦点引导到 License Key 输入。读取、暂存、撤销、刷新、最终核对、写接口及保存响应校验逻辑保持原样。同步更新绘图工具的布局与交互规范。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，只保留项目既有的大分块提示。真实已登录后台在 `2048×941` CSS 视口完成亮色和暗色验收：三项影响条高度约 95px，两张步骤面板各约 `886×308px`、顶部对齐并在首屏约 635px 处结束，右侧仅保留正常页边距，页面级横向溢出为 0。亮色面板为白色和 15% 深色边界，暗色面板使用统一深色表面与清晰边界。未授权时触发 tldraw 选择，焦点准确进入 License Key 输入且不产生待保存状态；输入临时测试密钥后可选择 tldraw，顶部同时预览“新建使用 tldraw、已有 tldraw 可以打开”，并出现 2 项待保存与核对入口。随后通过“撤销改动”恢复 Excalidraw、清空临时输入和零待保存状态。最终恢复暗色主题，验收未点击确认保存，没有修改服务端配置或调用写接口。目标文件经 Prettier 格式化，CSS 随生产构建完整解析。
- 潜在影响：绘图工具的阅读顺序由“概览后重复两张卡片”改为“影响范围后按步骤操作”，首屏结构与滚动位置会变化；编辑器完整新建影响改到步骤 1 底部统一展示。未授权 tldraw 在辅助语义上从禁用改为可触发引导，实际业务仍不能在缺少授权时选中。配置字段、默认值、授权判定、读取与保存 API、权限、暂存核对、离开保护、侧栏、其他系统配置入口及移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-060/` 按原相对路径恢复 `web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `9b5a02410d303d33cad56bc0be58abcefefa6d41b9c4a923867490257523bb74`、`0f14d1f1802b270c80be230248cae6645389a0b8795f929202afc1259fb63359`、`b8109b4e74b52d847f2d0a6fbde7e9cee39da6ef03ab68299d51054dacb7fa60` 和 `fac12d1f0245aabb9a546e129aa8e823e43f8e6c93ef6bbab93547844d57c4aa`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-060/MANIFEST.md`，不需要初始化、提交或使用 Git。
- 回滚结果：2026-08-28 07:31 CST 根据用户反馈停止该方案。用户指出两步试作的顶部影响条、并列步骤卡和其他系统配置入口缺少统一骨架，继续为每个入口设计不同结构只会增加整体混乱。已使用批次 060 修改前快照逐项恢复组件、样式和设计规范，恢复后 SHA-256 与修改前值完全一致；变更记录保留本次试作、验证和回滚过程，不向其他入口扩散该布局。下一轮应先确定覆盖全部系统配置入口的统一页面骨架，再只允许内容控件按功能需要变化。

## 批次 061：系统配置统一骨架的绘图工具样板

- 日期时间：2026-08-28 07:32 CST
- 目的：不再为绘图工具设计独立页面结构，改为验证可覆盖全部系统配置入口的统一骨架：状态操作栏、四格概览、配置目录、纵向设置区。
- 修改前状况：批次 060 已完整回滚。恢复后的绘图工具有状态操作栏、三格概览和两张设置卡，但缺少与资源与策略一致的四格概览和配置目录；1600px 以上两张设置卡并排，导致系统配置入口之间的阅读方向和信息层级不同。
- 涉及文件：`web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：保留原有页面标题和状态操作栏，将绘图工具概览由三格统一为四格，依次显示新建默认编辑器、tldraw 可用性、已有 tldraw 绘图访问状态和配置来源。新增通用命名的“配置目录”骨架，目录由固定说明栏和等宽项目组成，支持键盘聚焦、悬浮反馈、平滑定位及较窄 PC 的上下回流；本页目录只包含默认编辑器和 tldraw 授权。两张设置卡取消 1600px 以上并排布局，按目录顺序纵向排列；卡片统一改用左侧一栏说明、状态与图标，右侧三栏放置原有编辑器选择和授权输入。新增通用设置锚点规则，确保 1600px 以上状态栏、四格概览、目录、锚点包装和内部设置卡都使用完整主内容宽度，不再出现内层 1440px 截断。业务控件、文案、读取、暂存、撤销、刷新、最终核对、保存接口和响应校验均未改动。同步把统一页面骨架写入设置页总规范，并更新绘图工具专属规范。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，只保留项目既有的大分块提示。真实已登录后台在 `2048×941` CSS 视口完成亮色和暗色验收：状态栏约 `1784×74px`、四格概览约 `1784×115px`、配置目录约 `1784×64px`，两张纵向设置卡分别约 `1784×186px` 和 `1784×162px`；所有层级右边界统一为 2028px，页面级横向溢出为 0，第二张设置卡底部约 789px，全部主体仍在首屏内。亮色使用白色表面与 15% 深色边界，暗色使用 `rgb(26, 29, 32)` 表面与 16% 浅色边界。目录准确暴露“默认编辑器 / 新建绘图”和“tldraw 授权 / 已有与新建绘图”，触发目录定位不会产生待保存状态。最终保持暗色主题、Excalidraw 默认、授权输入为空且无待保存修改；验收未点击确认保存，没有修改服务端配置或调用写接口。目标文件经 Prettier 格式化，CSS 随生产构建完整解析。
- 潜在影响：绘图工具在宽屏下由两卡并排改为纵向阅读，页面主体底部由原先约 694px 下移至约 789px，但仍完整处于当前 PC 首屏；默认编辑器与授权的横向对照变为目录和纵向顺序。新增通用配置目录与设置锚点样式尚只由绘图工具使用，需在用户确认样板后再迁移其他系统配置入口。业务字段、默认值、授权判定、读取与保存 API、权限、暂存核对、离开保护、侧栏和移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-061/` 按原相对路径恢复 `web/src/pages/admin/settings/drawing-engine-settings-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `9b5a02410d303d33cad56bc0be58abcefefa6d41b9c4a923867490257523bb74`、`0f14d1f1802b270c80be230248cae6645389a0b8795f929202afc1259fb63359`、`b8109b4e74b52d847f2d0a6fbde7e9cee39da6ef03ab68299d51054dacb7fa60` 和 `811f73f7c7fec0b2de5682a5f368e4977c2a89a0ac0325662e03f9ef710bf941`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-061/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 062：功能开放改为单次保存

- 日期时间：2026-08-28 07:42 CST
- 目的：按用户要求取消功能开放的二次保存确认；管理员调整后点击一次保存按钮即提交。
- 修改前状况：功能开关先在页面暂存，管理员点击“核对并保存”后还会打开确认层，必须再次点击“保存并生效”才调用写接口，形成两次保存确认。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：删除“保存功能开放调整？”确认层及其前后状态列表、关闭风险按钮样式和专用格式化逻辑；功能调整仍先在页面暂存，出现改动后顶部只显示一个“保存修改”主按钮，点击后直接调用原有保存函数，不再经过“核对并保存 → 保存并生效”两次操作。待保存说明同步改为“点击保存修改后统一生效”。保存失败继续保留草稿、显示错误且不自动重试，但直接保存模式下不再把已处理错误重新抛给确认层。刷新覆盖未保存草稿的确认、离开页面保护、撤销、配置重读、保存响应七字段一致性校验和全局状态更新全部保留。同步修改功能开放规范，明确单次保存是本入口的既定交互。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，只保留项目既有的大分块提示。真实已登录后台暗色页面暂存关闭短剧创作后，顶部准确显示“1 项调整待保存”、说明“点击保存修改后统一生效”，操作区只有“撤销改动、刷新状态、保存修改”，页面中不存在“核对并保存”“保存并生效”或保存确认对话框，页面级横向溢出为 0。随后点击“撤销改动”恢复六项开关全部开启、无待保存状态且隐藏保存按钮。验收未点击“保存修改”，没有更改服务端配置或调用写接口。源文件中只保留“离开未保存页面”和“刷新覆盖草稿”两个必要确认层，保存路径不再调用确认层；目标文件经 Prettier 格式化。
- 潜在影响：功能开放从两次保存确认缩短为一次，管理员点击“保存修改”后会立即提交当前全部暂存项，因此不再在提交前集中展示每项前后值；每个功能的当前效果、控制范围和相反状态影响仍可在共用详情区查看，且提交前仍可撤销。功能字段、七项载荷、插件依赖、模型来源映射、只读运行状态、API、权限、刷新覆盖提醒与离开保护均未改变；其他系统配置入口仍沿用各自现有保存流程。
- 逐项回滚：从 `.local/ui-change-backups/batch-062/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `11081f08c7c974816586db58925e5dadaa5839339e97bf87c810ad9d2a9e1121`、`6da12fe6b5c2a21f7cd71b174aff63ae22c036868ebd6a50973a49bc1b8a3bbe` 和 `0d3dd12b515a56e3f9c87d6f0fcf358892b8e3c250e60b2ca3cbb106a7c8b4fb`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-062/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 063：资源与策略接入通用设置骨架

- 日期时间：2026-08-28 07:51 CST
- 目的：把已经成熟的资源与策略页面迁移到通用配置目录和锚点命名，作为其余系统配置入口共同复用的结构基线。
- 修改前状况：资源与策略已经具备状态栏、四格概览、五项策略目录和纵向左右分栏设置卡，但目录和锚点仍使用页面专属类名，其他入口无法直接复用同一骨架。
- 涉及文件：`web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将资源与策略的专用目录、目录说明、目录链接类名替换为系统配置通用目录骨架；五个策略锚点同时接入通用设置锚点并保留原专用类名，以继续沿用字段网格和既有页面规则。目录内容、待保存数量、平滑定位、五张纵向左右分栏卡、42 个策略字段、暂存与保存流程均未改动。
- 验证结果：全量 TypeScript `tsc --noEmit` 为 0 错误。真实已登录暗色页面确认四格概览、五项目录和五张设置卡完整显示；目录依次为资源配额 12 项、任务并发 3 项、任务超时 6 项、业务频控 13 项、中转与熔断 8 项。状态栏、概览、目录和五张设置卡宽度均为 1784px、右边界统一为 2028px，页面级横向溢出为 0。状态栏显示配置已同步且没有保存按钮，未产生草稿或写请求；目标文件经 Prettier 格式化。
- 潜在影响：资源与策略的目录视觉与行为保持不变，结构类名转为通用后可由其他入口复用；原专用目录样式暂时保留，待全部入口迁移完成并确认无引用后再单独清理。策略值、配置来源、API、权限、暂存、保存确认、恢复默认和移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-063/` 按原相对路径恢复 `web/src/pages/admin/settings/runtime-policy-settings-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `550e312e1a86b19e935f7ace572514a119ba244ba3263c9ab0f9c2276f306d7e`、`ec8ef9e2b9b34f8a8425bd2340bbeb948061dbf589ba3ecc1fab8b29b6ffe46b` 和 `01c2c2be85ef7915cee6d8913a3251208bc828b3df0828d2f8851e6d1ea74909`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-063/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 064：登录与注册、邮件服务接入统一设置骨架

- 日期时间：2026-08-28 08:03 CST
- 目的：把登录与注册、邮件服务统一为“状态操作栏、四格概览、配置目录、纵向左右分栏设置区”的系统配置页面骨架。
- 修改前状况：两个入口已有状态栏和四格概览，但缺少配置目录；设置卡采用整块上下排列，和资源与策略、绘图工具的左右分栏层级不一致，管理员需要进入长表单后才能判断页面包含哪些配置域。
- 涉及文件：`web/src/pages/admin/components/access-settings-panel.tsx`、`web/src/pages/admin/components/email-settings-panel.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为两个入口各建立两项配置目录，并为读取中的骨架态补充相同位置的目录占位，避免内容加载前后结构跳变。登录与注册目录为“注册策略 / 创建新账号”和“Linux.do 登录 / 入口、凭据与 OAuth”；邮件服务目录为“验证码投递 / 注册邮件”和“SMTP 配置 / 连接、验证与发件人”。所有设置区接入通用锚点，移除页面专属的整块堆叠布局，改用统一的左侧说明与状态、右侧业务控件；原表单、开关、校验、暂存、确认与保存逻辑完整保留。设计规范同步记录两个入口的目录语义与固定阅读顺序。
- 验证结果：两个目标文件经 Prettier 格式化，全量 TypeScript `tsc --noEmit` 为 0 错误。真实已登录后台在 `2048×941` CSS 视口检查两个入口：状态栏、四格概览、配置目录和每个设置锚点宽度均为 1784px，左右边界统一为 244px / 2028px；登录与注册显示 2 项目录、2 个设置区，邮件服务显示 2 项目录、2 个设置区，均不存在旧的 `is-stacked` 页面结构，页面级横向溢出为 0。亮色目录表面为白色、15% 深色边界、正文为深色；暗色目录表面为 `rgb(26, 29, 32)`、16% 浅色边界、正文为浅灰，两个主题下均清晰可读。验收未操作注册开关、邮件开关或任何保存按钮，没有调用写接口或改变服务端配置；最终恢复暗色主题。
- 潜在影响：两个入口新增约 64px 高的配置目录，长页面主体相应下移；设置卡从上下大块变为左右信息分栏，PC 宽屏的字段可用宽度更大。配置字段、默认值、API、权限、注册立即生效确认、Linux.do 和邮件草稿核对、离开保护、移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-064/` 按原相对路径恢复 `web/src/pages/admin/components/access-settings-panel.tsx`、`web/src/pages/admin/components/email-settings-panel.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `21c9f8fd5768e0568e850e3bafda1f8f5dc7da430f1002fbc598373c49d54f78`、`458b86d1dbc310150e5c96eea5fd9dfb691598564f5ae8f8e4d0372c18f4f8aa`、`ec8ef9e2b9b34f8a8425bd2340bbeb948061dbf589ba3ecc1fab8b29b6ffe46b` 和 `4602cf1d49aa71a7894997b6719c3e3de4d368aaf053b9070e679fa12d9fb82b`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-064/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 065：存储服务、方舟素材库接入统一设置骨架

- 日期时间：2026-08-28 08:10 CST
- 目的：把存储服务、方舟素材库统一为系统配置共同的信息层级和阅读方向。
- 修改前状况：两个入口已有状态栏、四格概览与两张业务设置卡，但都缺少配置目录，设置卡仍使用整块堆叠结构，无法从页面上部快速判断后续配置域。
- 涉及文件：`web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为两个入口各建立两项配置目录并在读取骨架态保留同位置占位。存储服务目录为“存储位置 / 新增资源”和“访问与凭据 / 读取链路”；方舟素材库目录为“可信素材同步 / 触发条件”和“方舟项目与 IAM / 项目与服务端凭据”。四个业务设置区接入通用锚点，移除页面专属的整块堆叠布局，统一为左侧说明与状态、右侧原业务控件；存储模式卡、云厂商表单、方舟触发条件、IAM 表单、暂存与保存逻辑均未改变。设计规范同步固化两个入口的目录语义和阅读顺序。
- 验证结果：两个目标文件经 Prettier 格式化，全量 TypeScript `tsc --noEmit` 为 0 错误。真实已登录后台在 `2048×941` CSS 视口检查两个入口：状态栏、四格概览、配置目录和每个设置锚点均为 1784px 宽、右边界 2028px；存储服务和方舟素材库各显示 2 项目录、2 个设置区，旧 `is-stacked` 结构数量均为 0，页面级横向溢出均为 0。亮色目录表面为白色、15% 深色边界、正文深色；暗色表面为 `rgb(26, 29, 32)`、16% 浅色边界、正文浅灰。验收未切换存储厂商、未修改同步开关或表单、未点击保存，没有调用写接口或改变服务端配置；最终恢复暗色主题。
- 潜在影响：两个入口新增约 64px 高的配置目录，长页面主体相应下移；设置卡在宽屏下改为左右信息分栏，原业务控件区域可获得更稳定的阅读宽度。配置字段、默认值、API、权限、草稿核对、离开保护、历史资源语义、方舟同步语义和移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-065/` 按原相对路径恢复 `web/src/pages/admin/settings/storage-settings-page.tsx`、`web/src/pages/admin/settings/ark-private-assets-settings-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `7755841f59ff1607237b92f485717eef66078f279e252dd85b6c2cc5f591cb5f`、`469088adeabafb995c836ce083b379975faa7434da06107ab7918849c68adb84`、`8fa6157445f27dede8b047c908bc68201bb5663f13943bc169cf6f117992b82a` 和 `ae3bf8f0b6cc8afd680c2ce1957fa9c3134f37c82c568ee0d9313efc3452ddee`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-065/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 066：模型响应拦截、第三方参数配置接入统一设置骨架

- 日期时间：2026-08-28 08:17 CST
- 目的：完成系统配置剩余两个入口的统一骨架迁移，使八个入口使用相同页面层级。
- 修改前状况：模型响应拦截有三张整块堆叠卡，第三方参数配置有一张整块堆叠卡；两页都缺少配置目录，页面上部无法快速说明后续设置域。
- 涉及文件：`web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/pages/admin/settings/libtv-settings-page.tsx`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：模型响应拦截新增三项目录：“全局策略 / 开关与作用范围”“规则与优先级 / 最多 100 条”“本地命中预览 / 仅当前浏览器”；第三方参数配置新增一项目录：“LibTV 画布导入 / 入口、凭据与连接验证”。读取骨架态同步保留目录占位，四个业务设置区接入通用锚点并移除整块堆叠布局，统一为左侧说明与状态、右侧原业务控件。规则编辑、优先级、本地预览、LibTV 开关、Token 草稿和真实只读验证逻辑均未改变；设计规范同步记录目录语义及后续新增第三方平台的扩展方式。
- 验证结果：两个目标文件经 Prettier 格式化，全量 TypeScript `tsc --noEmit` 为 0 错误。真实已登录后台在 `2048×941` CSS 视口检查两个入口：状态栏、四格概览、配置目录和所有设置锚点均为 1784px 宽、右边界 2028px；模型响应拦截显示 3 项目录与 3 个设置区，第三方参数配置显示 1 项目录与 1 个设置区，旧 `is-stacked` 结构数量均为 0，页面级横向溢出均为 0。亮色目录表面为白色、15% 深色边界、正文深色；暗色表面为 `rgb(26, 29, 32)`、16% 浅色边界、正文浅灰。随后逐页巡检功能开放、绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置，九个入口页面级横向溢出均为 0，所有通用骨架区块宽度均为 1784px、右边界 2028px。Vite 生产构建完整通过，转换 12,695 个模块并重新生成前端产物，仅保留项目既有的大分块体积提示。验收未改动拦截开关或规则、未输入 Token 或 UUID、未执行真实外部连接验证、未点击保存，没有调用写接口或改变服务端配置；最终恢复暗色主题。
- 潜在影响：两个入口新增约 64px 高的配置目录，长页面主体相应下移；设置卡在宽屏下改为左右信息分栏。第三方参数目前只有一个目录项，但为后续新增外部平台保留稳定扩展位置。配置字段、默认值、API、权限、草稿核对、离开保护、规则语义、真实连接验证边界和移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-066/` 按原相对路径恢复 `web/src/pages/admin/settings/response-interception-settings-page.tsx`、`web/src/pages/admin/settings/libtv-settings-page.tsx`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 分别为 `e9e59223d916d02cf27fd4962237d2742d9c1f6ea9afd93256e2504cb7ae42c0`、`e480b40af6950233b2a0b452490f3ae76c802b851fc9c099c4909f2a2b86d3e4`、`a58547b710a5bd9d6d217cb28f26cd87c4c20435103cdd098521231dfc57d959` 和 `35760bc08a6fc9f6f5ff8c40365dacdb91b8f81338445e3cbddf850b094d9490`。恢复前若文件已包含后续批次，应先复制当前版本；完整清单与安全说明见 `.local/ui-change-backups/batch-066/MANIFEST.md`，不需要初始化、提交或使用 Git。

## 批次 067：移除系统配置目录

- 日期时间：2026-08-28 08:31 CST
- 目的：按用户反馈移除各系统配置入口中不需要的配置目录，让四格概览后直接进入设置内容。
- 修改前状况：绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置均在概览与设置区之间显示一整行配置目录；目录重复了下方设置区标题并增加了纵向占用。
- 涉及文件：上述八个页面组件、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：从绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置中删除实际目录 DOM，加载骨架态中的目录占位同步删除；移除八个页面不再使用的 `ListTree` 图标、六组只服务于目录的数据常量和运行策略目录中的待保存计数入口。保留各设置区的原顺序、通用锚点包装和左右分栏，四格概览后以 16px 标准间距直接进入第一块设置内容。清理 `globals.css` 中全部目录表面、目录链接、响应式和减少动画规则，不使用 `display: none` 隐藏残留结构。设计规范同步改为“页面标题 → 状态操作栏 → 四格关键概览 → 纵向设置区”，并移除各入口的目录要求。
- 验证结果：八个目标组件和全局样式经 Prettier 格式化，全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块，仅保留项目既有的大分块体积提示。源代码、全局样式和最新生产产物均不存在 `admin-settings-directory`、`配置目录`、`策略目录` 或对应目录数据常量。清理前端开发预览的旧懒加载缓存后，真实已登录后台逐页检查八个入口：目录 DOM 和目录文案数量均为 0，四格概览与第一块设置区间距均为 16px，概览和设置区宽度均为 1784px、右边界 2028px，页面级横向溢出均为 0。亮色设置表面为白色、15% 深色边界，暗色设置表面为 `rgb(26, 29, 32)`、16% 浅色边界；最终恢复暗色主题。验收未操作业务开关、表单、保存或外部验证入口，没有调用写接口或改变服务端配置。
- 潜在影响：目录定位入口已移除，长设置页不再支持通过目录按钮快速跳到指定分区；页面整体缩短约 78px，设置区顺序、标题、状态和内容仍完整可见。配置字段、默认值、API、权限、草稿、保存确认、离开保护、业务语义和移动端规则均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-067/` 按原相对路径恢复八个页面组件、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-067/MANIFEST.md`。恢复前若文件已包含后续批次，应先复制当前版本；本批不需要初始化、提交或使用 Git。

## 批次 068：系统配置九入口直接保存

- 日期时间：2026-08-28 08:45 CST
- 目的：按用户要求取消系统配置普通修改的二次确认；开关和互斥选择切换后直接提交，文本、密钥和数值配置点击一次保存即提交。
- 修改前状况：九个入口的保存交互不统一；部分开关只进入草稿，随后需要点击“核对并保存”并再次确认，用户注册开关也会先弹影响确认。功能开放虽已取消保存弹窗，但开关仍需额外点击保存按钮。
- 涉及文件：九个系统配置入口组件、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：功能开放的六个业务 Switch 和模型来源互斥选择改为单项即时提交，顶部状态栏在写入期间显示“提交中”，成功后以服务端返回值同步页面与全局能力，失败恢复修改前状态；删除该页暂存数量、撤销和额外保存入口。绘图工具的默认编辑器选择在授权条件满足时立即保存，License Key 继续由“保存修改”一次提交。资源与策略的 42 个数值仍先暂存，但“保存修改”验证通过后直接提交，删除最终核对弹层。登录与注册的用户注册和 Linux.do 入口开关改为即时保存，Linux.do 凭据、OAuth 端点和字段映射仍一次保存。邮件验证码、方舟可信素材同步、模型响应拦截和 LibTV 导入入口均改为即时保存；启用条件不足时拒绝写入、恢复服务端状态并提示缺失配置。即时关闭只组合服务端当前公开配置与关闭状态，不顺带提交同页未保存的凭据、地址或规则草稿；即时开启需要新凭据时才将满足启用条件的草稿原子提交。存储位置选择在目标配置完整时立即保存；新云厂商缺少必要配置时只切换到相应表单并提示补全，不提交无效配置。九个入口的文本、密钥、数值和规则表单统一使用“保存修改”，点击后直接验证并提交，不再出现普通保存二次确认。删除五个页面遗留的核对摘要组件和规则差异辅助代码，补全即时开关的可访问名称。继续保留未保存草稿的刷新覆盖确认和离开保护、运行策略“恢复系统默认”的破坏性确认、密钥清除的草稿语义、连接验证边界和所有原接口字段；设计规范同步固化九入口直接保存规则。
- 验证结果：九个目标组件与设计规范通过 Prettier；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并生成产物，只保留项目既有的大分块体积提示。真实已登录后台在 `2048px` CSS 视口逐页只读检查功能开放、绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置：九页标题与主内容正常加载，页面级横向溢出均为 0，控制台 error 为 0，普通保存确认层数量为 0，页面中不存在“核对并保存”或“确认保存”文案；功能开放六个 Switch、注册、Linux.do、邮件、方舟、响应拦截和 LibTV 开关均暴露“切换后立即保存/生效”的可访问名称。浏览器验收没有点击任何业务开关、存储厂商、编辑器选择或保存按钮，没有修改服务端配置、密钥、规则或调用外部验证。尝试运行现有 Bun 定向测试时当前终端环境未安装 `bun`，命令以 `command not found` 结束；因此本批以成功的全量类型检查、生产构建和真实页面只读回归作为等价验证，未宣称 Bun 测试通过。
- 潜在影响：普通配置路径少一层确认，开关和具备完整配置的互斥选择现在会在点击后立即影响服务端；提交期间同页相关控件会锁定，失败会回退。邮件、Linux.do、方舟和 LibTV 在启用时可能一并提交当前表单中为满足启用条件所需的凭据草稿；这是启用完整配置所必需的原子提交，界面仍不回显密钥明文。存储服务选择未配置的新云厂商不会立即写入，而是停留在该厂商表单等待补全，避免保存无效或不可用配置。资源与策略、License Key、SMTP、OAuth、存储凭据、方舟项目、拦截规则和第三方 Token 仍需点击一次“保存修改”。危险恢复、离开和刷新覆盖保护未取消。API 路由、字段、权限、服务端校验、数据结构和移动端范围均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-068/` 按原相对路径恢复 `feature-availability-panel.tsx`、`drawing-engine-settings-page.tsx`、`runtime-policy-settings-page.tsx`、`access-settings-panel.tsx`、`email-settings-panel.tsx`、`storage-settings-page.tsx`、`ark-private-assets-settings-page.tsx`、`response-interception-settings-page.tsx`、`libtv-settings-page.tsx`、`admin-ui-design-standard.md` 和 `admin-ui-change-log.md`。修改前 SHA-256、原路径和安全说明见 `.local/ui-change-backups/batch-068/MANIFEST.md`；恢复前若文件已包含后续批次，应先复制当前版本，可逐文件或整批覆盖恢复，不需要初始化、提交或使用 Git。

## 批次 069：系统配置九入口内容工作台重构

- 日期时间：2026-08-28 08:47 CST
- 目的：按用户反馈整体重构系统配置 9 个入口的内容布局与排版，统一阅读顺序、信息密度、摘要位置和配置区层级。
- 修改前状况：八个表单页都把四格摘要横向铺满主内容宽度，再把每个设置区拉伸到约 1784px；设置区标题说明长期占据左侧四分之一，控件区横向过宽且模块边界重复。功能开放使用另一套三列业务域与底部详情结构，九个入口缺少共同的内容工作台逻辑。资源与策略长页纵向超过五个大块，登录、邮件、方舟和第三方配置又存在单块高度过大、说明重复的问题。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。另为审查期间可能涉及的九个入口组件与共享设置组件一并保留了修改前快照，但最终没有改动这些业务组件。
- 具体改动：为系统配置建立统一 PC 内容工作台。`1600px` 及以上的八个表单入口改为左侧主配置流、右侧 `344px` 配置摘要；状态操作栏仍跨满整行，摘要以 2×2 紧凑指标呈现并跟随滚动，隐藏重复的指标说明，使管理员不离开当前操作上下文也能核对服务端状态。左侧设置区的说明列收窄至 `236px`，并用相邻表面和细边界区分“用途与状态”和“实际控件”；正文继续按各入口已有的字段网格组织。功能开放同步改为左侧 2×2 业务域板、右侧 `360px` 当前功能详情，最后一个业务域横跨左侧，详情随滚动保持可见。`1600px` 以下统一回退为原有完整单列与横向摘要，避免中等 PC 的主操作区被双栏压窄；默认摘要高度由约 112px 收至 88px。补充减少动画偏好规则，并将最终布局覆盖放在旧页面规则之后，保证九个入口使用同一层叠结果。设计规范同步固化工作台结构、断点、摘要密度、明暗主题层级和功能开放的宽屏详情位置。业务组件、字段、接口、权限、即时保存与移动端规则均未修改。
- 验证结果：目标样式与文档经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建完整通过，转换 12,695 个模块并生成产物，仅保留项目既有的大分块体积提示。真实已登录后台在 `2048px` CSS 视口逐页检查九个入口：功能开放左侧业务域宽 `1408px`、右侧详情宽 `360px`；其余八页左侧主配置流宽 `1424px`、右侧摘要宽 `344px`，摘要高度统一为 `182px`，九页页面级、工作台内部和设置区内部横向溢出均为 0。`1600px` 边界下双栏主区宽 `976px`、摘要宽 `344px`；`1500px` 和 `1280px` 自动回到完整单列，宽度分别为 `1236px` 和 `1016px`，均无横向溢出。暗色主题逐页检查九个入口均正常渲染，卡片表面为 `rgb(26, 29, 32)`、正文为浅色且无溢出；随后恢复浅色主题。页面运行日志没有应用 error。浏览器验收没有点击任何业务开关、互斥选择、保存或外部验证入口，没有调用写接口或改变服务端配置。
- 潜在影响：大于等于 `1600px` 的 PC 视口中，摘要从主配置流顶部移到右侧并保持可见，主配置区宽度相应减少 `360px`；超长字段网格仍在主区内按原断点排列。中等与较窄 PC 不使用双栏，因此不会因摘要栏挤压表单。右侧摘要省略了四项指标的次级说明，但指标名称和值完整保留；详细语义仍在状态栏和设置区中展示。本批没有修改业务 DOM、配置值、API、权限、保存时机、危险操作确认或移动端布局。
- 逐项回滚：仅需从 `.local/ui-change-backups/batch-069/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`，即可撤销本批实际改动；修改前 SHA-256、完整预防性快照和安全说明见 `.local/ui-change-backups/batch-069/MANIFEST.md`。若只回滚视觉而保留记录，可只恢复 `globals.css`，并在本条后追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。不需要初始化、提交或使用 Git。

## 批次 070：设置卡说明单元垂直居中

- 日期时间：2026-08-28 09:05 CST
- 目的：按用户截图反馈修正设置卡左侧标题、说明和状态分布松散的问题，使其呈现为清晰、紧凑的表格说明单元。
- 修改前状况：宽屏设置卡右侧业务内容较高时，左侧说明单元随卡片等高，但标题和说明固定在顶部，状态标签仅按普通文档流排列，剩余高度全部成为无意义空白；标题、说明和状态看起来彼此脱节。
- 涉及文件：`web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为共享 `SettingsSectionCard` 的信息组和状态容器补充稳定语义类名，并标记是否存在图标。八个表单型系统配置入口的宽屏说明列由 `236px` 调整为 `264px`，减少说明文字的无效换行；在 `1024px` 及以上 PC 布局中，将左侧说明区改为纵向 Flex 表格单元，图标、标题、说明和状态作为一个整体在卡片高度内垂直居中。状态与标题文字起始位置对齐，有图标时使用 `44px` 文本缩进，不再孤立地贴在说明列左下方。规则仅作用于系统配置的 `.admin-settings-stack`，不影响后台其他页面或堆叠式设置卡。设计规范同步记录说明单元的垂直居中和状态对齐要求。
- 验证结果：目标组件、样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录后台逐页检查绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置：所有设置卡的说明信息组上下留白差值均为 0，状态均完整位于说明单元边界内，宽屏说明列统一为 `264px`，八页均无页面级横向溢出。存储服务两张卡的说明单元高度分别为 `210px` 和 `315px`，信息组上下留白分别为 `33px / 33px` 和 `95px / 95px`。`1500px` 与 `1280px` CSS 视口检查均无页面或设置卡横向溢出。暗色主题下说明表面、标题、说明和状态标签对比清晰，随后恢复浅色主题。验收未点击业务开关、选择项、保存或外部验证入口，没有调用写接口或改变服务端配置。
- 潜在影响：表单型系统配置页的左侧说明信息现在位于卡片纵向中心；当右侧表单特别高时，说明区顶部会留下与底部对称的空间，这是表格单元的预期视觉。宽屏主控件区减少 `28px`，实际检查未造成字段溢出。功能开放使用独立的紧凑业务域结构，不需要该说明单元规则。本批未修改右侧业务控件、字段、接口、权限、保存行为、危险操作确认或移动端范围。
- 逐项回滚：从 `.local/ui-change-backups/batch-070/` 按原相对路径恢复 `web/src/pages/admin/components/admin-ui.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-070/MANIFEST.md`。若只撤销视觉调整，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 071：功能开放接入表格式业务域

- 日期时间：2026-08-28 09:12 CST
- 目的：修正批次 070 遗漏的功能开放入口，使九个系统配置入口都遵循说明单元垂直居中的阅读方式。
- 修改前状况：功能开放使用独立业务域组件，未复用 `SettingsSectionCard`，因此批次 070 的共用说明列规则只覆盖另外八个入口；三个业务域仍采用顶部标题栏，和其他系统配置入口的表格式信息层级不一致。
- 涉及文件：`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：为功能开放业务域标题文案和状态增加稳定语义容器。`1024px` 及以上 PC 中，三个业务域由并列顶部标题卡改为纵向表格式业务域：左侧使用 `230–264px` 说明单元，图标、标题、说明和状态作为一个整体垂直居中，状态与标题文字起始线对齐；右侧保留原紧凑控制行，用户工作台四项继续使用 2×2，插件策略和模型与环境各使用两行。业务域控制区与说明区通过单条纵向分隔线区分，不再重复顶部标题横线。`1600px` 及以上继续保留右侧 `360px` 共用详情栏，较窄 PC 中详情自然回到业务域下方；读取骨架态不套用新网格，避免加载结构异常。设计规范同步将功能开放纳入九入口统一的表格式阅读规则。
- 验证结果：目标组件、样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录后台在 `2048px` CSS 视口检查：三个业务域均为 `1408×136px`，左侧说明单元为 `264×134px`，右侧控制区宽 `1142px`；标题信息组上下留白均为 `20px`，状态完整位于说明单元内并与标题起始线对齐。`1500px`、`1280px`、`1024px` 视口下业务域宽分别为 `1236px`、`1016px`、`760px`，控制区宽分别为 `970px`、`784px`、`528px`，页面、业务板和业务域内部横向溢出均为 0。暗色主题下说明表面、标题、说明、状态和分隔线对比清晰，随后恢复浅色主题。页面仍完整呈现 6 个业务 Switch 和 2 个模型来源 Radio；验收未点击这些业务控件、刷新或外部入口，没有调用写接口或改变服务端配置。
- 潜在影响：功能开放三个业务域由两列卡片排列改为三行表格式排列，页面业务板高度略有变化，但信息扫描方向与另外八个系统配置入口一致；右侧控制行获得更稳定宽度。`1024px` 以下仍保留原上下结构。本批没有修改七个可写字段、即时保存、插件依赖、只读环境状态、共用详情内容、接口、权限或主题切换逻辑。
- 逐项回滚：从 `.local/ui-change-backups/batch-071/` 按原相对路径恢复 `web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-071/MANIFEST.md`。若只撤销功能开放布局，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 072：功能开放说明区背景统一

- 日期时间：2026-08-28 09:18 CST
- 目的：按用户截图反馈消除功能开放业务域左侧说明区与右侧控制区背景割裂的问题。
- 修改前状况：三个业务域的左侧说明单元使用由二级表面混合出的整块浅灰背景，右侧控制区使用白色卡片表面；两块背景并置后像卡片内部又增加了一条侧栏，削弱了表格行的一体感。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将功能开放三个业务域的左侧说明单元背景从二级混合表面改为与整个业务域一致的一级卡片表面；右侧控制区继续继承同一背景，说明与控制职责只由纵向细分隔线、图标浅底、标题和状态层级表达。亮暗主题均使用各自的 `--admin-layer-1`，不添加硬编码颜色。此次规则只修改功能开放业务域表面；实施检查中发现一次选择器命中到另外八页说明卡后已立即恢复，最终差异不包含该误命中。
- 验证结果：目标样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录功能开放页面检查三个业务域：亮色下业务域和说明单元均为 `rgb(255, 255, 255)`，暗色下两者均为 `rgb(26, 29, 32)`；右侧透明控制区正确继承相同卡片表面，纵向分隔线在亮色为 12% 深色、暗色为 12% 浅色，两个主题均清晰可见。页面级横向溢出为 0，随后恢复浅色主题。验收未点击任何业务开关、来源选择、刷新或外部入口，没有调用写接口或改变服务端配置。
- 潜在影响：左侧说明区不再通过整块异色强调，三个业务域现在更像一体化表格行；层级仍由边界、分隔线、图标和字体完整表达。布局尺寸、垂直居中、状态位置、控件、即时保存、接口、权限和移动端范围均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-072/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-072/MANIFEST.md`。若只撤销背景调整，可仅恢复 `globals.css` 并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 073：八个表单型配置入口背景统一

- 日期时间：2026-08-28 09:24 CST
- 目的：按用户要求将功能开放已经确认的同底色表格规则扩展至剩余八个系统配置入口。
- 修改前状况：绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置在宽屏下仍为左侧浅灰说明单元、右侧卡片本体背景，与刚统一的功能开放业务域不一致。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将八个表单型系统配置入口在 `1600px` 及以上工作台中的左侧说明单元，从二级混合表面统一为与右侧内容区相同的 `--admin-layer-1` 卡片表面。继续保留纵向细分隔线、图标浅底、标题、说明和状态层级，垂直居中、`264px` 说明列和右侧字段网格均不改变。设计规范同步将“说明区与控件区同底色”固化为九入口共同规则。
- 验证结果：目标样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录后台逐页检查绘图工具、资源与策略、登录与注册、邮件服务、存储服务、方舟素材库、模型响应拦截和第三方参数配置：亮色下所有设置卡说明区与内容区均为 `rgb(255, 255, 255)`，纵向分隔线为 12% 深色；暗色下两区均为 `rgb(26, 29, 32)`，分隔线为 12% 浅色。八页页面级和设置卡内部横向溢出均为 0，随后恢复浅色主题。验收未点击业务开关、选择项、保存、刷新或外部验证入口，没有调用写接口或改变服务端配置。
- 潜在影响：其余八个入口不再通过整块浅灰背景强调说明列，九个系统配置入口现在全部使用一体化表格卡片表面；职责边界仍由纵向分隔线、图标、字体和状态完整表达。布局尺寸、字段、控件、保存逻辑、接口、权限、危险操作确认和移动端范围均未修改。
- 逐项回滚：从 `.local/ui-change-backups/batch-073/` 按原相对路径恢复 `web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-073/MANIFEST.md`。若只撤销背景统一，可仅恢复 `globals.css` 并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 074：侧栏品牌与更新日志重排

- 日期时间：2026-08-28 09:30 CST
- 目的：按用户最终确认的层级，将 PC 侧栏顶部整合为左图标、右品牌名与版本号的品牌信息块，并让整个信息块直接承担更新日志入口。
- 修改前状况：品牌在展开侧栏中靠左并使用指向 `/` 的链接；更新日志与“返回创作台”一起固定在侧栏底部，产品身份、版本信息和跨工作区导航混在同一辅助区。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/components/layout/app-changelog-modal.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：PC 侧栏顶部改为单个完整品牌信息按钮，展开态使用两列结构：左侧品牌图标根据可用空间在 `34–38px` 内自适应，右侧上方显示“影策”、下方显示当前版本号；整块支持悬停、键盘焦点和点击，点击只打开原更新日志弹窗，不再跳转根路径。收起态隐藏文字与版本，仅保留 `32px` 居中品牌图标和“查看更新日志”提示。身份区以单条分隔线连接主导航；原底部更新日志入口移除，底部只保留“返回创作台”。更新日志按钮增加可选图标和标签插槽，默认外观与移动端等既有调用保持不变。设计规范同步固化品牌信息、版本归属、点击行为和收起规则。
- 验证结果：目标组件、样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录后台检查展开侧栏：侧栏宽 `224px`，品牌信息按钮位于 `x=12px`、宽约 `199.2px`、高约 `53.6px`；品牌图标为 `38×38px` 且右边界约 `59.8px`，标题与版本左边界均约 `69.8px`，标题位于 `y=19.3px`、版本位于 `y=40.3px`，确认左图标与右侧上下两行信息没有重叠或错位。点击品牌信息块后 URL 保持不变，完整更新日志弹窗正常打开并关闭。收起侧栏宽 `64px` 时，品牌按钮和 `32px` 图标中心点均约 `31.6px`，标题与版本节点不渲染，侧栏横向溢出为 0；随后恢复展开状态。暗色主题下标题为高对比前景色、版本为约 54% 前景色、品牌图标使用浅底深色图形，亮暗层级清楚；最终恢复浅色主题。验收没有触发业务操作、页面导航、保存或写接口。
- 潜在影响：顶部品牌从导航链接改为更新日志按钮；需要离开管理后台时使用底部“返回创作台”。品牌与版本现在合并占用一个紧凑身份区，不再额外增加独立更新日志行。移动端更新日志入口保持原样。本批没有修改后台路由、权限、业务页面、API、侧栏状态存储或主题切换逻辑。
- 逐项回滚：从 `.local/ui-change-backups/batch-074/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/components/layout/app-changelog-modal.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-074/MANIFEST.md`。若只撤销侧栏结构，恢复前三个代码与样式文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 075：更新日志弹窗排版重构

- 日期时间：2026-08-28 09:44 CST
- 目的：解决更新日志版本徽标突兀、标题重复、版本边界不清和长列表难以扫描的问题。
- 修改前状况：弹窗标题中的 Ant Design 版本 Tag 在当前主题下显示为近似纯黑色块；标题区已有“更新日志”，正文仍重复显示“CHANGELOG”；所有版本使用连续标题与普通项目符号列表，长内容缺少稳定分段表面，版本切换点不明显。
- 涉及文件：`web/src/components/layout/app-changelog-modal.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除通用 Tag，改为“当前版本 + 版本号”的中性描边标识；标题区重排为图标、标题说明和当前版本三段结构。正文不再渲染重复的一级 `CHANGELOG` 标题，将 `Unreleased` 本地化为“开发中”并标记“最新”，其余版本按时间顺序使用节点、版本标题和独立列表表面形成紧凑时间线。统一正文行高、版本间距、列表缩进、代码片段、内部滚动和滚动条占位；弹窗宽度由 `760px` 调整为 `820px`，窄屏仍自动收敛为两列标题和紧凑内边距。所有颜色均由主题前景、背景与边界 token 混合生成。
- 验证结果：目标组件、样式、规范、记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，仅保留项目既有的大分块体积提示。真实已登录后台打开更新日志检查：弹窗语义名称由“更新日志、按版本查看产品能力/交互/稳定性变化、当前版本”完整组成，正文不再出现重复 `CHANGELOG` 标题；首段显示“开发中 / 最新”，后续依次显示 `v1.2.0-preview.1`、`v1.1.4` 等原版本顺序。亮色下标题、版本标识、时间线节点、列表表面、项目符号和行内代码层级清楚，当前版本不再呈现纯黑色块；暗色下弹窗表面、列表边界、正文和代码片段均保持可见对比。长内容限制在独立滚动区，弹窗外页面保持遮罩且没有跟随滚动；关闭按钮正常工作，打开和关闭前后后台 URL 不变。最终关闭弹窗、恢复浅色主题并保持侧栏展开。验收没有触发业务操作、导航、保存或写接口。
- 潜在影响：更新日志弹窗比原来宽 `60px`，正文版本分段边界更明显；更新日志原始 Markdown、版本顺序、内容、打开与关闭逻辑均未改变。侧栏品牌入口和移动端入口继续复用同一弹窗。
- 逐项回滚：从 `.local/ui-change-backups/batch-075/` 按原相对路径恢复 `web/src/components/layout/app-changelog-modal.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-075/MANIFEST.md`。若只撤销弹窗排版，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 076：数据概览运营健康驾驶舱重构

- 日期时间：2026-08-28 09:55 CST
- 目的：将数据概览从“指标卡 + 重复摘要 + 大趋势图 + 混合标签”重构为首屏即可判断健康度、趋势与待处理事项的运营驾驶舱。
- 修改前状况：活跃用户、上游请求、生成任务和成功率四张大卡下面又重复展示队列、P95 和费用；`340px` 趋势图同时承担任务、请求和成功率，多数日期无数据时空白明显；异常信息位于首屏以下标签页；模型价格 CRUD 与模型、用户、异常分析并列为普通标签，读取与配置职责混杂。日变化徽标未说明比较基准，费用不可估算时只显示 `--`。
- 涉及文件：`web/src/pages/admin/components/analytics-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：页面说明改为“用户、任务、质量与成本健康度”。工具栏新增 7 天、30 天和本月快捷范围，保留自定义日期、高级用户/模型/渠道/能力筛选、刷新与导出。首屏重组为活跃用户、生成任务、服务质量、估算费用四张紧凑健康卡，将 DAU/WAU/MAU、上游请求、队列、P95 和费用覆盖归入对应卡片，涨跌统一标注“较前一日”，费用缺失明确显示“待配置”。趋势区降低至约 `280px`，使用“用量 / 质量 / 活跃”切换分别展示相关曲线。新增“需要关注”区域，提前显示异常请求、当前队列和费用可估算模型，异常项可切换并定位到异常分析。深度分析仅保留模型、用户和异常标签；模型价格改为独立配置抽屉，原新增、编辑、删除、分页和安全确认逻辑全部复用。`1280px` 以上趋势与关注区双列排列，更窄 PC 自动单列；补充键盘焦点、按压状态、减少动画和主题 token 样式。
- 验证结果：目标组件、路由文案、样式、设计规范、变更记录和回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（共转换 `12695` 个模块，耗时约 `4s`），仅保留项目既有的大分块体积提示。真实已登录后台在默认 CSS 视口 `2048 × 941` 检查：文档横向溢出为 `0`，趋势与关注区分别约为 `1253.9px / 514.1px`，关注区三行自动均分高度且没有多余空白；四张健康卡、约 `280px` 趋势图和三类关注项层级清楚。在显式 CSS 视口 `1278 × 900` 检查：文档横向溢出仍为 `0`，侧栏正常显示，健康卡保持四列，趋势与关注区按规范转为上下单列。暗色主题下健康卡和关注区表面为主题深色表面，文字、状态与边界均可辨识；最终已恢复浅色主题、默认视口和展开侧栏。交互检查覆盖：7 天范围将起始日期正确更新为 `2026-08-22`，随后恢复 30 天 `2026-07-30` 至 `2026-08-28`；高级筛选显示四个具名筛选框；用量/质量/活跃趋势切换、异常关注项跳转、模型/用户/异常分析标签均可用；模型价格抽屉可正常打开和关闭，原新增入口、列表与空状态仍在。除日期范围读取外，本批验收未执行价格新增、编辑、删除或其他业务写操作。
- 潜在影响：数据概览首屏信息顺序和模型价格入口位置改变；图表默认仍显示用量，原统计数据、筛选查询参数、CSV 导出、表格字段、价格 CRUD、分页、接口、权限和服务端口径均未修改。点击快捷范围会立即按原查询机制重新读取相应日期数据；异常关注项只切换前端分析标签并滚动定位，不发起写请求。
- 逐项回滚：从 `.local/ui-change-backups/batch-076/` 按原相对路径恢复 `web/src/pages/admin/components/analytics-panel.tsx`、`web/src/pages/admin/admin-route-pages.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-076/MANIFEST.md`。若只撤销驾驶舱，可仅恢复前三个代码与样式文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 077：数据概览纵向滚动恢复

- 日期时间：2026-08-28 10:23 CST
- 目的：修复数据概览内容超过一屏后无法向下滚动的问题，同时保持后台固定侧栏与独立内容滚动模式。
- 修改前状况：数据概览重构后的主体高度约为 `1121px`，页面框架实际可用高度约为 `942px`；该入口仍未启用 `AdminPageFrame` 已有的滚动模式。根工作区按设计使用 `overflow: hidden`，而中间内容层也没有滚动容器，导致下方深度分析区域被截断且鼠标滚轮无效。
- 涉及文件：`web/src/pages/admin/admin-route-pages.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：仅为数据概览的 `AdminPageFrame` 启用既有 `scroll` 属性，使 `WorkspacePage` 获得 `app-workspace-scroll overflow-y-auto`，并让页面框架使用自动高度与至少一屏高度。侧栏、顶层工作区、数据组件、查询参数、接口和业务行为保持不变。
- 验证结果：真实已登录后台在默认 CSS 视口检查，数据概览根内容层已具有 `app-workspace-scroll overflow-y-auto` 与 `admin-page-root-scrollable`，计算后的 `overflow-y` 为 `auto`；容器可见高度约 `942px`、内容高度约 `1261px`，最大纵向滚动距离约 `319px`。程序化滚动至底部后实际 `scrollTop` 约为 `319.6px`，下方深度分析区底部位于视口 `881.6px`，已完整进入可视范围；侧栏顶部滚动前后均为 `0`，证明侧栏保持固定。文档横向溢出为 `0`，最终已将内容滚动位置恢复为顶部。目标页面与记录经 Prettier 检查；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（耗时约 `4.58s`），仅保留项目既有的大分块体积提示。
- 潜在影响：数据概览主内容区在内容超过可用高度时出现独立纵向滚动条；内容不足一屏时不会产生多余滚动。侧栏继续固定，不跟随主内容滚动。
- 逐项回滚：从 `.local/ui-change-backups/batch-077/` 按原相对路径恢复 `web/src/pages/admin/admin-route-pages.tsx` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-077/MANIFEST.md`。若只撤销滚动修复，可仅恢复路由页面文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 078：数据概览工具栏日期右置与对齐

- 日期时间：2026-08-28 10:28 CST
- 目的：将完整日期范围移动到工具栏右侧，并统一快捷时间、筛选、日期、刷新与导出控件的纵向基线和高度。
- 修改前状况：快捷时间、带顶部“时间范围”标签的日期控件和筛选按钮连续堆在左侧，日期标签额外占用一行，造成日期控件与筛选按钮上下错位；右侧只有刷新和导出，左右信息职责也不够清楚。
- 涉及文件：`web/src/pages/admin/components/analytics-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：左侧只保留 7 天、30 天、本月快捷范围和筛选入口；将完整日期范围移入右侧操作组并放在刷新、导出之前。移除占据视觉高度的日期顶部标签，保留“时间范围”分组语义和屏幕阅读器文本；将快捷范围外框、筛选按钮、日期选择器、刷新与导出统一为 `38px` 控件高度，并让右侧操作组垂直居中。
- 验证结果：真实已登录后台在默认 CSS 视口 `2048 × 941` 检查，左侧快捷时间外框约 `37.6px` 高，筛选按钮、右侧日期选择器、刷新和导出按钮均为 `38px` 高；五类控件的垂直中心均约为 `141.65px`，已处于同一基线。日期选择器左坐标约为 `1579.9px`，位于右侧操作组最前面，其后依次为刷新与导出；左侧只保留快捷时间和筛选。显式 CSS 视口 `1278 × 900` 下两组仍保持单行、同高与同基线，文档横向溢出为 `0`。日期分组继续保留“时间范围”可访问名称，视觉上不再出现额外顶部标签。最终已恢复默认视口、浅色主题、展开侧栏和页面顶部。目标组件、样式、记录与回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（耗时约 `5.58s`），仅保留项目既有的大分块体积提示。
- 潜在影响：日期范围入口从左侧移动到右侧，但日期值、快捷范围联动、查询参数、刷新、CSV 导出和所有接口行为均不改变。较窄 PC 仍由工具栏既有弹性布局自动换行。
- 逐项回滚：从 `.local/ui-change-backups/batch-078/` 按原相对路径恢复 `web/src/pages/admin/components/analytics-panel.tsx`、`web/src/styles/globals.css` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-078/MANIFEST.md`。若只撤销工具栏排版，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 079：模型分析能力标签可读性修复

- 日期时间：2026-08-28 10:32 CST
- 目的：修复数据概览深度分析中模型能力类型显示为黑色块、文字不可辨识的问题。
- 修改前状况：模型列下方使用 Ant Design `Tag` 的 `filled` 变体。在后台全局主题与组件库颜色叠加后，亮色主题下标签呈纯黑背景，标签中的“文本”“图片”“视频”“音频”等文字与背景对比异常，视觉上只剩黑色矩形。
- 涉及文件：`web/src/pages/admin/components/analytics-panel.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：移除能力标签的 `filled` 变体，为数据概览模型能力增加独立中性描边样式；使用主题前景色混合生成浅表面、边界与文字颜色，统一 `22px` 最小高度、`6px` 圆角和紧凑字重。能力类型继续显示原有本地化文字，不改变模型行、筛选值或统计数据。
- 验证结果：真实已登录后台滚动至深度分析模型表格检查，两个能力标签均正确显示“视频”，尺寸约为 `39.6 × 22px`，不再出现无文字黑块。亮色主题下标签背景为约 `rgb(240, 240, 240)` 的中性浅灰表面，文字使用约 `72%` 前景色、边界使用约 `14%` 前景色；暗色主题稳定后背景约为 `rgb(39, 42, 45)`，文字自动切换为约 `72%` 浅色前景，标签内容、边界和表格行均清楚可辨。最终已恢复浅色主题、页面顶部与展开侧栏，文档横向溢出为 `0`。目标组件、样式、记录与回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（耗时约 `4.98s`），仅保留项目既有的大分块体积提示。
- 潜在影响：模型能力标签由实心黑色块变为中性描边分类标签；仅影响显示，不改变能力枚举、价格配置、筛选、接口或业务逻辑。
- 逐项回滚：从 `.local/ui-change-backups/batch-079/` 按原相对路径恢复 `web/src/pages/admin/components/analytics-panel.tsx`、`web/src/styles/globals.css` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-079/MANIFEST.md`。若只撤销标签样式，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 080：请求明细媒体下载入口整合

- 日期时间：2026-08-28 10:40 CST
- 目的：改善请求明细“结果 / 估算”列中缩略图与下载按钮相互分离、下载图标悬空的问题。
- 修改前状况：媒体缩略图为 `42 × 34px`，下载使用无边界的 `28px` 文本按钮并排放在右侧；两者没有共同容器表面，下载图标看起来像独立文字，视觉重心偏右且点击区域归属不清楚。
- 涉及文件：`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将媒体结果整理为 `48 × 38px` 的独立预览单元，缩略图充满容器；下载按钮改为缩略图右下角的 `22px` 悬浮操作，使用半透明深色表面、浅色图标、细描边与轻阴影，悬浮和键盘聚焦时增强对比。预览按钮、媒体数量标记、下载标题、无障碍名称与原文件下载逻辑保持不变。
- 验证结果：真实已登录后台打开请求明细检查，有媒体行的结果单元为 `48 × 38px`，预览缩略图完整占据容器；下载按钮为 `22 × 22px`，定位在缩略图右下角且没有扩大表格列宽，页面横向溢出为 `0`。预览与下载仍分别具有“预览视频”和“下载原文件”按钮语义，验收未点击下载或触发业务操作。亮色与暗色主题下下载按钮均保持半透明深色表面、约 `92%` 白色图标和可见边界；最终已恢复浅色主题。目标样式、记录与回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（耗时约 `5.07s`），仅保留项目既有的大分块体积提示。
- 潜在影响：有媒体的结果单元宽度从原约 `73px` 收敛到 `48px`，下载入口叠放在缩略图右下角；无媒体文本、价格估算、详情入口、预览弹窗与下载行为均不改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-080/` 按原相对路径恢复 `web/src/styles/globals.css` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-080/MANIFEST.md`。若只撤销媒体下载排版，可仅恢复样式文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 081：请求明细下载按钮下置

- 日期时间：2026-08-28 10:43 CST
- 目的：按照结果单元的阅读顺序，将下载入口从缩略图覆盖层移动到缩略图下方。
- 修改前状况：批次 080 将下载图标整合到缩略图右下角，虽然解决了横向悬空，但按钮仍遮挡部分预览画面，图标含义也需要依赖悬浮提示才能明确。
- 涉及文件：`web/src/pages/admin/logs/logs-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：媒体结果改为固定 `48px` 宽的纵向组合，上方保留 `48 × 38px` 预览缩略图，下方新增同宽 `48 × 24px` 的“下载”按钮，明确显示下载图标与文字。按钮使用主题自适应的中性表面、控件边界和前景色，悬浮与键盘聚焦时提升层级；原下载标题、无障碍名称和下载逻辑保持不变。
- 验证结果：真实已登录后台打开请求明细检查，有媒体结果单元宽 `48px`、总高 `65px`；上方缩略图为 `48 × 38px`，下方“下载”按钮为 `48 × 24px`，两者垂直间距 `3px`，左右边界完全对齐且缩略图没有被遮挡。按钮继续具有“下载原文件”可访问名称，并新增可见“下载”文字；验收未点击按钮或触发实际下载。亮色主题下按钮使用浅色中性表面与深色文字，暗色主题下自动切换为约 `rgb(34, 38, 42)` 表面和浅色文字，文档横向溢出为 `0`；最终已恢复浅色主题。目标组件、样式、记录与回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建首次与并行检查同时运行时在转换完成后被系统终止，随后单独复核构建完整通过（耗时约 `4.19s`），仅保留项目既有的大分块体积提示。
- 潜在影响：有媒体的表格行结果单元高度增加约 `27px`，但缩略图不再被下载入口遮挡，下载操作含义更清楚；无媒体行、价格估算、预览和详情逻辑均不改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-081/` 按原相对路径恢复 `web/src/pages/admin/logs/logs-page.tsx`、`web/src/styles/globals.css` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-081/MANIFEST.md`。若只撤销下载按钮下置，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 082：请求明细独立下载列

- 日期时间：2026-08-28 10:47 CST
- 目的：将媒体下载从结果预览单元中彻底拆出，在“结果 / 估算”和“操作”之间提供独立、明确的下载列。
- 修改前状况：批次 081 将下载按钮放在缩略图下方，虽然不再遮挡图片，但下载仍与结果预览共用一个单元，使有媒体行高度增加，且“结果 / 估算”表头无法直接说明该单元还包含下载操作。
- 涉及文件：`web/src/pages/admin/logs/logs-page.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：在“结果 / 估算”和“操作”之间新增居中的“下载”列，固定宽度 `64px`；有媒体行显示 `30 × 30px` 的中性描边图标按钮，无媒体行显示 `--`。结果列恢复为单独显示缩略图与估算价格，操作列继续只放详情。下载按钮保留原始标题、无障碍名称和下载函数，不改变媒体 URL 或文件类型判断。
- 验证结果：真实已登录后台打开请求明细检查，表头顺序已明确为“结果 / 估算 → 下载 → 操作”；“下载”列具有独立列标题并位于两列之间。有媒体行在该列显示居中的 `30 × 30px` 下载图标按钮，继续具有“下载原文件”可访问名称；无媒体行显示 `--`。结果列只保留 `48 × 38px` 缩略图与估算价格，操作列只保留详情，表格行恢复紧凑且文档横向溢出为 `0`。暗色主题下下载按钮自动使用约 `rgb(34, 38, 42)` 表面与浅色图标，亮色主题下使用浅色中性表面；最终已恢复浅色主题，验收未点击下载或执行业务操作。目标组件、样式、记录与回滚清单经 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过（耗时约 `4.33s`），仅保留项目既有的大分块体积提示。
- 潜在影响：表格增加 `64px` 下载列，但结果单元高度恢复紧凑；表格原有横向滚动机制继续兜底。无媒体行现在会在下载列显示明确占位符。
- 逐项回滚：从 `.local/ui-change-backups/batch-082/` 按原相对路径恢复 `web/src/pages/admin/logs/logs-page.tsx`、`web/src/styles/globals.css` 与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-082/MANIFEST.md`。若只撤销独立下载列，可仅恢复前两个文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本。

## 批次 093：前后台侧栏提示与往返框架统一

- 日期时间：2026-08-29 01:14 CST
- 目的：在不改后台业务页面的前提下，统一后台与普通用户前端的折叠提示、返回创作台入口、PC 外壳宽度和侧栏状态。
- 修改前状况：后台折叠提示已有高对比 Ant Design Tooltip，但普通用户侧栏仍使用浏览器原生 `title`；后台“返回创作台”指向 `/canvas`，与普通用户工作台入口语义不一致；普通用户外壳比后台多出左右共 `12px` 留白；两个外壳只共享本地存储值，没有同标签页即时通知，前后台往返时可能短暂使用不同的展开宽度。
- 涉及文件：`web/src/components/layout/workspace-sidebar-nav.tsx`、`web/src/components/layout/app-top-nav.tsx`、`web/src/components/layout/workspace-sidebar-state.ts`、`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`web/src/styles/user-pc.css`、`docs/design/user-pc-ui-design-standard.md`、`docs/design/user-pc-ui-change-log.md`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：将后台和普通用户侧栏提示统一到共享 `.app-workspace-sidebar-tooltip` 根样式；后台桌面、移动“返回创作台”均改为 `/home`，桌面入口同步普通用户底部导航的 `34px` 行高、`16px` 图标、间距与折叠提示；前后台折叠状态通过同标签页自定义事件和跨标签页 `storage` 事件即时同步；普通用户 PC 外层移除左右 `6px` 留白，使两端主舞台尺寸一致；没有修改后台页面组件、查询、表格、权限、接口或数据。
- 验证结果：相关代码与文档通过定向 Prettier 检查，`tsc --noEmit` 通过；最终 Vite 生产构建通过（耗时 `4.86s`），仅保留项目既有的大分块提示。真实页面往返验证中，后台展开后返回 `/home`，前端立即保持 `224px`；前端折叠后进入 `/admin`，后台立即保持 `64px`。亮暗主题下分别覆盖 `1280 × 800`、`1440 × 900`、`1920 × 1080`，前后台内容舞台逐档同为 `1216px`、`1376px`、`1856px`，均无横向溢出；返回入口高 `34px`、图标 `16 × 16px`、链接 `/home`。预览只记录未修改的 Ant Design Drawer `width` 既有弃用提醒，没有新增本批运行错误。
- 潜在影响：后台返回创作台默认进入工作台首页而非画布；后台与普通用户侧栏折叠状态会即时共享；后台折叠提示根类名称改为产品级共享名称，但视觉值不变；后台业务页面、移动布局结构、路由表、权限和数据均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-093/` 按原相对路径恢复十个文件；修改前 SHA-256、当前校验值和安全步骤见该目录 `MANIFEST.md`。若只撤销后台集成，可在保留后续批次的前提下分别恢复 `admin-shell.tsx` 与共享 Tooltip 样式，并同步撤销共享状态订阅；恢复前先保留当前版本，不需要初始化、提交或使用 Git。

## 批次 094：后台页头当前位置层级统一

- 日期时间：2026-08-29 01:12 CST
- 目的：参照普通用户 PC 顶栏，将后台页头从孤立的大标题改为与侧栏层级一致的当前位置，降低页面切换时的认知成本。
- 修改前状况：后台主内容只显示“用户管理”等单页标题和说明，侧栏虽然已有“概览、平台资源、运营、系统配置”分组，但页头没有表达所属分组；管理员需要回看侧栏才能确认当前位置，前后台的信息层级语言也不一致。
- 涉及文件：`web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md`、`docs/design/admin-ui-change-log.md`。
- 具体改动：公共 `AdminPageFrame` 直接根据当前路径匹配 `adminNavigation`，统一渲染“分组 / 当前页面”；分组名称可返回该分组首个入口，当前页面继续作为唯一 `h1`，原说明保留在下一行，右侧业务操作和主题按钮不变。根概览路径使用精确匹配，其他入口支持子路由前缀，避免渠道模型等下钻页面错误归入“概览”。新增当前位置导航语义、键盘焦点反馈和亮暗主题自适应文字层级；PC 下分组为 `14px`、当前页为 `20px`，较窄界面同步收紧，不再使用孤立的 `22px` 大标题。
- 验证结果：目标组件、后台专属样式、设计规范、变更记录和回滚清单经 Prettier 格式化与检查；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建通过，共转换 `12696` 个模块，耗时约 `4.11s`，仅保留项目既有的大分块体积提示。完整 `pnpm run build` 首次尝试因当前命令环境缺少可执行 Bun 而未能启动既有 `build:bridge`，本批未修改桥接脚本，因此改用等价的全量 TypeScript 与 Vite 生产构建完成前端校验。真实已登录后台逐项检查 `/admin`、`/admin/users`、`/admin/logs` 和 `/admin/settings/features`，当前位置分别准确显示“概览 / 数据概览”“平台资源 / 用户管理”“运营 / 请求明细”“系统配置 / 功能开放”；根 `/admin` 使用精确匹配，没有吞掉其他后台路径。默认 PC 下分组为 `14px/600`、当前页为 `20px/650`，说明文字与当前位置左边缘对齐，页面只有一个 `h1`；显式 CSS 视口 `1278 × 900` 下侧栏保持 PC 展开态，页头和右侧主题按钮不重叠，文档横向溢出为 `0`。暗色主题下分组和说明使用可辨识的辅助文字色，当前页使用高对比主文字；四类路径映射、分组链接、浅色与暗色主题均正常。浏览器会话只保留两条早于本批、来自 Ant Drawer `width` 弃用的既有警告，没有发现本批新增运行错误。最终恢复默认视口、浅色主题、展开侧栏、用户管理入口和页面顶部，验收未触发任何业务保存或写接口。
- 潜在影响：所有使用 `AdminPageFrame` 的后台入口都会显示新的当前位置结构；页面标题、说明、操作、业务组件、接口、权限和路由均不改变。分组名称点击后会进入该分组第一个入口。
- 逐项回滚：从 `.local/ui-change-backups/batch-094/` 按原相对路径恢复 `web/src/pages/admin/components/admin-shell.tsx`、`web/src/styles/globals.css`、`docs/design/admin-ui-design-standard.md` 和 `docs/design/admin-ui-change-log.md`；修改前 SHA-256 与安全说明见 `.local/ui-change-backups/batch-094/MANIFEST.md`。只撤销页头显示时可仅恢复前两个代码与样式文件并追加回滚记录；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 117：普通用户 PC 全局框架与路由合同

- 日期时间：2026-08-29 21:40 CST
- 目的：为普通用户 PC 建立单一、类型安全的路由元数据源，统一路由注册、侧栏、顶部当前位置、快速搜索、文档标题、功能开关和页面框架模式；本批只建立合同与安全接线，不重写内容页、不修改后台页面或短剧页面。
- 修改前状况：用户路由在 `router.tsx`、`navigation-tools.ts`、侧栏、顶栏和命令面板中分别维护，功能开关过滤也各自重复；Eagle 子页顶部只按首段路径显示“插件中心”，快速搜索缺少插件中心，`/` 却跳到“创作”，与“首页”口径不一致；测试录音路由与正式用户路由同级，404 与异常页又通过 `/` 间接返回其他入口；“工作台管理”面包屑组名任意链到技能库；页面外壳没有 landing、collection/data、settings/form、immersive/detail 的显式模式合同。
- 涉及文件：`web/src/lib/user-route-manifest.ts`（新增）、`web/src/router.tsx`、`web/src/layouts/user-layout.tsx`、`web/src/components/layout/app-top-nav.tsx`、`web/src/components/layout/workspace-sidebar-nav.tsx`、`web/src/components/layout/workspace-top-bar.tsx`、`web/src/components/layout/workspace-command-palette.tsx`、`web/src/components/layout/workspace-page.tsx`、`web/src/components/auth/require-feature.tsx`、`web/src/constant/navigation-tools.ts`、`web/src/lib/workspace-routes.ts`、`web/src/pages/route-error.tsx`、`web/src/pages/not-found/index.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：新增受 `UserRouteId`、`UserRouteFeature`、`UserPageMode` 和分组类型约束的用户路由 manifest，集中定义路径、标题、图标、分组、登录保护、功能开关、导航/搜索可见性、激活父项和页面模式。路由表从 manifest 读取正式用户路径并通过同一 helper 应用登录与功能开关保护；`/` 统一到 `/home`，测试录音仅在 `import.meta.env.DEV` 下注册，生产依赖图不再包含该页。侧栏与快速搜索共用 manifest 的功能可用性判断，快速搜索补齐插件中心；Eagle 通过精确子路由显示“Eagle 素材库”并继续激活插件中心侧栏项。设置分区元数据补全 `runninghub` 与 `comfyui`，两者参与顶部标题和文档标题解析，但不重复加入固定侧栏。顶部当前位置直接读取路由分组，只有真实分组落地页才可返回，“工作台管理”改为不可点文本。`UserLayout`同步 `document.title`，用户外壳和 `WorkspacePage` 同时输出 `data-page-mode`/模式 class，建立 landing、collection、data、settings、form、immersive、detail 七类安全扩展点。`/create` 因具有专用对话、素材、模型与分镜工具栏，归类为 `immersive`，同时通过独立 `chrome: workspace` 和 `spatial: true` 元数据保留现有全局侧栏、顶栏与用户浮层合同；具体画布编辑器则继续隐藏全局 chrome。404 直接返回工作台首页，异常页按当前前台/后台边界返回对应首页。
- 验证结果：本批目标文件定向 Prettier 检查通过，全量 `tsc --noEmit` 为 0 错误；收尾补全隐藏设置元数据与 `/create` 模式后，Vite 生产构建再次成功转换 `12695` 个模块并在约 `4.18s` 完成，仅保留项目既有的大分块体积提示。完整 `pnpm run build` 因环境没有系统级 Bun，在既有 `build:bridge` 启动前停止，本批未修改该脚本，因此以已通过的全量 TypeScript 和 Vite 生产构建作为前端验收。真实 `http://127.0.0.1:3000/home` 在亮色与暗色主题下分别检查 `1280 × 800`、`1440 × 900`、`1920 × 1080` 六种组合：侧栏均为 `224px`、页面模式为 `landing`、横向溢出均为 `0`；快速搜索已显示“插件中心”，顶部显示“创作空间 / 首页”，文档标题为“首页 - 影策”；访问 `/` 真实落到 `/home`，未知路径显示“返回工作台首页”。当前验收浏览器为未登录会话，访问 `/plugins/eagle` 已正确进入登录保护；未执行任何业务写操作。控制台只观察到修改前已存在的匿名会话“请先登录”与 Ant Design `App component` 提示，没有本批新增运行错误。代码级复核确认 `section=runninghub` 与 `section=comfyui` 均能解析为原标题，且因 `navigation: false` 不会改变固定侧栏；`/create` 为 `immersive + workspace chrome + spatial overlays`，与改动前可见框架一致。
- 潜在影响：根路径从“创作”改为“工作台首页”，这与全局“首页”口径一致；“工作台管理”分组名不再可点，具体页面仍从侧栏和快速搜索进入。正式生产构建不再包含测试录音页的动态分块；开发环境仍可使用原路径。页面内容、路由参数、登录、权限、功能开关语义、API 和数据均保持兼容。
- 逐项回滚：修改前十三个原件、SHA-256、新建文件和安全恢复步骤位于 `.local/ui-change-backups/batch-117/MANIFEST.md`。回滚前先保留当前版本，按清单恢复原件并删除 `web/src/lib/user-route-manifest.ts`，再重新执行格式、类型、生产构建和真实 PC 页面复核；不需要初始化、提交或使用 Git。

## 批次 118：短剧项目列表语义与确定性状态

- 日期时间：2026-08-29 21:54 CST
- 目的：在批次 117 的 collection 页面合同内，修复普通用户 PC 短剧项目列表的空态判定、标题层级、卡片交互嵌套和前端分页范围表达；本批只处理列表页，不进入 URL/返回合同、创建入口降密度、归档只读、未保存保护或项目详情子页。
- 修改前状况：项目总数为 0 且没有搜索词、状态筛选时，列表分支不会渲染任何空状态；页面没有可见 `h1`；项目卡片使用整卡 `Link` 包裹删除按钮，形成嵌套交互元素；接口每页只读取 50 条，但搜索、状态筛选和排序直接作用于已加载数组，页面没有说明结果范围，容易被理解为全库结果；首屏加载错误与后续翻页错误也共用笼统状态判断。
- 涉及文件：`web/src/pages/projects/index.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：使用共享 `PageHeader` 建立唯一可见的“短剧项目”一级标题、说明、项目数量元信息和主要创建操作，并继续由批次 117 的 `collection` 模式承载页面。将列表状态明确拆为初始加载、初始加载失败、真实空列表、已加载范围内筛选无结果、已有数据列表和后续翻页失败；真实空列表不再依赖筛选条件，始终显示创建引导。卡片改为语义独立的 `article`，项目导航链接与删除按钮成为同级交互元素；导航链接补充明确名称和键盘焦点环，删除按钮保持独立可达且不再位于链接内部。保留现有每页 50 条接口与无限加载业务兼容：当服务端仍有未加载项目时，页面明确提示搜索、筛选和排序只作用于已加载项目，并显示已加载数、总数和剩余数；筛选空态也明确使用“已加载项目”口径。本批没有修改接口、查询参数、路由、共享框架、样式、后台、移动端或详情页。
- 验证结果：目标列表页经定向 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建成功转换 `12695` 个模块并完成产物生成，仅保留项目既有的大分块体积提示。真实已登录普通用户页面在空项目数据下确认：页面模式为 `collection`，可见 `h1` 恰好 1 个且标题为“短剧项目”，“创建第一个故事项目”空态稳定显示，加载和错误状态不与其重叠。亮色与暗色主题分别覆盖 `1280 × 800`、`1440 × 900`、`1920 × 1080` 六种 CSS 视口，三档内容区宽分别为 `1216px`、`1376px`、`1856px`，文档横向溢出均为 0；两个主题的前景与背景均正确切换。代码与运行 DOM 检查确认项目卡片不存在 `a button` 或 `button a` 嵌套；当前账号没有项目，因此卡片有数据、已加载范围筛选无结果、后续翻页失败分支以代码级确定性检查覆盖，未为验收创建项目或伪造接口响应。验收结束后恢复浅色主题与默认视口，没有点击删除、创建、生成或其他业务写入操作。
- 潜在影响：项目列表页首屏新增标准标题与主要创建操作；真实空列表现在会明确显示创建引导。已有项目超过 50 条时，页面会在继续加载前明确标注当前搜索、筛选和排序范围，因此结果表述更保守但业务行为不变。项目卡片的删除按钮不再继承整卡链接点击区域，键盘用户可分别聚焦“打开项目”和“删除项目”。服务端查询能力、每页 50 条、无限加载、删除确认和创建逻辑均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-118/` 按原相对路径恢复 `web/src/pages/projects/index.tsx` 与 `docs/design/admin-ui-change-log.md`；修改前与完成时 SHA-256、校验清单和安全步骤见该目录 `MANIFEST.md`。若只撤销列表实现并保留记录，可仅恢复 `index.tsx` 后追加回滚说明；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 119：短剧列表 URL 与返回上下文合同

- 日期时间：2026-08-29 22:03 CST
- 目的：让普通用户 PC 短剧项目列表的搜索、状态筛选和排序具备可刷新、可前进后退的稳定 URL，并让从列表进入项目详情后的顶部返回入口恢复原列表上下文；本批不处理创建入口密度、归档只读、未保存保护或详情子页内容重构。
- 修改前状况：列表虽然已经使用 `useSearchParams` 控制创建弹窗，但搜索词、状态和排序仍保存在组件本地状态，刷新或浏览器历史导航后会回到默认值；项目卡片只导航到详情路径，详情顶部返回按钮和错误态返回操作都无条件进入 `/projects`，会丢失列表上下文；详情视图切换也没有携带可验证的返回地址；页面没有针对外部或畸形返回参数的白名单边界。
- 涉及文件：`web/src/pages/projects/index.tsx`、`web/src/pages/projects/detail.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：列表以 URL 查询参数作为 `q`、`status`、`sort` 的单一状态源；搜索输入使用替换当前历史记录避免每个字符制造历史节点，状态与排序使用正常历史节点，重置一次清除三项。默认值 `status=all`、`sort=updated` 和空白 `q` 不写入 URL，已有冗余或非法状态、排序参数在读取时回退默认并用替换方式清理。项目卡片、创建完成和 AI 生成完成进入详情时，只有列表存在非默认查询条件才携带编码后的 `returnTo`；详情默认视图重定向、顶部五个视图链接、顶部返回按钮和项目不可用错误态返回操作共用同一安全上下文。详情只接受以单斜杠开头、解析后路径精确等于 `/projects`、没有哈希且参数仅为合法 `q/status/sort` 的返回地址；协议地址、协议相对地址、项目子路径、未知参数和非法枚举全部降级或被剔除，因此不能形成开放重定向。本批没有修改接口、路由 manifest、共享全局框架、样式、后台、移动端或 `detail/**` 子页。
- 验证结果：两个目标页面经定向 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建成功完成，耗时约 `4.35s`，仅保留项目既有的大分块体积提示。真实已登录普通用户页面通过 UI 输入“夜行”、选择“已归档”和“项目名称”后，地址稳定为 `/projects?q=夜行&status=archived&sort=name`；刷新后输入和两个选择项完整恢复。随后将状态改为“进行中”，浏览器后退恢复“已归档”及原 URL，前进恢复“进行中”及原 URL。访问空白 `q`、非法 `status/sort` 后地址被规范化为无冗余参数的 `/projects`。当前账号仍为 0 项目，遵循协调边界没有创建测试数据；详情返回使用只读的不存在项目错误页实际验证：安全 `returnTo=/projects?q=夜行&status=archived&sort=name` 返回后完整恢复列表 URL 和控件状态，外部 `https://evil.example/...` 返回参数点击后只进入当前应用 `/projects`。成功项目卡片生成详情 URL、详情顶部返回与五个视图链接的上下文传递完成代码级检查；未伪造项目、修改接口响应或触发创建、删除、生成等写入。`1440 × 900` CSS 视口下页面无横向溢出，验收结束后恢复浅色主题和默认视口。
- 潜在影响：复制列表 URL、刷新或使用浏览器历史时会保留当前搜索、状态和排序；搜索文字更新不会为每个按键堆积历史记录。带筛选的项目详情 URL 会新增一个编码后的 `returnTo` 参数，默认列表进入详情则保持原有简洁路径。详情返回参数会严格丢弃未知列表参数与默认枚举，因此不能借该参数返回创建弹窗、项目子页或外部站点。接口查询、每页 50 条和本地筛选范围语义保持批次 118 的行为。
- 逐项回滚：从 `.local/ui-change-backups/batch-119/` 按原相对路径恢复 `web/src/pages/projects/index.tsx`、`web/src/pages/projects/detail.tsx` 和 `docs/design/admin-ui-change-log.md`；修改前与完成时 SHA-256、校验清单和安全步骤见该目录 `MANIFEST.md`。若只撤销 URL/返回合同并保留记录，可恢复前两个页面文件后追加回滚说明；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 120：短剧创建入口降密度与可访问性

- 日期时间：2026-08-29 22:11 CST
- 目的：重排普通用户 PC `/projects` 顶部短剧创建区，把一句话故事建立为首要输入，将 AI 生成和手动创建整理为两条清楚但不互相争抢的路径，并把七项生成参数移入默认收起的渐进设置区；本批不进入归档只读、详情内容、接口或路由合同。
- 修改前状况：创建区顶栏同时平铺空白项目、导入小说、画风、模型、AI 生成和开始创作六个操作，故事输入下方又立即展示章节数量、结构、篇幅、字数、视角、基调和角色规模七项参数；来源、上下文、主要操作和高级参数处于相近视觉重量，一句话故事反而缺少清晰的输入标题与独立工作区域。粘贴文本只在弹窗来源中出现，顶栏两个来源与弹窗来源重复；生成参数没有展开语义。
- 涉及文件：`web/src/pages/projects/index.tsx`、`web/src/styles/user-pc.css`、`docs/design/admin-ui-change-log.md`。
- 具体改动：创建区标题下改为单一创作流程：顶部右侧只保留具名的“选择画风”和“选择文本模型”上下文控件；中部使用带可见标签的两行一句话故事输入作为主工作面；底部以主色“AI 生成章节”和次级“手动创建”明确区分 AI 与手动路径。原空白项目、导入小说和粘贴文本整合进“手动创建”具名菜单，选择后仍调用原 `openCreate`、原来源状态和原创建弹窗，没有删除功能。章节数量、叙事结构、章节篇幅、单章字数、叙述视角、故事基调和角色规模全部保留原状态、选项、默认值及生成请求使用方式，移入默认隐藏的“生成设置”区域；触发按钮显示 `5 章 · 单线推进 · 800 字/章` 摘要，并通过 `aria-expanded`、`aria-controls`、受控区域 `id`、`role=region` 与键盘焦点样式建立完整展开合同。新增样式全部位于 `user-pc.css` 的 `1024px` 以上媒体规则，并严格限定在 `.app-creator-workspace .library-page .app-story-create-*`；`1280px` 使用四列设置网格，`1440px` 及以上使用七列，不触及移动端或共享组件。
- 验证结果：目标页面、PC 样式和记录经定向 Prettier 格式化；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建成功完成，耗时约 `4.28s`，仅保留项目既有的大分块体积提示。真实已登录普通用户页面在亮色与暗色主题下分别覆盖 `1280 × 800`、`1440 × 900`、`1920 × 1080` 六种 CSS 视口：默认收起时创建面板统一高 `248px`，列表工具栏顶部为 `423px`，一句话输入高 `52px`；展开后 `1280px` 面板高 `394px`，`1440/1920px` 高 `330px`，七项设置均完整显示。六种组合在收起和展开状态下页面与面板横向溢出均为 0，亮暗主题表面、边界、文字和主次按钮层级清晰。键盘 `Enter` 展开后焦点保留在设置按钮，`aria-expanded=true` 且目标区域取消隐藏；`Space` 收起后恢复 `aria-expanded=false` 和隐藏状态。键盘打开“手动创建”菜单后完整呈现“空白项目、导入小说、粘贴文本”三个具名菜单项，按 Escape 关闭；展开区实页确认七项默认值依次为 `5 章、单线推进、均衡、800 字、第三人称、平稳叙事、3-4 个`。验收没有填写故事、选择菜单项、打开创建弹窗、点击 AI 生成或触发任何业务写入；结束后恢复浅色主题、默认视口和收起状态。
- 潜在影响：创建区默认首屏不再同时显示七项生成参数和三个来源快捷按钮，视觉扫描顺序变为故事输入、主路径、可选设置。手动来源需要先打开一个菜单，但三个选项的可见文字、键盘语义和原弹窗行为完整保留；AI 生成仍在故事为空时禁用。展开设置会让后续列表内容向下移动 `82–146px`，这是用户主动展开后的预期占用；收起时保留清晰摘要。接口请求、模型和画风选择、创建表单字段、默认数据、URL 查询合同、详情页和移动端均未改变。
- 逐项回滚：从 `.local/ui-change-backups/batch-120/` 按原相对路径恢复 `web/src/pages/projects/index.tsx`、`web/src/styles/user-pc.css` 和 `docs/design/admin-ui-change-log.md`；修改前与完成时 SHA-256、校验清单和安全步骤见该目录 `MANIFEST.md`。若只撤销创建区重排并保留记录，可恢复前两个实现文件后追加回滚说明；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 121：已归档短剧项目统一只读合同

- 日期时间：2026-08-29 22:31 CST
- 目的：将已归档项目详情收敛为统一只读状态，仅允许阅读和在项目设置中恢复项目，并在每个请求与直接副作用入口前统一阻断归档态写入；本批不处理未保存草稿保护或详情内容视觉重构。
- 修改前状况：项目外壳只对“新建画布”做了单点状态判断，顶部提示只说不能创建画布和生成任务；章节仍可编辑正文、创建、导入、删除、拖拽/定位排序、AI 提取角色和导入分镜；画布仍可关联/解除章节和解除项目；资产仍可加入、移出、分类、移动、建版本，文件夹可增改移删，候选角色可确认/归并，角色可增改、生成/绑图和绑定/解绑声音；基础设置和画风也仍可保存。多数写入只受可见按钮约束，直接调用 mutation 或旧 DOM 仍能发起请求。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/canvases.tsx`、`web/src/pages/projects/detail/assets.tsx`、`web/src/pages/projects/detail/settings.tsx`、`docs/design/admin-ui-change-log.md`。概览页没有写入入口，因此未修改 `detail/overview.tsx`；本批也没有修改样式文件。
- 具体改动：在项目域 `shared.tsx` 新增唯一的归档只读文案、状态判断、普通写入断言和状态转换断言；所有子页均从同一项目状态派生 `readOnly`。项目外壳在创建画布及章节关联链路的首个副作用前断言，“新建画布”同时原生禁用；归档提示改为“章节、画布、资产和设置均不可修改，仅恢复项目可用”。章节的 5 个 mutation 全部在 API 前断言，AI 角色提取和分镜导入/画布创建两条直接链路也在配置跳转、AI 请求、本地画布变更或远程同步前拦截；Tiptap 编辑器切换为不可编辑，标题、工具栏、创建/导入/删除/排序/生成/分镜操作都禁用并带准确提示。画布的 3 个关系 mutation 在请求前断言，关联下拉、解除章节和解除项目操作禁用。资产页的 17 个 mutation 共用同一守卫，角色生成与外部素材/图片导入在任何个人资产、远程同步或 AI 副作用之前拦截；顶部创建、文件夹菜单、候选确认、媒体资产操作与角色卡操作均禁用，阅读型资产预览与下载保留。设置保存在 API 前断言，基础字段与画风更换/编辑禁用，画风查看保留；状态 mutation 单独校验目标状态，已归档时只放行到 `active` 的恢复转换，延用原确认弹窗和 API。
- 验证结果：六个目标代码文件定向 Prettier 通过；全量 TypeScript `tsc --noEmit` 为 0 错误；Vite 生产构建成功转换 `12695` 个模块，耗时约 `4.10s`，仅保留项目既有的大分块体积提示。代码级统计与逐条上下文复核确认：章节 `5/5`、画布 `3/3`、资产 `17/17`、设置 `2/2` 个 mutation 均在请求之前经过统一守卫；项目外壳创建画布、章节 AI 提取、章节分镜导入和资产外部导入四类直接写链路也在首个副作用前断言，设置恢复为唯一例外。Chrome 已登录会话真实打开当前构建的 `/projects`，页面为 `collection` 合同、唯一 `h1` 为“短剧项目”，当前账号显示“共 0 个”和真实空态；因此没有可进入的归档项目。遵守协调边界，未创建项目、未归档项目、未调用写接口，归档详情的可见禁用态与恢复操作未做真实数据验证，以代码级全覆盖为验收边界。浏览器仅观察到改动前已存在的 Ant Design `App component` 配置警告与 `Modal maskClosable` 弃用警告，没有本批新增运行错误。
- 潜在影响：已归档项目的修改操作从“部分仍可执行”统一收紧为禁用，并在直接调用 mutation 时返回同一只读错误；这是本批的预期行为。已归档角色卡为防止内部复合操作组件漏出写入，整组交互控件由上层禁用，卡片上的摘要信息仍可阅读；媒体资产预览和下载继续可用，替换角色图片禁用。未归档项目的控件、路由、字段、请求参数和 API 均沿用原行为；本批没有修改列表页、概览页、全局框架、后台、移动端、服务接口或业务数据。
- 逐项回滚：从 `.local/ui-change-backups/batch-121/` 按原相对路径恢复六个项目详情代码文件和 `docs/design/admin-ui-change-log.md`；修改前与完成时 SHA-256、校验清单和安全步骤见该目录 `MANIFEST.md`。若只撤销归档只读合同并保留记录，可恢复六个代码文件后追加回滚说明；恢复前若文件已包含后续批次，应先复制当前版本，不需要初始化、提交或使用 Git。

## 批次 122：归档项目独立画布只读闭环与弹窗同步

- 日期时间：2026-08-29 22:58:11 +0800
- 目的：补齐批次 121 未覆盖的独立 `/canvas/:canvasId` 编辑器，使关联项目为 `archived` 时从详情入口和直接深链接进入均只能查看，阻断本地画布仓库、视口、远端同步、素材归档和生成写链路；同时处理归档状态动态切换时的写弹窗关闭，以及角色卡阅读预览与写操作的显式分离。本批不修改后台、移动端、服务 API、接口参数或业务数据。
- 修改前状况：项目概览“继续最近工作”和项目画布卡仍会进入完整画布编辑器，直接 `/canvas/:canvasId` 也只按本地画布加载，没有读取关联项目归档状态；节点、连接、视口和会话会自动写入本地仓库，显式保存会刷新本地持久化并触发远端同步，生成任务结果和拖入文件夹会继续归档项目素材，节点拖动、连线、删除、粘贴、上传、Agent、导演台、媒体处理和生成控件仍可操作。项目详情在 `readOnly` 从 `false` 变为 `true` 时不会主动关闭已打开的章节创建/导入、资产加入/文件夹/角色/图片/声音和画风选择弹窗。归档角色卡由上层 `fieldset disabled` 整卡禁用，封面和标题预览也失去正常阅读交互。
- 涉及文件：`web/src/pages/canvas/project.tsx`、`web/src/pages/canvas/use-canvas-project-lifecycle.ts`、`web/src/pages/canvas/use-canvas-keyboard.ts`、`web/src/pages/canvas/use-canvas-selection-controller.ts`、`web/src/pages/canvas/use-canvas-connection-controller.ts`、`web/src/pages/canvas/use-canvas-generation.ts`、`web/src/pages/canvas/use-canvas-generation-executor.ts`、`web/src/pages/canvas/use-canvas-generation-retry.ts`、`web/src/pages/canvas/use-canvas-storyboard.ts`、`web/src/pages/canvas/canvas-project-world-layers.tsx`、`web/src/pages/canvas/canvas-project-top-bar.tsx`、`web/src/pages/projects/detail/overview.tsx`、`web/src/pages/projects/detail/canvases.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/assets.tsx`、`web/src/pages/projects/detail/settings.tsx`、`web/src/pages/projects/detail/project-character-card.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：独立画布使用本地画布的 `projectId` 查询唯一关联项目；有关联项目而状态尚未返回时先采用安全写锁，查询确认 `active` 后解除，确认 `archived` 后维持统一只读。只读引用在所有状态 setter 外建立静默写屏障，生成直播适配器也使用同一屏障；项目生命周期在节点/连接/会话自动保存、500ms 视口延迟保存、卸载视口保存、重命名、删除、显式保存、本地 flush 和远端同步前检查同一引用，已排队的视口定时器执行时再次检查。生成恢复/结果应用/素材归档、普通生成、重试和分镜生成均在任务或归档副作用前检查；手动素材归档与第三方画布导入在首个副作用前检查。键盘阻断保存、撤销/重做、粘贴、删除和批量连线；选择控制器保留节点选择/预览但不进入拖动，连接控制器在批量提交、单连接、连线新建节点和连线起点前拦截；节点和背板收到显式 `readOnly`，节点内容区的表单控件同步禁用。顶部重命名、创建、删除、导入、撤销/重做、分享和 Agent 禁用并显示“只读”，画布写工具栏、选择工具栏、节点工具栏、右键菜单、素材托盘、活跃任务取消和 Agent 面板不渲染；拖放、双击新建、自动布局和项目侧栏写入口使用统一提示，写弹窗在状态切换时关闭且 `open` 条件同步受写锁控制，缩放、平移、搜索、媒体预览、回项目和小地图等阅读导航保留。概览和画布卡对归档项目显示“只读查看”语义。章节在转为只读时关闭创建/导入并清除排序、AI 和画布导入中的本地操作状态；资产关闭加入、文件夹、角色编辑、图片和声音写弹窗但保留预览；设置关闭画风选择/编辑弹窗。`ProjectCharacterCard` 新增显式 `readOnly`，封面、标题和纯阅读预览继续可点击，编辑、生成、绑定、移动和移出分别原生禁用并带统一说明，不再使用整卡 `fieldset`。
- 静态写链路覆盖：本地仓库覆盖自动节点/连接/会话保存、视口延迟/卸载保存、显式保存与 flush；远端覆盖显式 `saveRemoteUserDataNow`；项目素材覆盖手动文件夹投放、上传/生成结果的统一 setter 屏障及生成恢复的显式只读检查；交互覆盖节点/背板编辑、拖动、连线、删除、粘贴、上传/拖放、第三方导入、右键菜单、节点/选择/主工具栏、Agent、导演台、媒体/字幕/时间线/脚本/绘图/画风弹窗；生成覆盖普通生成、重试、批次所复用的普通生成入口、分镜文本/图片/视频确认入口和页面恢复任务。未归档项目仍使用原 setter、服务调用、API 参数和路由。
- 验证结果：十八个目标文件定向 Prettier 通过；全量 TypeScript `tsc --noEmit` 为 0 错误；使用项目完整 `npm run build` 链完成 Comfy Bridge、全量类型检查和 Vite 生产构建，转换 `12695` 个模块并成功生成产物，仅保留项目既有的大分块体积提示。真实 Chrome 已登录会话仍显示 `/projects`“共 0 个”，没有可合法进入的项目；遵守边界未创建、归档、恢复、保存、生成或调用写接口。安全页面覆盖在亮色/暗色及显式 `1280 × 800`、`1440 × 900`、`1920 × 1080` 浏览器视口进行：实际应用内容宽分别约为 `1024px`、`1152px`、`1536px`，三档 `scrollWidth` 均等于 `clientWidth`，无横向溢出；最终恢复浅色主题和默认视口。由于无项目，详情到画布、直接归档深链接、归档/未归档动态切换与写控件禁用没有真实数据验证，以上述代码级覆盖表、查询期间安全写锁和构建检查为验收边界。浏览器只观察到修改前已存在的 Ant Design `App component` 和 `Modal maskClosable` 警告，没有本批新增运行错误。
- 潜在影响：有关联项目的画布在项目状态查询完成前会短暂显示“正在确认项目状态”并禁用写入，以消除深链接加载竞态；查询失败时保持安全写锁，不会误开放编辑。已归档画布仍可平移、缩放、搜索、选择和预览，但不能改名、保存、同步、生成、上传、拖动、连线、删除、使用 Agent/导演台或改变项目素材。恢复项目后，下一次项目查询结果变为 `active` 即恢复原写行为。批次未修改服务端接口、请求参数、列表页、共享框架、后台或移动端。
- 逐项回滚：从 `.local/ui-change-backups/batch-122/` 按原相对路径恢复上述十七个代码文件与 `docs/design/admin-ui-change-log.md`；修改前 SHA-256、完成 SHA-256 与清单自校验见该目录 `MANIFEST.md` 和 `MANIFEST.sha256`。若只回滚画布闭环，恢复十一份 `canvas` 文件；若只回滚详情 QA，恢复概览、画布、章节、资产、设置和角色卡六份文件；若完整回滚，最后恢复台账。恢复前若文件包含后续批次，先复制当前版本；不需要初始化、提交或使用 Git，也不要修改 batch-121。

## 批次 123：归档画布可信状态与异步副作用收口

- 日期时间：2026-08-29 23:24:29 +0800
- 目的：修复批次 122 独立 QA 指出的旧 active 查询缓存 fail-open、命令式确认框缺少最终提交守卫和长异步链只检查入口的问题；同时恢复只读画布已有图片的安全下载，并让第三方导入、Agent 与分享使用一致的原生禁用及归档原因。本批不修改 batch-122、后台、移动端、服务接口、请求参数或业务数据。
- 修改前状况：`/canvas/:canvasId` 直接使用 React Query 的 `data` 判断项目状态，30 秒缓存中的旧 active 数据或重查失败仍保留的旧数据会立即解除写锁；恢复后的状态刷新也可能受旧 archived 缓存影响。取消生成、方舟素材上传和分镜生成的 `modal.confirm` 只在打开前检查只读，已打开确认框的 `onOk` 仍能写。上传、生成、导演台、Agent、画风、短剧及媒体处理链多数只在同步入口检查，文件选择器或关键 `await` 返回后未再次读取实时锁。只读批次图片的下载与写操作一起被隐藏；“导入第三方画布”的子菜单虽然禁用，触发按钮本身仍可打开；紧凑 Agent 入口没有只读禁用语义。
- 涉及文件：`web/src/pages/canvas/project.tsx`、`web/src/pages/canvas/use-canvas-generation-executor.ts`、`web/src/pages/canvas/use-canvas-upload.ts`、`web/src/pages/canvas/use-canvas-director.ts`、`web/src/pages/canvas/use-canvas-agent-operations.ts`、`web/src/pages/canvas/use-canvas-storyboard.ts`、`web/src/pages/canvas/use-canvas-style-workflow.ts`、`web/src/pages/canvas/use-canvas-short-drama.ts`、`web/src/pages/canvas/use-canvas-media-tools.ts`、`web/src/pages/canvas/use-canvas-generation.ts`、`web/src/pages/canvas/use-canvas-generation-retry.ts`、`web/src/pages/canvas/canvas-project-top-bar.tsx`、`web/src/components/canvas/canvas-node.tsx`、`docs/design/admin-ui-change-log.md`。`use-canvas-style-workflow.ts` 与 `use-canvas-short-drama.ts` 仅增加同一实时只读入口；没有修改样式文件。
- 具体改动：关联项目查询改为禁用自动消费缓存，挂载、关联项目切换和窗口重新聚焦时显式执行可信网络 `refetch`；每次确认先清空可信状态，使用递增请求标识丢弃过期响应，只有当前请求成功返回同一项目 ID 且明确为 active 才解除写锁。查询中、失败、旧缓存、响应错配均 fail closed；恢复项目后重新进入画布或回到窗口即可触发新确认，不轮询、不产生无限查询。只读切换时统一销毁命令式确认框并中止可取消的生成请求、恢复消费者和恢复协调器；取消任务、方舟上传和分镜确认的 `onOk` 在最终写入前再次读锁，方舟上传在 `uploadImage` 返回后及同步方舟前继续复核。上传 hook 接收实时锁，文件选择器返回、逐文件上传、节点替换、时间线媒体、合成结果、素材载荷与项目资产插入均在远端调用和本地节点写入前后复核。普通生成、重试、分镜任务、生成结果/素材归档在关键上下文解析、任务提交、等待结果和结果写回处复核；锁定时中止本地控制器。导演台在创建、缺失场景补建、保存、图片/白膜上传和 refs/store 写入前复核；Agent 在应用操作、直接 refs 写入、生成续接持久化和撤销前复核；画风 mutation 与短剧流水线/画风步骤也使用同一锁。媒体快捷链覆盖裁剪、标注、尾帧、音频提取、视频截取/重生成、合并、切图、蒙版、超分、角度与表情，关键媒体处理返回后、上传/任务提交前后和 refs 写入前均复核。素材交接与肖像候选上传补充异步返回守卫。只读批次子图保留“下载图片”，批次主图保留“下载主图”，副本、设主图、重试与删除仍不渲染；第三方导入触发按钮、普通/紧凑 Agent 和分享采用原生 disabled、统一提示与包含归档原因的可访问名称，键盘无法打开全禁用菜单。
- 静态副作用覆盖：可信状态为“缓存 active：锁定、重新确认中：锁定、查询失败且保留旧数据：锁定、当前成功 archived：锁定、当前成功 active：解锁”；命令式确认覆盖取消任务、方舟同步与分镜批量生成；远端写覆盖生成任务提交/取消、图片/音视频上传、项目素材归档、方舟同步、项目画风 mutation 和导演场景持久化；本地写覆盖节点/连接 refs、Agent 快照与续接、短剧流水线、媒体结果节点和项目 handoff。可取消生成在只读切换时 abort；无法取消的媒体上传在每个下一项不可逆副作用前重新读实时锁并停止后续写入。
- 验证结果：十三个实际修改代码文件定向 Prettier 通过；全量 TypeScript `npx tsc --noEmit` 为 0 错误；完整 `npm run build` 通过 Comfy Bridge、全量类型检查和 Vite 生产构建，转换 `12695` 个模块，仅保留既有大分块提示。真实 Chrome 已登录会话仍为 0 项目，遵守边界未创建、归档、恢复、保存、上传、生成或触发其他写接口。安全浏览器覆盖 `/projects` 的亮暗主题与请求视口 `1280 × 900`、`1440 × 900`、`1920 × 900`；Chrome 扩展缩放后的实际 CSS 视口为 `1024/1152/1536px`，三档均显示唯一可见 `h1`“短剧项目”和“创建第一个故事项目”真实空态，`scrollWidth === clientWidth`，无横向溢出。结束后恢复浅色主题、默认视口并关闭测试页。控制台仅有既存 Ant Design `App cssVar component` 与 `Modal maskClosable` 警告。由于无项目，归档/恢复动态切换、详情到画布、深链接及下载按钮未做真实数据操作，以静态副作用表、类型检查和生产构建为验收边界。
- 潜在影响：关联项目画布不再信任 React Query 旧缓存；每次挂载或窗口重新聚焦会执行一次只读项目状态请求，确认期间写控件保持锁定，网络失败不会开放编辑。不可取消的外部上传若在服务端归档发生前已经提交，客户端无法撤回已发出的单次请求，但其后本地 refs、素材同步、下一段上传和生成提交均会被实时锁阻断；这是当前 API 不提供统一取消信号下的残余边界。未归档项目经可信 active 确认后沿用原功能、接口与参数；个人未关联画布不增加项目查询。
- 逐项回滚：从 `.local/ui-change-backups/batch-123/` 按原相对路径恢复上述十三个实际修改代码文件与 `docs/design/admin-ui-change-log.md`；若只回滚可信查询与确认框，恢复 `project.tsx`；若只回滚长异步守卫，恢复十个 `use-canvas-*` 文件；若只回滚下载/顶栏语义，恢复 `canvas-node.tsx` 与 `canvas-project-top-bar.tsx`；完整回滚最后恢复台账。`MANIFEST.md` 记录修改前与完成 SHA-256，`MANIFEST.sha256` 同时覆盖清单本身和全部十四份备份载荷，可在 batch-123 目录用一条 `shasum -a 256 -c MANIFEST.sha256` 完整校验。恢复前若文件包含后续批次，先复制当前版本；不依赖 Git，也不要修改 batch-122。

## 批次 124：关联项目 active-only 解锁与只读阅读收口

- 日期时间：2026-08-29 23:40:00 +0800
- 目的：修复批次 123 第二轮 QA 指出的关联项目未知状态 fail-open，为三类分镜生成确认建立可定向销毁且必定结算的 Promise 生命周期，并允许归档画布以非持久方式展开/收起图片批次进行阅读和下载。本批不修改 batch-123、后台、移动端、服务接口、请求参数或业务数据。
- 修改前状况：画布虽然要求本次可信查询与关联项目 ID 匹配，但解锁条件只排除 `archived`，API 返回 `deleted`、`suspended`、空字符串或未来状态时仍可编辑。分镜确认 Promise 依赖全局 `Modal.destroyAll()` 间接期待 `onCancel`，既可能关闭无关弹窗，也无法保证命令式弹窗销毁后 Promise 已结算。归档只读下的图片批次展开使用原 `toggleBatchExpanded`，会更改节点元数据并进入画布持久化，因此被整体禁用，子图下载也无法进入。
- 涉及文件：`web/src/pages/canvas/project.tsx`、`web/src/pages/canvas/use-canvas-storyboard.ts`、`web/src/components/canvas/canvas-node.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：关联项目画布的解锁条件收紧为“本次可信查询成功、响应项目 ID 与当前关联 ID 一致、且 `status === \"active\"`”；查询中、错误、缺失、过期/错配响应、`archived`、`deleted`、`suspended`、空值与未来状态统一 fail closed。无 `projectId` 的自由画布不查询也不增加写锁；恢复后下一次可信 active 响应可正常解锁，保留请求代次与 ID 校验，没有新增轮询。三类分镜生成共用确认函数现为每个弹窗保存独立 `destroy` 和幂等 `settle`；`onOk`、`onCancel`、`afterClose`、切换只读和 hook 卸载均会定向结算，只读切换显式 `resolve(false)` 后销毁本 hook 的确认框，不再调用全局 `Modal.destroyAll()`，`onOk` 仍即时读取锁并拒绝提交。只读批次展开状态改为页面内 `Map`，仅派生传入渲染层的节点视图，不调用 `setNodes`、不改 refs/store 也不触发保存；未归档仍走原持久分支。批次开关补充“展开图片组/收起图片组”可访问名称和 `aria-expanded`，展开后主图/子图下载保留，副本、设主图、重试、删除等写操作仍不渲染。
- 静态证明：有关联项目时，唯一解锁布尔值为 `confirmed id === linked id && status === \"active\" && !isFetching && !isError`，其余统一以 `Boolean(linkedProjectId) && !linkedProjectConfirmedActive` 持锁；无关联项目时该表达式为 `false`。分镜确认集合在创建时登记，结算函数用 `settled` 防止重入，每条关闭路径都会删除自身，只读和卸载再清空集合，不会积累悬挂 Promise。只读展开分支只更新 `readOnlyBatchExpansionOverrides`，`canvasRenderNodes` 仅是渲染派生值；原 `toggleBatchExpanded`仅在未锁定分支调用。
- 验证结果：三个目标代码文件定向 Prettier 通过；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建通过，耗时约 `4.13s`，仅保留项目既有的大分块体积提示。完整 `npm run build` 首次尝试因当前命令环境没有可执行 Bun，未启动既有 `build:bridge`；本批不修改 Bridge，改用全量 TypeScript 和生产 Vite 完成前端校验。当前账号延续为 0 项目，遵守边界未创建、归档、恢复、保存、生成或触发写接口；active/unknown/unlinked、confirm 结算和批次非持久展开以上述静态覆盖为验收边界。
- 潜在影响：有关联项目的画布现在会对所有非 active 和未知状态保持写锁，这是本批预期的安全收紧；无关联项目和可信 active 项目保持原行为。只读批次的展开状态在关联项目或写锁状态变化时重置，不会跨刷新保存，这是为避免修改归档项目数据的预期阅读语义。由于当前无真实项目，未进行归档/恢复动态、真实弹窗和子图下载的有数据浏览器验证。
- 逐项回滚：从 `.local/ui-change-backups/batch-124/` 按原相对路径恢复 `web/src/pages/canvas/project.tsx`、`web/src/pages/canvas/use-canvas-storyboard.ts`、`web/src/components/canvas/canvas-node.tsx` 和 `docs/design/admin-ui-change-log.md`。若只回滚 active-only 解锁与临时批次阅读，恢复 `project.tsx`；若只回滚确认框生命周期，恢复 `use-canvas-storyboard.ts`；若只回滚批次按钮的可访问语义，恢复 `canvas-node.tsx`；完整回滚最后恢复台账。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256；`MANIFEST.sha256` 同时覆盖清单本身和全部四份备份载荷，可在 batch-124 目录用单条 `shasum -a 256 -c MANIFEST.sha256` 完整校验。恢复前若文件已包含后续批次，先复制当前版本；不依赖 Git，也不修改 batch-123。

## 批次 125：画布命令式确认框卸载清理收口

- 日期时间：2026-08-29 23:50:16 +0800
- 目的：修复终验剩余 P1，为画布页的“取消生成任务”和“上传到方舟素材库”两类命令式 `modal.confirm` 增加页面卸载清理，防止离开画布后旧确认框继续触发远程写入。本批不修改 batch-124 及更早批次，不修改 active-only、storyboard、批次下载、后台、移动端、接口或其他业务逻辑。
- 修改前状况：两类确认框已将各自 `destroy` 登记到页面集合，且 `onOk` 已在 `cancelGenerationTask`、`uploadImage` 和 `syncResourceToArkPrivateAsset` 前读取实时只读锁；但原 effect 只在 `projectWriteLocked` 转为 `true` 时销毁集合，页面在 active 状态下直接卸载时没有 cleanup，旧弹窗可能留到画布之外。
- 涉及文件：`web/src/pages/canvas/project.tsx`、`docs/design/admin-ui-change-log.md`。
- 具体改动：抽取页面域 `destroyWriteConfirmations`，先快照当前登记的销毁函数并立即清空集合，再逐个定向执行 `destroy()`，使重复调用为空操作，且 `afterClose` 的延后回调不会干扰新集合。原“动态转为只读” effect 复用该定向函数。新增一个不依赖 `projectWriteLocked` 的 mount/unmount-only effect：cleanup 先将 `projectReadOnlyRef.current` 置为 `true`，再调用定向销毁，保证销毁动画或残留 `onOk` 读到已锁定状态。未使用 `Modal.destroyAll()`，不会关闭上层或其他模块弹窗；两类 `onOk` 原有实时二次守卫保持不变。
- StrictMode 与卸载顺序证明：新 effect 的依赖仅是引用稳定的销毁函数，不因项目锁切换或渲染重跑；真实卸载执行“实时锁 `true` → 集合清空 → 定向 destroy”。React StrictMode 开发态模拟 cleanup 后会立即再次执行 setup；setup 从独立的 `renderedProjectWriteLockedRef` 恢复最新渲染锁值，因此不会让 active 或无关联项目画布永久锁定。模拟 cleanup 与后续重复 cleanup 均因集合已先清空而幂等；新组件实例使用自己的 ref 集合，不会被旧实例误伤。
- 验证结果：`project.tsx` 定向 Prettier 通过；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建通过，耗时约 `4.04s`，仅保留项目既有大分块体积提示。静态检索确认没有 `Modal.destroyAll`，取消任务和方舟上传 `onOk` 仍在首个远程副作用前调用 `isCanvasReadOnly()`；方舟上传在 `uploadImage` 返回后和 `syncResourceToArkPrivateAsset` 前继续复核。当前账号为 0 项目，遵守边界未创建项目或触发取消、上传、同步等写入，以静态生命周期覆盖为验收边界。
- 潜在影响：只有当前画布页已登记的两类命令式确认框会在页面卸载时被关闭；其他页面、上层与其他模块弹窗不受影响。若用户已在卸载前确认且远程请求已实际发出，客户端无法追溯撤回该请求；本批保证的是卸载锁定后旧弹窗不能新触发这些副作用。
- 逐项回滚：从 `.local/ui-change-backups/batch-125/` 按原相对路径恢复 `web/src/pages/canvas/project.tsx` 与 `docs/design/admin-ui-change-log.md`。若只撤销卸载清理并保留台账，仅恢复 `project.tsx` 后追加回滚记录；完整回滚最后恢复台账。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256；`MANIFEST.sha256` 同时覆盖清单和全部两份备份载荷，可在 batch-125 目录用单条 `shasum -a 256 -c MANIFEST.sha256` 校验。恢复前若文件已包含后续批次，先复制当前版本；不依赖 Git，也不修改 batch-124。

## 批次 126：短剧项目详情未保存内容保护

- 日期时间：2026-08-30 00:07:29 +0800
- 目的：为普通用户 PC 短剧项目详情的章节编辑与项目设置建立统一的未保存内容保护；覆盖详情标签、顶部返回、浏览器后退、章节切换、刷新和关闭页面，同时保持既有 API 参数、`returnTo`、路由结构及归档只读闭环不变。本批不修改后台、移动端、业务接口或视觉框架。
- 修改前状况：章节编辑只用一次性布尔值记录“输入过”，无法在用户改回服务器内容时恢复干净状态；保存成功没有以实际提交快照更新基线，章节切换只显示“请先保存”且没有可选择的放弃流程，详情标签、顶部返回、浏览器历史、刷新和关闭均可直接丢失草稿。项目设置没有 dirty 状态，服务器查询刷新可能覆盖本地输入，切换视图或归档时也没有保护；归档操作与未保存字段共处一页，缺少明确的“先保存或放弃”边界。详情外壳没有统一导航拦截，若分别补丁容易叠加多个确认框。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/settings.tsx`、`docs/design/admin-ui-change-log.md`。没有修改样式、路由 manifest、其他详情子页、列表页、后台、移动端或服务接口。
- 具体改动：在项目详情域新增单实例 `ProjectDirtyNavigationBoundary` 与 `useProjectDirtyNavigation` 合同，当前活动子页只登记一份 dirty 描述、放弃回调和基线恢复动作；React Router blocker 仅在 dirty 且目标 URL 实际变化时工作，确认框使用明确标题、草稿说明、“保留修改”和“放弃修改并继续”按钮，取消按钮默认聚焦并在关闭后恢复触发点。保留操作只复位 blocker 并留在原页；放弃操作先同步解除登记、恢复当前草稿基线，再只执行一次原导航或章节切换，避免重复拦截、历史栈污染和内容闪失。`beforeunload` 监听只在 dirty 时注册，干净或卸载后移除。章节以当前章节 ID、标题、规范化编辑器正文和服务器版本建立已保存基线；标题使用与原保存参数一致的 trim 语义，正文按 TipTap 实际 HTML 比较，改回原值立即恢复干净。脏草稿期间同章节重查不会覆盖输入；保存使用发起请求时的提交快照，成功后以该快照更新基线，保存过程中继续输入仍保持 dirty，失败不推进基线。原章节切换提示整合进同一确认合同，不再叠加弹窗；归档转只读时保留草稿、停止编辑并显示统一警告，不静默清空。项目设置把名称、简介、画幅、来源、画风预设和画风配置全部纳入服务器基线；同项目重查只在干净时同步，脏草稿不会被外部刷新覆盖。保存成功推进提交快照基线，失败保留 dirty；归档/恢复 mutation 增加命令式 dirty 守卫，dirty 时必须先保存或明确放弃，放弃后仅沿用原 `{ status }` 请求，不夹带任何未保存字段。
- 静态状态转移覆盖：`草稿 === 基线` 时不拦截且不注册 `beforeunload`；任一受管字段变化后进入 dirty，详情链接、返回、浏览器路由和章节切换进入同一确认；选择“保留修改”后 URL、章节、内容和焦点保持，选择“放弃”先恢复基线再完成一次目标动作。保存成功且期间无新编辑时解除 dirty；保存请求期间发生新编辑时，新基线为已提交快照而后续输入仍 dirty；保存失败基线不变。服务器重查遇 dirty 不覆盖草稿；归档转只读保留草稿并提示。设置 dirty 时归档/恢复不会发状态请求，明确放弃后才打开原状态确认，最终请求仍只有状态字段。
- 验证结果：四个代码文件和台账经定向 Prettier 检查；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，最终复验耗时约 `4.47s`，仅保留项目既有的大分块体积提示。代码级检索确认项目详情只有共享 boundary 使用 `useBlocker`，`beforeunload` 只在 dirty effect 中增删，章节内部切换和设置状态操作均复用共享确认。真实 Chrome 已登录页面安全打开 `/projects`，唯一可见 `h1` 为“短剧项目”，账号显示“共 0 个”和“创建第一个故事项目”真实空态；遵守边界未创建项目、未进入不存在的详情、未保存、归档、恢复或调用其他写接口。由于没有真实项目，dirty 弹窗、详情往返和归档动态切换以上述静态状态表、类型检查和生产构建为验收边界；浏览器控制台只保留既有 Ant Design 配置与旧式 Modal 警告，本批受控确认框使用当前 `mask` 配置。
- 潜在影响：有未保存内容时，项目详情内导航和浏览器离开将新增一次明确确认；无 dirty 时完全沿用原导航与历史行为。浏览器原生刷新/关闭提示文字由浏览器决定，应用只在 dirty 时请求拦截。已经在用户导航前发出的保存请求不具备服务端取消接口，客户端不能撤回已提交请求；但保存回调以提交快照推进基线，不会把请求期间的后续输入误判为已保存。当前详情一次只渲染一个子页，因此共享合同只维护一个活动登记；未来若改为同时挂载多个可编辑子页，需要把登记模型升级为多草稿聚合。
- 逐项回滚：从 `.local/ui-change-backups/batch-126/` 按原相对路径恢复四个项目详情代码文件与 `docs/design/admin-ui-change-log.md`。若只撤销外壳合同，恢复 `detail.tsx` 与 `detail/shared.tsx`；若只撤销章节保护，恢复 `detail/chapters.tsx`；若只撤销设置保护，恢复 `detail/settings.tsx`；完整回滚最后恢复台账。恢复前若目标文件含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 同时覆盖清单本身和全部五份备份载荷，可在 batch-126 目录用一条 `shasum -a 256 -c MANIFEST.sha256` 完整校验；不依赖 Git，也不要修改旧批次。

## 批次 127：章节切换副作用前置确认与设置基线规范化

- 日期时间：2026-08-30 00:21:35 +0800
- 目的：最小修复批次 126 终验发现的章节创建/导入/删除时序旁路，并使项目设置 dirty 判断与服务端规范化及返回项目保持一致；本批不修改共享 dirty 合同、后台、移动端、接口、路由或视觉框架。
- 修改前状况：新建章节和导入小说会先发送写请求，成功后立即 `setSelectedId`，其触发的编辑器重载可能在统一导航确认完成前把 dirty 变为 false；用户即使选择“保留修改”，远端章节已经产生且当前草稿可能丢失。删除当前 dirty 章节仍先走独立删除 Popconfirm，成功后切换章节，没有与未保存保护整合。已有分镜的“导入画布”在 dirty 时仍能先写本地/远端画布再导航。设置页仅对名称 trim，简介、枚举和画风 ID 按原字符串比较；`styleProfileJson` 直接比较文本，等价 JSON 的对象键顺序或空白差异会形成假 dirty。保存成功只使用提交快照，没有采用服务端实际返回的 trim/校验结果同步基线与表单。
- 涉及文件：`web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/settings.tsx`、`docs/design/admin-ui-change-log.md`。检查后确认 `detail/shared.tsx` 无需修改；旧批次、其他详情子页、服务端和移动端均未改动。
- 具体改动：章节创建和小说导入的两个打开入口与两个最终提交入口均复用现有 `requestDiscard`；dirty 时先显示唯一统一确认，选择“保留修改”不打开或不提交、不调用 mutation、不改变 `selectedId`、不清理编辑器，明确放弃并同步恢复保存基线后才继续原 mutation。创建/导入成功回调保留原选中新章节、刷新与导航逻辑，但其远端副作用现在必然位于确认之后，因此不会产生“创建成功却因后置确认取消而不可见”的章节。删除非当前章节或当前 clean 章节沿用原 Popconfirm；删除当前 dirty 章节不叠加 Popconfirm，直接使用一份带“放弃修改并删除”语义的统一确认，保留则不删除，放弃后才调用原删除 mutation。系统性检索全部 `setSelectedId`：详情数据同步与 URL 同步均已有 `!dirty` 条件；列表选择继续使用统一确认；创建、导入、删除成功回调都有本批前置许可。AI 角色提取与“在画布中分镜”原本已在 dirty 时禁用并在调用层复核；另将已有历史分镜的导入下拉和触发按钮同步在 dirty 时禁用，避免先写画布再触发路由确认。
- 设置规范化：新增页面内稳定指纹函数。名称、简介、画幅、来源和画风 ID 都用与服务端 `strings.TrimSpace` 一致的值比较，运行时 `undefined`、`null` 和空字符串统一为空值。`styleProfileJson` 先 trim；合法 JSON 递归按确定性键顺序序列化对象、保留数组顺序后比较，因此嵌套对象字段顺序和排版不制造 dirty；非法 JSON 捕获后以 trim 后原文作为独立指纹，页面不崩溃、输入仍可编辑且相对有效基线保持 dirty。保存参数仍是原七个业务字段，只将服务端本来会 trim 的字符串在提交前做同等规范化，不重排或重写用户 JSON。保存成功以 API 返回的 `project` 构造真实基线并同步表单；若请求期间某字段被继续编辑，只同步仍等于提交快照的字段，保留并继续标记并发编辑内容。
- 状态转移证明：dirty 章节点击新建/导入时，`requestDiscard` 在任何 mutation 前分叉；保留路径无远端调用、无 `setSelectedId`、无编辑器重载，放弃路径先结算统一确认再进入原 clean mutation。创建/导入弹窗若在 clean 时已打开，最终提交入口仍执行相同 guard，避免状态变化旁路；由于首次放弃已恢复基线，正常流程不会出现第二次确认。删除当前 dirty 章节只有统一确认一层；其余删除只有原删除确认一层。设置 `undefined/null/""` 指纹相同，`{"a":1,"b":{"x":2}}` 与递归换序对象指纹相同，数组换序不同，非法 JSON 不抛异常且不同原文指纹不同；保存响应成为新基线，响应规范化与提交值的差异不会留下假 dirty，保存期间新增输入仍 dirty。
- 验证结果：两个代码文件定向 Prettier 通过；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，耗时约 `3.96s`，仅保留项目既有的大分块体积提示。静态检索确认创建、导入和当前 dirty 删除的 mutation 均只在统一许可回调中触发；所有六处 `setSelectedId` 分别属于 clean 数据同步、clean URL 同步、已获许可的创建/导入/删除成功回调和统一选择回调，没有未确认旁路。当前账号为 0 项目，遵守边界未创建章节、导入小说、删除、保存、归档、生成或触发任何业务写接口，以静态状态转移、类型检查和生产构建作为有数据交互验收边界。
- 潜在影响：dirty 时点击新建或导入会先要求处理当前草稿，选择保留不会再进入对应弹窗；当前 dirty 章节的删除从“删除确认后再丢草稿”收敛为一份同时说明两种损失的确认。已有分镜导入在 dirty 时必须先保存或通过其他导航动作明确放弃。设置页只忽略服务端本来也会移除的首尾空白以及合法 JSON 的对象键顺序，不忽略数组顺序或非法 JSON 内容变化。未归档 clean 流程、请求字段、返回路由和归档只读合同保持不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-127/` 按原相对路径恢复 `web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/settings.tsx` 与 `docs/design/admin-ui-change-log.md`。若只回滚 P1，恢复 `chapters.tsx`；若只回滚 P2，恢复 `settings.tsx`；完整回滚最后恢复台账。恢复前若文件已包含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 同时覆盖清单和三份备份载荷，可在 batch-127 目录用一条 `shasum -a 256 -c MANIFEST.sha256` 完整校验；不依赖 Git，也不要修改旧批次。

## 批次 128：详情画布动作前置许可与分镜异步实时守卫

- 日期时间：2026-08-30 00:30:38 +0800
- 目的：完成短剧项目详情未保存保护的最后一条“先写后导航”闭环，使顶栏新建画布和章节历史分镜导入在任何本地或远端副作用前取得当前活动子页的统一 dirty 许可，并避免成功导航再次弹窗。本批不修改后台、移动端、API 参数、`returnTo`、路由结构或归档只读合同。
- 修改前状况：详情顶栏“新建画布”由 dirty boundary 外层组件直接执行 `createCanvasProjectWithRemoteSync`，必要时继续 `linkCanvasUnit`，直到 `navigate` 才由路由 blocker 发现未保存内容；选择保留时画布已经产生。章节已有历史分镜导入虽然按钮在 batch-127 中对 dirty 禁用，但 handler 本身没有统一许可或实时 dirty 检查，旧菜单事件、延迟回调或直接调用仍可先更新本地 store、远端保存、创建画布及关联章节。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`docs/design/admin-ui-change-log.md`。系统扫描详情外壳及各子页的写入后导航链，除顶栏创建与章节分镜导入外没有同合同的新旁路；未修改其他详情子页。
- 具体改动：dirty boundary 新增只读 context action hook `useProjectDirtyActions`，向 Provider 内的外壳公开同一个 `requestDiscard` 能力并命名为 `requestDiscardBeforeAction`；没有改变现有活动子页登记、Router blocker、`beforeunload` 或确认框实现。详情页拆成极薄 boundary 外层与 Provider 内内容组件，使顶栏和传给概览、章节、画布、资产、设置子页的 `onCreateCanvas` 都先提交受保护 action。clean 时 action 立即执行且无额外弹窗；dirty 时“保留修改”只关闭确认，不调用创建、章节关联或导航；明确放弃时 boundary 先同步把活动登记改为 clean、执行子页基线恢复，再只调用一次原创建链。其后的 `/canvas/:id` 导航读取同一 clean ref，既不二次确认也不添加额外历史节点。原归档断言、按钮原生 disabled、提示和可访问名称保持不变，创建标题、画布种子、API 参数、同步错误分支与 `returnTo` 均未改变。
- 分镜异步守卫：`chapters.tsx` 为 dirty 增加实时 ref，统一放弃回调在恢复标题/正文前同步将其置为 clean。公开的 `importStoryboardToCanvas` 入口第一层只调用 `requestDiscard`；保留路径不设置 loading、不读取或写入画布 store、不远端保存、不创建画布、不关联章节且不导航。许可回调先再次读取 dirty ref，再获取唯一运行代次并设置同步运行锁，快速重复或旧菜单事件不能启动第二条链。实际异步链在开始、现有画布本地 `updateProject` 前、远端 `saveRemoteUserDataNow` 前后、新画布 `createCanvasProjectWithRemoteSync` 前后、`linkCanvasUnit` 前后及最终导航前逐次校验运行代次、项目可写状态和实时 dirty；中途出现新的未保存修改或失效代次即停止剩余副作用并给出错误，不进入后置路由确认。无章节、无分镜、只读拒绝及异常返回也通过 Promise `finally` 释放同步运行锁，不会永久占用导入状态。
- 状态转移证明：顶栏 action 为 `clean → 直接创建一次`、`dirty + 保留 → 0 创建/0 关联/0 导航`、`dirty + 放弃 → 同步 clean/恢复草稿 → 创建一次 → 可选关联一次 → 导航一次`；导航时 blocker 使用已同步更新的 registration ref，因此不重复确认。分镜入口为 `dirty → 统一确认`，只有许可回调能分配 runId；运行锁确保同一时刻最多一条链，`assertImportAllowed` 要求 runId 仍为当前代次、项目仍可写、dirty ref 为 false。初始 dirty 的保留路径在 `setImportingCanvasId` 之前结束；放弃路径各关键 await 后继续复核，最终导航前仍为授权状态才离开。
- 验证结果：三个代码文件定向 Prettier 通过；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，耗时约 `4.17s`，仅保留项目既有的大分块体积提示。静态检索确认详情外壳的 `createCanvasProjectWithRemoteSync` 与 `linkCanvasUnit` 只存在于 `requestDiscardBeforeAction` 包装的原 action 中；章节画布更新、远端保存、创建、关联和两条导航均位于运行许可函数内且相邻关键点均有实时断言。当前账号为 0 项目，遵守边界未创建画布、关联章节、保存分镜或触发任何业务写接口，以静态状态转移、类型检查和生产构建作为有数据验收边界。
- 潜在影响：dirty 时所有使用详情统一 `onCreateCanvas` 的入口都会先显示同一放弃确认；clean 与归档状态行为不变。分镜导入期间若用户产生新的 dirty，客户端会停止后续步骤；已经在前一次检查后发出的不可取消单次请求无法由现有 API 撤回，但下一次本地/远端副作用与导航会被实时守卫阻断。运行锁只作用于当前章节页的分镜导入，不影响普通画布查看或其他项目操作。
- 逐项回滚：从 `.local/ui-change-backups/batch-128/` 按原相对路径恢复 `web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx` 与 `docs/design/admin-ui-change-log.md`。若只回滚顶栏保护，成对恢复 `detail.tsx` 和 `detail/shared.tsx`；若只回滚分镜实时守卫，恢复 `detail/chapters.tsx`；完整回滚最后恢复台账。恢复前若文件已包含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 同时覆盖清单和四份备份载荷，可在 batch-128 目录用一条 `shasum -a 256 -c MANIFEST.sha256` 完整校验；不依赖 Git，也不要修改旧批次。

## 批次 129：分镜导入事务收口与详情动作实时授权

- 日期时间：2026-08-30 00:45:58 +0800
- 目的：修复批次 128 独立 QA 发现的三项高优先级时序问题与两项状态合同问题：让章节分镜导入始终读取最新项目、章节、dirty 和挂载状态；在第一项不可逆写入前完成许可与预检查，进入事务后以一致性完成或显式补偿为优先；让详情顶栏创建画布在确认等待期间继续接受实时项目授权；并将手动 action 与 Router blocker 收敛为一次一意图。本批不修改后台、移动端、接口、路由结构或视觉框架。
- 对批次 128 记录的纠正：批次 128 关于“各关键 await 后继续复核实时 dirty，中途出现新 dirty 即停止剩余副作用”的表述过度声明了安全性。该策略在首次本地或远端写入之后停止，可能留下只更新未关联、只创建未关联等半成品；当时的守卫还捕获启动时项目对象，没有由项目、章节切换或卸载统一使运行代次失效。其共享确认也没有定义手动 action 与随后 Router blocker 同时出现时的优先级，存在按钮仍描述 action 却执行后退意图的风险。本批不篡改旧记录，在此明确纠正并以事务阶段和单一意图合同替代上述行为。
- 修改前状况：`chapters.tsx` 的 `assertImportAllowed` 读取启动闭包中的 `detail.project`，归档、项目或章节变化、组件卸载不会同步使当前 run token 失效；每个 await 后把新 dirty 当作停止条件，可能在画布已更新或创建后中止关联，且 link 成功后的断言可能把已成功事务报告为失败。顶栏创建 action 等待 dirty 确认时使用旧 `detail.data`，项目若转为只读仍可能继续创建；共享确认同时遇到手动 action 和路由 blocker 时，弹窗文字与实际执行分支可能不一致。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`docs/design/admin-ui-change-log.md`。未修改批次 128 或更早备份、其他详情子页、样式、后台、移动端与服务 API。
- 实时授权与代次：章节页维护最新项目 ID、状态、`readOnly`、挂载状态、当前章节、当前分镜单元、dirty、运行 owner 与 token 的 refs；项目授权上下文、章节或单元变化以及卸载都会增加 token，使旧运行不能再进入新的不可逆写入或导航。每条运行由唯一 owner 持有锁，`finally` 只有当前 owner 能释放锁，且卸载后不再更新 loading、消息或导航。所有预检查和首次写入前最后检查均要求组件仍挂载、token/owner 有效、项目 ID 匹配且可写、章节与单元未变化；dirty 许可只要求在事务开始前成立。
- 分镜事务阶段：预检阶段只读取章节、分镜和已有画布快照并构造下一状态，不写 store、远端或关联。已有画布链在最后一次许可后依次更新本地画布、保存远端、关联章节；若关联前因归档、项目/章节变化或卸载失效，则用原节点、连接和项目归属快照恢复本地并再次保存远端。新画布链在最后一次许可后创建并同步，再关联章节；关联前失效时调用既有删除同步能力清理新画布。事务一旦开始，用户后来继续编辑形成的新 dirty 不再中止保持一致所需的保存和关联；提交完成后若出现新 dirty，则保留当前草稿并留在原页，显示导入成功且可稍后打开画布的提示。关联成功即标记 committed，不再用后置断言把成功误报失败或重复导入。
- 事务结果策略：已有画布更新或新画布创建在关联前失败时尝试补偿；补偿成功明确报告导入未完成，补偿失败明确报告可能存在待检查的画布状态。`createCanvasProjectWithRemoteSync` 返回同步错误时继续沿用既有“本地画布可用但不关联章节”的结果，并按 dirty 决定是否导航，不伪称远端事务成功。项目关联 API 没有原子事务或取消信号，因此已发出的 `linkCanvasUnit` 若在归档/卸载同时被服务端接受，将作为已提交结果保留；客户端不在其后追加写入、失败提示或导航。补偿本身是为恢复事务前状态而执行的必要写入，也可能因网络失败而不能保证完全恢复。
- 顶栏创建实时授权：详情外壳以 refs 保存最新项目和路由项目 ID；确认打开期间若项目缺失、ID 不匹配或转为归档/只读，定向取消待执行手动 action。确认执行瞬间再次读取最新状态，只有当前项目仍可写才调用创建；创建返回后在关联和导航前再次复核，授权失效时不再 `linkCanvasUnit` 或导航。没有使用旧 `detail.data` 闭包，归档后等待中的 action 不会新触发创建、同步或关联。
- 单一意图状态机：clean 手动 action 立即执行；dirty 手动 action 成为当前确认的唯一意图，弹窗标题、描述和主按钮均来自该 action。确认期间出现 Router blocker 时，手动意图保持优先且被阻断的路由被重置，避免 action 文案执行后退；用户保留则两者都不执行，放弃则同步结算 dirty、重置被阻断路由并只执行一次手动 action。没有手动 action 时，Router blocker 独占确认并按原逻辑保留或继续。项目授权失效会取消手动意图、重置并调用统一失效提示，不放弃草稿、不执行旧 action。
- 静态状态转移覆盖：`active + clean → action/导入直接执行一次`；`dirty + 保留 → 0 创建/0 更新/0 保存/0 关联/0 导航`；`dirty + 放弃 → 预检 → 首次写前复核 → 单事务`；`等待确认时归档 → 取消 action，0 新写`；`预检时项目/章节/单元变化或卸载 → token 失效，0 写`；`首次写后新 dirty → 事务继续到一致结果，保留草稿且不导航`；`首次写后授权上下文失效 → 提交前补偿，或已提交结果不误报失败`；`手动 action + 路由意图并发 → 手动 action 独占，路由重置`。
- 验证结果：三个代码文件经定向 Prettier 检查通过；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，最终复验耗时约 `4.06s`，仅保留项目既有的大分块体积提示。静态检查确认分镜导入所有首次不可逆副作用前均读取实时 refs 与 token，事务开始后的 dirty 只控制最终导航，link 成功后没有后置断言；创建 action 的确认、创建返回、关联与导航均读取实时项目授权。当前账号为 0 项目，遵守边界未创建项目、画布、章节关联或触发业务写接口；真实有数据交互以上述状态转移、类型检查和生产构建为验收边界。
- 潜在影响与残余边界：正常未归档 clean 流程、API 参数和 `returnTo` 不变；dirty 用户在导入提交期间继续编辑时会留在原页，而不是强制跳转。客户端没有跨本地 store、远端画布保存和章节关联的服务端原子事务：已有画布回滚保存、新画布删除补偿均可能因网络失败而留下需要人工检查的差异；创建函数若在返回新 ID 前发生极少见的本地异常，调用方无法定位该 ID 做删除补偿；已经发出的关联请求无法取消。上述情况会给出诚实提示，本批不宣称完全事务或可撤销已接受的远端写入。
- 逐项回滚：从 `.local/ui-change-backups/batch-129/` 按原相对路径恢复 `web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx` 与 `docs/design/admin-ui-change-log.md`。只撤销顶栏实时授权时恢复 `detail.tsx`；只撤销单一意图合同时恢复 `detail/shared.tsx`；只撤销分镜事务时恢复 `detail/chapters.tsx`；完整回滚最后恢复台账。恢复前若文件已包含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 用一条 `shasum -a 256 -c MANIFEST.sha256` 同时校验清单和全部四份备份载荷；不依赖 Git，也不要修改旧批次。

## 批次 130：可信写许可与章节关联不确定提交处理

- 日期时间：2026-08-30 01:02:39 +0800
- 目的：修复批次 129 QA 发现的两项高优先级可信性问题与两项补偿/反馈问题：受保护的顶栏创建和分镜导入不能再用 React Query 旧缓存中的 `active` 解锁；章节关联请求失败必须区分已提交、明确未关联和无法确认；顶栏在关联完成后只有挂载、项目 ID 和最新网络状态均可信时才提示成功或导航；已有画布补偿应精确恢复包括 `updatedAt` 在内的原对象。本批不修改后台、移动端、API 参数、路由结构或其他详情业务。
- 对批次 129 记录的纠正：批次 129 将“关联成功即 committed”用于 Promise 正常返回是合理的，但其关于“已发出的关联请求若被服务端接受将作为已提交结果保留”的说明仍过度依赖客户端 Promise 结果。关联接口内部可能出现 Upsert 已成功而后续 revision bump 或响应传输失败，Promise reject 不能证明未关联；旧实现会进入 catch 并对已有画布恢复、对新画布删除，从而可能破坏已经成功关联的内容。本批不修改旧记录，在此追加纠正：关联一经发出即进入 `linking`，reject 后必须通过新网络详情确认，无法确认时只能进入 `unknown` 并保留完整画布。
- 修改前状况：`detail.tsx` 的 `latestDetailRef` 与 `chapters.tsx` 的 `projectRuntimeRef` 均来自可能保留旧数据的查询缓存；后台或另一标签页归档后，refetching、refetch error 或缓存未过期期间仍可能显示 `active`。顶栏和章节导入会据此开始创建、更新或同步。`linkCanvasUnit` reject 被直接当作未关联，章节导入 catch 会走补偿；现有画布补偿通过 `updateProject` 写回部分字段，该 API 会强制生成新的 `updatedAt`，并非完整恢复原项目对象。顶栏在 link await 后也没有用新网络详情再次确认当前项目状态。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`docs/design/admin-ui-change-log.md`。没有修改批次 129 或更早目录、服务 API、画布 store 接口、其他详情子页、样式、后台或移动端。
- 可信 writable 合同：项目详情域新增直接调用 `getProject` 的有界网络确认函数；只有请求成功、响应项目 ID 与目标完全一致且 `status === "active"` 才返回详情，归档、deleted/suspended/空值/未来状态、请求失败均 fail closed。该函数不读取 React Query data，不因旧缓存、refetching 或 refetch error 解锁，也没有轮询或递归查询。顶栏 action 在确认执行后获取一次权威详情用于章节和分镜预检，并在紧邻 `createCanvasProjectWithRemoteSync` 前再次网络确认；章节导入同样先获取权威章节/分镜详情并完成纯计算，再在紧邻首次 store/远端写前再次确认。章节关联作为独立不可逆写入，其前也再做一次可信 active 确认，同时继续要求 mounted、项目 ID、章节/单元和唯一 token 有效。
- 关联不确定提交：共享关联函数首次调用成功即为 `committed`；reject 后主动获取项目详情，以 `canvasId + unitId + role` 检查唯一关联。已存在则视为 `committed`，绝不回滚或删除；明确不存在且网络详情项目仍为 active、当前运行上下文仍有效时，利用既有 Upsert 唯一键最多幂等重试一次，随后无论重试 Promise 结果如何都再次获取详情确认。详情明确无关联为 `confirmed-not-linked`；详情请求失败、项目 ID 不匹配或仍不能确认则为 `unknown`，保留完整画布、不导航、不自动重复导入，并提示“关联状态待确认，请刷新项目详情检查”。归档、卸载或 token 失效后不会发起幂等重试。
- 明确状态机：`preflight` 只做 dirty 许可、实时上下文检查、可信网络查询和纯计算；`writing-content` 才进行已有画布更新/远端保存或新画布创建；内容成功且尚未发 link 时为 `confirmed-not-linked`；发送 link 后立即进入 `linking`；响应成功或详情回读命中关联进入 `committed`；详情明确不存在且重试后仍不存在进入 `confirmed-not-linked`；详情请求失败或身份不一致进入 `unknown`。只有 `preflight/writing-content` 中、能确定 link 从未发出且已有画布内容写入失败时才做补偿；`linking/committed/unknown` 均不执行破坏性恢复或删除。
- 补偿与反馈：已有画布写入前保留完整 `CanvasProject` 对象；内容保存失败且 link 尚未发出时，使用现有 `replaceProjects` 将目标项原样替回，而不是调用会刷新时间的 `updateProject`，因此本地 `title/createdAt/updatedAt/nodes/connections/projectId` 及其他字段全部恢复，再尝试同步远端。新画布同步失败继续保留既有的本地可用结果并明确未关联，不把本地成功伪装成完全失败。顶栏在 link await 之后、成功提示和导航之前再次网络确认 active，并检查组件仍挂载、当前路由项目 ID 未变化；期间归档、离页或查询失败时不导航、不显示误导性成功，只说明画布/关联已经完成但项目当前状态待确认。
- 静态状态转移覆盖：`旧缓存 active + 网络 archived/error/unknown → 0 首次写`；`网络 active + 上下文有效 → 首次写一次`；`内容完成后关联前网络非 active/error → 不发 link，保留画布`；`link reject + 回读已关联 → committed`；`link reject + active 且未关联 → 幂等重试一次 + 再回读`；`再回读已关联 → committed`；`再回读明确未关联 → confirmed-not-linked`；`任一关联回读失败/ID 不匹配 → unknown，0 回滚/0 删除/0 导航`；`link 后归档或卸载 → 已完成数据保留，0 成功提示/0 导航`；`已有画布内容保存失败且 link 未发出 → 精确对象恢复并尝试远端补偿`。
- 验证结果：三个代码文件与本记录经定向 Prettier 检查；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，仅保留项目既有的大分块体积提示。静态检索确认两个受保护入口的首次不可逆写入前均调用缓存外网络确认，关联 helper 仅在一次失败回读明确 active/未关联且实时运行仍有效时重试一次，`unknown` 分支没有 `replaceProjects`、删除或导航；已有画布恢复使用完整原对象。当前账号为 0 项目，遵守边界未创建项目、画布、关联或触发业务写接口，以静态状态机、类型检查和生产构建作为有数据验收边界。
- 潜在影响与残余竞态：正常 active 项目的顶栏创建和分镜导入会新增少量有界详情请求，以换取缓存外授权与关联确认；未归档 API 参数、返回路径和 dirty 意图合同不变。服务端创建、画布保存和章节关联接口仍没有共享事务、条件 revision 或 AbortSignal；最后一次 active 响应返回后到首个写请求到达服务端之间仍存在不可消除的竞态，只有服务端原子状态守卫才能完全关闭。关联回读也只是请求时点快照，之后仍可能由其他客户端变化。已有画布远端补偿可能因网络失败而只恢复本地，创建函数若在返回 ID 前异常仍无法定位潜在新画布；本批如实记录这些边界，不宣称服务端原子事务。
- 逐项回滚：从 `.local/ui-change-backups/batch-130/` 按原相对路径恢复 `web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/shared.tsx`、`web/src/pages/projects/detail/chapters.tsx` 与 `docs/design/admin-ui-change-log.md`。只撤销顶栏可信许可和后置反馈时恢复 `detail.tsx`；可信网络与关联确认 helper 位于 `detail/shared.tsx`，需与任一调用方成对恢复；只撤销分镜状态机和精确恢复时恢复 `detail/chapters.tsx`；完整回滚最后恢复台账。恢复前若文件已包含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 用一条 `shasum -a 256 -c MANIFEST.sha256` 同时校验清单和全部四份备份载荷；不依赖 Git，也不要修改旧批次。

## 批次 131：分镜未关联结果补偿条件收口

- 日期时间：2026-08-30 01:12:33 +0800
- 目的：最小修复批次 130 QA 剩余的补偿阶段遗漏，使所有能证明章节关联尚未发生的已写内容都执行安全补偿，同时保证 `linking`、`unknown`、`committed` 绝不恢复或删除。本批不修改可信网络查询、关联回读与幂等重试状态机，不修改后台、移动端、API、路由、样式或其他详情逻辑。
- 对批次 130 记录的纠正：批次 130 声明“只有 `preflight/writing-content` 中、能确定 link 从未发出且已有画布内容写入失败时才做补偿”，并称已有画布恢复已覆盖安全场景，但实现的 catch 条件实际仅为 `phase === writing-content && existingContentWasChanged`。内容保存成功后 phase 已切换为 `confirmed-not-linked`，若关联前的权威 active 查询失败、项目归档、章节/token 失效，或关联回读明确未关联，都会绕过补偿；新画布也没有对应删除路径。组件卸载后的正常返回还会在补偿前提前结束。本批不改旧记录，在此追加纠正并给出完整阶段矩阵。
- 修改前状况：已有画布仅在内容写入阶段抛错时恢复；进入 `confirmed-not-linked` 后，无论 link 尚未发出还是回读已明确无关联，都保留已写内容。新画布没有 `newCanvasWasCreated` 事实标记，也没有调用 `deleteCanvasProjectsWithRemoteSync` 清理。`if (!mountedRef.current) return` 位于 phase 结果处理之前，卸载可跳过数据补偿。补偿函数没有统一的一次性执行标记，若后续扩大入口存在重复恢复风险。
- 涉及文件：`web/src/pages/projects/detail/chapters.tsx`、`docs/design/admin-ui-change-log.md`。没有修改 `detail.tsx`、`detail/shared.tsx`、旧批次目录或任何其他代码。
- 具体改动：新增 `newCanvasWasCreated` 与 `compensationAttempted` 运行事实。统一 `compensateUnlinkedContent` 第一次调用即锁定，后续入口不重复执行；已有画布且内容已变时用 `replaceProjects` 原样恢复完整 `originalCanvas` 并调用 `saveRemoteUserDataNow`，新画布已创建时调用 `deleteCanvasProjectsWithRemoteSync` 清理。`writing-content` 抛错和 `confirmed-not-linked` 的正常结果/异常结果都进入该函数；补偿位于 mounted/UI 判断之前，因此卸载、项目/章节变化或 token 失效仍会等待数据恢复完成，只是不再刷新页面、提示或导航。补偿失败写入控制台诊断，页面仍挂载时额外显示“状态待检查”的诚实错误。
- phase × canvasType 补偿矩阵：`preflight × existing/new` 尚无内容变化，不补偿；`writing-content × existing` 若内容已变则完整对象恢复并同步，`writing-content × new` 仅在已取得新 ID 时删除；`confirmed-not-linked × existing` 若内容已变则完整恢复并同步，`confirmed-not-linked × new` 若已创建则删除；`linking × existing/new` 绝不补偿；`unknown × existing/new` 绝不补偿并保留完整画布待确认；`committed × existing/new` 绝不补偿。`compensationAttempted` 保证每个 run 最多一次，原 owner/token/finally 锁释放逻辑保持不变，幂等关联重试不会创建第二个画布。
- 状态转移证明：内容写入后、link 前的 active 查询失败/归档/上下文或章节失效均保持 `confirmed-not-linked`，catch 执行相应画布类型补偿；关联 helper 返回明确未关联时在任何 mounted 判断前补偿。卸载会使实时断言失败或阻止 UI，但不会中断已经开始的补偿 await。关联已经发出且仍在 `linking`、回读无法确认形成 `unknown`、或确认成功形成 `committed` 时，catch 和正常结果都在补偿入口之前明确返回。补偿失败后不再次尝试、不伪称已恢复，并提示需要检查画布状态。
- 验证结果：`chapters.tsx` 与本记录经定向 Prettier 检查；全量 `npx tsc --noEmit` 为 0 错误；`npx vite build` 生产构建成功转换 `12695` 个模块，仅保留项目既有的大分块体积提示。静态检索确认唯一补偿函数同时包含完整对象 `replaceProjects`、远端保存和新画布删除，`compensationAttempted` 在任何 await 前置位；`linking/unknown/committed` 分支均在补偿判断前返回。当前账号为 0 项目，遵守边界未创建、关联、删除或修改业务数据，以补偿矩阵、类型检查和生产构建作为有数据验收边界。
- 潜在影响与残余边界：明确未关联的本次分镜导入不再保留画布内容，而是恢复已有画布或删除本次新画布；`unknown` 仍保留内容供人工确认。已有画布补偿远端同步和新画布删除仍可能因网络失败而部分完成，失败时状态需要人工检查；新画布创建函数若在返回 ID 前抛错，调用方仍无法定位潜在实体。卸载后不会显示 UI 提示，但控制台保留补偿失败诊断。可信 writable、最多一次关联重试、API 参数和正常 committed 行为均不变。
- 逐项回滚：从 `.local/ui-change-backups/batch-131/` 按原相对路径恢复 `web/src/pages/projects/detail/chapters.tsx` 与 `docs/design/admin-ui-change-log.md`。只撤销补偿条件时恢复 `chapters.tsx` 并追加回滚记录；完整回滚最后恢复台账。恢复前若文件已包含后续批次，先复制当前版本。`MANIFEST.md` 记录精确备份时间、修改前与完成 SHA-256，`MANIFEST.sha256` 用一条 `shasum -a 256 -c MANIFEST.sha256` 同时校验清单和全部两份备份载荷；不依赖 Git，也不要修改旧批次。

## 批次 133：短剧项目详情五入口 PC 视觉层级统一

- 日期时间：2026-08-30 02:01:16 CST
- 目的：在不改变批次 118～132 已建立的列表状态、URL 返回上下文、归档只读、dirty 保护、可信写许可和路由合同前提下，统一普通用户 PC 短剧项目详情的制作概览、剧情章节、项目画布、角色与资产、项目设置五个入口，使项目名、当前视图、说明、主操作、内容容器与页面状态形成稳定层级。
- 修改前状况：项目详情顶部的项目名只有普通正文大小，状态由一个小圆点和弱文字分散表达；五个入口的页面身份不一致，概览缺少固定“制作概览”二级标题，章节直接进入双栏编辑器，画布没有标题与说明，资产和设置各自使用不同页头密度。空画布和项目加载/错误提示缺少稳定的一级表面承载；设置仍是无外框分段，宽屏下字段关系较松散；项目资产目录与结果区缺少共同工作面板边界。
- 涉及文件：`web/src/pages/projects/detail.tsx`、`web/src/pages/projects/detail/overview.tsx`、`web/src/pages/projects/detail/chapters.tsx`、`web/src/pages/projects/detail/canvases.tsx`、`web/src/pages/projects/detail/assets.tsx`、`web/src/pages/projects/detail/settings.tsx`、`web/src/styles/user-pc.css`、`docs/design/admin-ui-change-log.md`。未修改 `shared.tsx`、接口、路由、认证、公共顶栏侧栏、公共会话、后台页面、移动端或业务数据。
- 具体改动：项目详情顶部将项目名提升为清晰 h1，进行中/已归档改为有文字、边界和状态点的紧凑状态面，返回按钮使用明确“返回短剧项目”的可访问名称与 Tooltip；五个 view 继续沿用原 Link、URL 和选中判断，只加强当前项的一级表面、边界和文字反馈。概览新增固定 h2、说明及章节/画布/待处理摘要；章节增加固定 h2 与说明，同时保留原双栏内部滚动和所有 dirty/只读动作；画布增加 h2、数量和稳定空态表面；资产页统一标题、说明、主操作与统计层级，将目录和结果收进同一工作面板，并为根目录纯图标操作补齐 Tooltip；设置页改为“页面说明与保存状态 → 基础设置卡 → 项目画风卡 → 归档状态卡”，宽屏采用摘要列与内容列，窄 PC 自动堆叠。项目加载和不可用错误统一进入 760px 一级表面；非章节页面内容最大宽度为 1600px并居中，唯一内容滚动区使用稳定滚动槽。全部新增视觉规则限定在 `.app-creator-workspace`，使用 `--user-*` 亮暗主题 token，并补充统一焦点和减少动画规则。
- 业务合同核对：所有 mutation、query、URL、导航目标、归档判断、禁用条件、dirty 注册与放弃确认、可信 writable 网络确认、关联不确定态和补偿状态机保持原样；本批没有发现需要修改业务逻辑的事项。页面文字新增仅用于解释当前视图与空态，不改变业务结果承诺。
- 验证结果：八个目标源码/样式/记录文件通过定向 Prettier；全量 `npx tsc --noEmit` 为 0 错误；Vite 8.1.5 生产构建成功转换 12,695 个模块并在约 4.63 秒完成，仅保留项目既有的大分块提示。使用现有已登录 Chrome 会话访问当前源码开发服务；账号真实项目数为 0，未创建或修改测试项目。五个详情 URL 均以不存在项目做只读错误态检查，稳定显示“项目不可用”和返回操作；亮色与暗色分别覆盖 1280×800、1440×900、1920×1080 三档真实 CSS 视口，文档和 main 横向溢出均为 0，错误表面宽 760px，亮色为 `rgb(255,255,255)`、暗色为 `rgb(26,29,32)`。有数据态、归档态、章节编辑态和五页业务动作因真实账号无项目且禁止写业务数据，以完整 JSX/CSS 结构检查、历史状态机核对、全量类型和生产构建作为验证边界；没有伪造接口或业务记录。控制台仅出现批次 132 已记录的 Ant `App cssVar` 与 `Modal maskClosable` 既有警告，没有本批运行错误。
- 潜在影响：项目详情首屏增加约 76～86px 当前视图身份层，章节编辑区可用高度相应减少但仍由单一 flex 区域内部滚动；设置和资产页新增一级表面与细边界，1920px 下内容不再无限拉伸。顶部项目状态与当前 view 更醒目，页面 h1→h2→说明顺序稳定。接口请求、业务状态、路由、数据、权限和移动端均不变。
- 逐项回滚：修改前八个原件、SHA-256、校验文件和恢复步骤位于 `.local/ui-change-backups/batch-133/MANIFEST.md` 与 `MANIFEST.sha256`。回滚前先保留后续修改，再按原相对路径逐项恢复并运行 `shasum -a 256 -c MANIFEST.sha256`；完整回滚最后恢复本记录。不需要初始化、提交或依赖 Git。
