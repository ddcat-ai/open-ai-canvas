# CanvasChooseImageStylePicker 组件计划

## 概要

将 [canvas-node-prompt-panel.tsx](../../../web/src/components/canvas/canvas-node-prompt-panel.tsx) L750-760 的"风格"固定按钮（当前职责：打开项目画风弹窗 `CanvasStylePickerModal`）替换为新独立组件 `CanvasChooseImageStylePicker`：

* 以 Dropdown 为交互载体，弹层采用侧边栏工具面板的 cover 卡片网格视觉

* 选择风格工具后，触发按钮回显该工具的 cover 缩略图 + 名称

* 面板可关闭（点击外部 / ESC / 选中后自动关闭）

* 选中后通过现有 tool mention 机制向节点提示词插入 `@[tool:style:ID:label:Palette]` 标签（`buildToolMentionReference(toolId, label, "style", "Palette")` + `insertPromptReference`，自动走 `overwriteSameTypeToolMention` 原位替换同类标签）

* 编辑器（`canvas-resource-mention-textarea.tsx`）将 tool token 渲染为不可编辑 chip，标签不会以裸文本出现在编辑器内容中；生成时由后端 `ResolveToolMentionTokens`（`backend/internal/tools/tool_mention.go`）展开为工具提示词

## 现状分析（探索结论）

1. **原按钮链路**：`onChooseStyle` prop 由 [project.tsx:2146](../../../web/src/pages/canvas/project.tsx) 传入 `() => setStylePickerOpen(true)`，打开项目画风弹窗（styleboard 节点，`use-canvas-style-workflow.ts`），与节点提示词无关。项目画风入口在 CanvasToolbar（project.tsx:2715）、右键菜单（2978）等多处存在，替换后不丢失。
2. **tool mention 机制已支持 style**：`UNIQUE_TOOL_MENTION_TYPES = {"style", "nine_grid", "effect"}`（[canvas-resource-references.ts:70](../../../web/src/lib/canvas/canvas-resource-references.ts)），`overwriteSameTypeToolMention` 已实现同类型原位替换；token 格式 `@[tool:${type}:${toolId}:${label}:${icon}]`；九宫格是现成先例（panel:489-493 + 新建的 [canvas-nine-grid-picker.tsx](../../../web/src/components/canvas/canvas-nine-grid-picker.tsx)）。
3. **风格工具数据源**：`listTools({ scope: "public", type: "style" })`（[services/api/tools.ts:65](../../../web/src/services/api/tools.ts)），`ToolSummary` 含 `id/label/cover`。侧边栏 [canvas-workspace-tool-panel.tsx](../../../web/src/components/canvas/canvas-workspace-tool-panel.tsx) 已消费该数据渲染 cover 卡片（473、540-547 行），其中私有函数 `toAbsoluteUrl`（86-91 行）处理种子数据的相对路径 cover（相对路径返回 ""，需回退图标）。
4. **弹层样式参照**：[canvas-grid-split-picker.css](../../../web/src/components/canvas/canvas-grid-split-picker.css) 的 `.canvas-node-toolbar-menu-split .canvas-node-toolbar-menu-stack`（1-18 行）是弹层视觉外壳（`--workspace-overlay-border` / `--workspace-overlay-bg-strong` token + 圆角）；nine-grid 弹层同类（77-85 行）。

## 改动方案

### 1. 新建 `web/src/components/canvas/canvas-choose-image-style-picker.tsx`

组件 API（对齐 CanvasNineGridPicker / CanvasPresetPicker 的受控模式）：

```tsx
export function CanvasChooseImageStylePicker({
    open,               // 受控 open（内部维护 internalOpen，open ?? internalOpen）
    onOpenChange,       // open 受控回调
    activeToolId,       // 当前 prompt 中 style 标签的 toolId（未选为 undefined）
    activeLabel,        // 当前 style 标签的 label 段（列表未加载/查不到时回显用）
    onSelect,           // (toolId, label) => void
}: { ... })
```

内部实现：

* **数据**：`useQuery({ queryKey: ["canvas-tools", "style-picker"], queryFn: ({signal}) => listTools({ page: 1, pageSize: 100, scope: "public", type: "style" }, { signal }) })`。单页 100 条足够弹层轻量选择（种子 style 工具十余个）；主浏览入口仍是侧边栏工具面板。

* **触发按钮**：保持 `canvas-node-fixed-chip` 类名与尺寸：

  * 已选且列表查到 cover：`<img className="size-4 shrink-0 rounded-[3px] object-cover" />` + 选中工具 label（`truncate`，title 提示全名）

  * 已选但 cover 不可用：Palette 图标 + label（activeTool.label ?? activeLabel）

  * 未选：Palette 图标 + "风格"

  * `aria-expanded` / `aria-haspopup="menu"` / `onPointerDown` stopPropagation（对齐现有 chip）

* **Dropdown**：`trigger={["click"]}`、`autoAdjustOverflow`、`menu={{ items: [] }}` + `popupRender` 完全接管渲染（antd 5 menu 为必填项，传空 items，popupRender 忽略默认菜单内容，渲染自定义卡片网格——Dropdown 仅作为定位/开合/关闭交互载体，满足需求 1 与 3）。

* **popupRender 弹层**（对齐 nine-grid picker 的四事件 stopPropagation + `data-canvas-no-zoom` / `data-canvas-wheel-scroll`）：

  * 外壳 `canvas-node-toolbar-menu canvas-node-toolbar-menu-style`

  * 内层 `canvas-node-toolbar-menu-stack`（视觉外壳样式见改动 4）

  * 网格：`grid grid-cols-3 gap-1.5 p-2 max-h-80 overflow-y-auto thin-scrollbar`

  * 卡片：button（键盘可达），视觉复用侧边栏工具卡片 token——`rounded-[var(--r-md)] border p-1.5 hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-primary/35`；内部 `aspect-[4/3]` cover 图（`toAbsoluteUrl(tool.cover)`，加载失败/无 cover 回退 Wrench 图标占位）+ `truncate text-[11px]` label；选中项 `aria-pressed` + ring 高亮

  * 状态：加载中（LoaderCircle 旋转占位）、空态（"暂无风格工具"）、查询失败（面板内文案，不弹全局 message）

* **选中行为**：`setOpen(false)` 后 `onSelect(tool.id, tool.label)`（先关面板再回调，对齐 nine-grid）。

### 2. 修改 `web/src/components/canvas/canvas-workspace-tool-panel.tsx`

* `function toAbsoluteUrl` 改为 `export function toAbsoluteUrl`（86 行）：新组件复用同一"种子相对路径 → 空 URL 回退"逻辑，避免复制五处重复实现；该函数语义即"工具媒体 URL 规范化"，随工具消费方共享。

### 3. 修改 `web/src/components/canvas/canvas-grid-split-picker.css`

追加弹层外壳样式（与 `.canvas-node-toolbar-menu-split .canvas-node-toolbar-menu-stack` 同构，见 12-18 行）：

```css
.canvas-node-toolbar-menu-style .canvas-node-toolbar-menu-stack {
    min-width: 17rem;
    overflow: hidden;
    border: 1px solid var(--workspace-overlay-border, var(--dock-border));
    border-radius: 8px;
    background: var(--workspace-overlay-bg-strong, var(--dock-surface));
}
```

卡片内部样式用 tailwind 原子类（复用侧栏卡片既有 token），不新增全局 antd 覆盖。

### 4. 修改 `web/src/components/canvas/canvas-node-prompt-panel.tsx`

* import 新组件；从 lucide import 中移除 `Palette`（仅 L758 一处使用，替换后无引用）。

* 新增状态（91-92 行区，对齐 nine-grid 双状态模式，区分普通 composer 与 expanded modal）：

  * `const [styleToolOpen, setStyleToolOpen] = useState(false);`

  * `const [expandedStyleToolOpen, setExpandedStyleToolOpen] = useState(false);`

* 新增解析（104 行 `activeNineGridIcon` 旁）：

  * `const activeStyleTool = useMemo(() => parseToolMentionTokens(prompt).find((tool) => tool.type === "style"), [prompt]);`

* `renderPromptEditor`（488 行附近）向 ConnectedReferenceShelf 传参变更：

  * 移除 `onChooseStyle={onChooseStyle}`

  * 新增 `styleToolOpen={expanded ? expandedStyleToolOpen : styleToolOpen}`、`onStyleToolOpenChange={expanded ? setExpandedStyleToolOpen : setStyleToolOpen}`、`activeStyleToolId={activeStyleTool?.toolId}`、`activeStyleToolLabel={activeStyleTool?.label}`、`onStyleToolItem={(toolId, label) => insertPromptReference(buildToolMentionReference(toolId, label, "style", "Palette"))}`（走 `insertPromptReference` → `overwriteSameTypeToolMention`，同类 style 标签原位替换，需求 4/5）

* `CanvasNodePromptPanelProps` 删除 `onChooseStyle?: () => void`（54 行）及解构（76 行区）——该 prop 唯一消费点即被替换的按钮。

* `ConnectedReferenceShelf`（696/713/749-761 行）：

  * 移除 `onChooseStyle` 参数与类型声明

  * 新增上述 5 个 props 的参数与类型

  * L749-761 的风格按钮整体替换为：

```tsx
{mode === "image" ? (
    <CanvasChooseImageStylePicker
        open={styleToolOpen}
        onOpenChange={onStyleToolOpenChange}
        activeToolId={activeStyleToolId}
        activeLabel={activeStyleToolLabel}
        onSelect={onStyleToolItem}
    />
) : null}
```

### 5. 修改 `web/src/pages/canvas/project.tsx`

* 删除 2146 行 `onChooseStyle={() => setStylePickerOpen(true)}` 传参（props 类型已删，TS 会强制；`setStylePickerOpen` 的其余入口——工具栏 2715、右键菜单 2978、styleboard 占位 2176、短剧引导——不受影响）。

## 假设与决策

1. **需求 4/5 的实现路径**：标签写入节点 prompt 字符串（`@[tool:style:ID:label:Palette]`），编辑器渲染为不可编辑 chip（非裸文本），生成 payload 原样携带 token、后端展开——完全复用 nine-grid 既有机制，不加隐藏注入层。
2. **"替换"含原入口移除**：prompt 面板的"项目画风"入口随按钮替换消失，项目画风功能仍可从工具栏/右键菜单进入。
3. **不做清除已选功能**：需求仅要求面板可关闭；清除 style 标签可由用户在编辑器删除 chip 完成（contentEditable=false 的 chip 支持整体删除）。
4. **单页 100 条查询**：弹层是轻量选择器；数据量大时用侧栏工具面板。组件结构上数据查询独立于渲染，后续扩展搜索/分页不动调用方。
5. **label 含冒号风险**：后端 token 正则要求 label 段不含 `:`/`]`，异常 label 时后端保留原 token 不破坏 prompt，可接受。
6. **种子数据部分 cover 为相对路径无法显示**：`toAbsoluteUrl` 返回 "" 回退 Wrench/Palette 占位，与侧栏面板现状一致。

## 验证步骤

1. `cd web && bun run build`（类型 + 构建）。
2. 浏览器手动验证（dev 环境已有 vite 进程）：

   * 画布项目 → 图片节点提示词面板 → "风格" chip → 弹层展示风格工具 cover 网格（含空态/加载态）

   * 选择风格 → 按钮变为 cover 缩略图 + 名称；编辑器 prompt 出现 `@[tool:style:...]` chip（非裸文本）

   * 再选另一风格 → 原位替换（prompt 中 style 标签唯一）

   * 点击外部 / ESC / 选中后面板关闭；普通与 expanded 全屏两种编辑器形态下弹层定位正常

   * 明暗主题下弹层边框/背景 token 正常；小屏（窄画布）下弹层不溢出、网格可滚动
3. 确认既有测试不回归：`bun test test/canvas-resource-mention-editor.test.ts`（该文件 1 个失败为合并 main 引入的存量问题，与本次无关，仅确认失败数不变）。

