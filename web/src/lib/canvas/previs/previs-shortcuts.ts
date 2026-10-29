/**
 * 世界引擎键盘快捷键解析。
 *
 * 纯函数：只把「按键事件形状」映射为语义动作，不碰 DOM、不改场景。
 * 组件层负责注册监听与执行动作，因此这里可以完整单测。
 *
 * 安全边界：焦点落在任何交互控件（输入框、按钮、链接、role 型控件、
 * 可编辑区域）或其内部时，绝不把按键解析为全局快捷键。
 * 否则用户改名时会误删对象、按 Space 激活按钮时会误切换播放。
 */

/** 工具模式：选择只点选；移动/旋转/缩放显示对应 gizmo。 */
export type PrevisToolMode = "select" | "translate" | "rotate" | "scale";

/**
 * 语义动作。每个动作都有真实执行路径（工作台 runShortcut），不造无处可去的键。
 */
export type PrevisShortcutAction =
    | { kind: "transform-mode"; mode: PrevisToolMode }
    | { kind: "delete-selected" }
    | { kind: "duplicate-selected" }
    | { kind: "undo" }
    | { kind: "redo" }
    | { kind: "toggle-visibility" }
    | { kind: "deselect" }
    | { kind: "toggle-play" }
    | { kind: "focus-selected" }
    | { kind: "frame-scene" }
    | { kind: "toggle-camera-view" }
    | { kind: "capture-screenshot" }
    | { kind: "toggle-help" };

/** 只取事件的必要形状，便于测试构造，也避免耦合真实 KeyboardEvent。 */
export type PrevisKeyEvent = {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    /** 事件目标是否落在交互控件内，由调用方判定后传入。 */
    isInteractiveTarget?: boolean;
};

const TRANSFORM_KEYS: Record<string, PrevisToolMode> = {
    q: "select",
    w: "translate",
    e: "rotate",
    r: "scale",
};

/**
 * 快捷键说明的唯一真源：dock 提示、底部提示条、帮助面板与文档都从这里取，
 * 避免「按键改了、提示没改」。keys 用于展示，不参与解析。
 */
export const PREVIS_SHORTCUT_GUIDE: Array<{ group: string; items: Array<{ keys: string[]; label: string }> }> = [
    {
        group: "选择与变换",
        items: [
            { keys: ["Q"], label: "选择工具（只点选，不显示手柄）" },
            { keys: ["W"], label: "移动" },
            { keys: ["E"], label: "旋转" },
            { keys: ["R"], label: "缩放" },
            { keys: ["Esc"], label: "取消选择" },
            { keys: ["Delete"], label: "删除选中对象 / 灯光" },
            { keys: ["Ctrl/⌘", "D"], label: "复制选中对象" },
            { keys: ["H"], label: "显示 / 隐藏选中对象" },
        ],
    },
    {
        group: "视图",
        items: [
            { keys: ["F"], label: "聚焦选中对象" },
            { keys: ["A"], label: "适配全部对象" },
            { keys: ["C"], label: "切换 3D / 机位视图" },
        ],
    },
    {
        group: "时间轴与输出",
        items: [
            { keys: ["Space"], label: "播放 / 暂停" },
            { keys: ["Ctrl/⌘", "Z"], label: "撤销" },
            { keys: ["Ctrl/⌘", "Shift", "Z"], label: "重做" },
            { keys: ["P"], label: "截取当前镜头画面" },
            { keys: ["?"], label: "显示 / 隐藏快捷键" },
        ],
    },
];

/** 工具名附带按键，dock 与提示条共用。 */
export const PREVIS_TOOL_LABELS: Record<PrevisToolMode, string> = {
    select: "选择 (Q)",
    translate: "移动 (W)",
    rotate: "旋转 (E)",
    scale: "缩放 (R)",
};

/**
 * 解析按键为动作；不匹配返回 null。
 *
 * 约定：
 * - 交互控件语境一律不解析，交还给控件本身；
 * - 带修饰键的组合优先（Undo/Redo/Duplicate），避免 Ctrl+R 被当作 scale；
 * - 单字母快捷键不区分大小写，Shift+W 仍是 translate；
 * - Redo 同时接受 Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y。
 */
export function resolvePrevisShortcut(event: PrevisKeyEvent): PrevisShortcutAction | null {
    if (event.isInteractiveTarget) return null;

    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const accel = Boolean(event.ctrlKey || event.metaKey);

    if (accel) {
        // Alt 组合留给浏览器/系统，不抢。
        if (event.altKey) return null;
        if (lower === "z") return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
        if (lower === "y") return { kind: "redo" };
        if (lower === "d" && !event.shiftKey) return { kind: "duplicate-selected" };
        return null;
    }

    if (event.altKey) return null;
    if (key === "?") return { kind: "toggle-help" };

    if (lower in TRANSFORM_KEYS) return { kind: "transform-mode", mode: TRANSFORM_KEYS[lower] };
    if (key === "Delete" || key === "Backspace") return { kind: "delete-selected" };
    if (lower === "h") return { kind: "toggle-visibility" };
    if (lower === "f") return { kind: "focus-selected" };
    if (lower === "a") return { kind: "frame-scene" };
    if (lower === "c") return { kind: "toggle-camera-view" };
    if (lower === "p") return { kind: "capture-screenshot" };
    if (key === "Escape") return { kind: "deselect" };
    if (key === " " || key === "Spacebar") return { kind: "toggle-play" };

    return null;
}

/**
 * 交互控件的唯一真源。
 * PREVIS_INTERACTIVE_SELECTOR（真实 DOM 的 closest 用）与
 * isPrevisInteractiveNode（单节点判定）都从这里派生，避免两处清单漂移。
 */
const INTERACTIVE_TAGS = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "OPTION", "LABEL", "SUMMARY"] as const;

/**
 * role 型控件：AntD 大量用 role 而非原生标签表达按钮、开关、菜单项。
 * Space/Delete/Backspace 对这些控件都有自己的含义，必须让它们优先。
 */
const INTERACTIVE_ROLES = [
    "textbox",
    "combobox",
    "spinbutton",
    "searchbox",
    "button",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "slider",
    "checkbox",
    "radio",
    "link",
    "listbox",
    "menu",
    "radiogroup",
    "treeitem",
] as const;

/** 供真实 DOM 的 Element.closest 使用：命中控件自身或任何交互祖先。 */
export const PREVIS_INTERACTIVE_SELECTOR = [...INTERACTIVE_TAGS.map((tag) => tag.toLowerCase()), ...INTERACTIVE_ROLES.map((role) => `[role="${role}"]`), '[contenteditable="true"]', '[contenteditable=""]'].join(",");

/**
 * 判断单个节点自身是否是交互控件。不看祖先。
 * 祖先由 blocksPrevisShortcut 通过 closest 处理。
 */
export function isPrevisInteractiveNode(target: unknown): boolean {
    if (!target || typeof target !== "object") return false;
    const node = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: (name: string) => string | null };
    if (node.isContentEditable === true) return true;

    const tagName = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
    if ((INTERACTIVE_TAGS as readonly string[]).includes(tagName)) return true;

    if (typeof node.getAttribute === "function") {
        const role = node.getAttribute("role");
        if (role && (INTERACTIVE_ROLES as readonly string[]).includes(role)) return true;
        const editable = node.getAttribute("contenteditable");
        if (editable === "" || editable === "true") return true;
    }
    return false;
}

/**
 * 事件目标是否应当阻止全局快捷键。
 *
 * 用 closest 而不是只看 target 自身：点击按钮里的 <svg>/<span> 时
 * event.target 是子元素，只判自身会漏掉整个控件。
 * closest 同时覆盖 SVG 元素（SVGElement 也实现 Element.closest）。
 *
 * 没有 closest 的目标（window、document、测试替身）退化为单节点判定。
 */
export function blocksPrevisShortcut(target: unknown): boolean {
    if (!target || typeof target !== "object") return false;
    const node = target as { closest?: (selector: string) => unknown };
    if (typeof node.closest === "function") return Boolean(node.closest(PREVIS_INTERACTIVE_SELECTOR));
    return isPrevisInteractiveNode(target);
}

/**
 * 指针激活后释放焦点，使全局快捷键立刻可用。
 *
 * 为什么需要：blocksPrevisShortcut 会吃掉聚焦控件上的所有全局快捷键（这是刻意的，
 * Space/Delete/Backspace 属于控件自己）。但鼠标点完一个工具按钮或场景行之后，
 * 焦点仍留在按钮上，于是「点选对象 -> 按 Delete」这类主流程会静默失效。
 *
 * detail === 0 表示键盘激活（Enter/Space 合成的 click），此时必须保留焦点，
 * 否则 Tab 序列会断、键盘用户会丢失位置。判据与 plugins 页一致。
 *
 * 世界引擎的按钮分散在 workbench、dock、sequencer 三处，各自没有公共基组件，
 * 因此这条规则集中在这里，避免每个 onClick 各写一遍而慢慢走偏。
 */
export function releasePrevisFocusAfterPointer(event: { detail: number; currentTarget: { blur?: () => void } }): void {
    if (event.detail === 0) return;
    event.currentTarget.blur?.();
}
