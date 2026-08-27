/**
 * 导演台键盘快捷键解析。
 *
 * 纯函数：只把「按键事件形状」映射为语义动作，不碰 DOM、不改场景。
 * 组件层负责注册监听与执行动作，因此这里可以完整单测。
 *
 * 安全边界：焦点落在任何交互控件（输入框、按钮、链接、role 型控件、
 * 可编辑区域）或其内部时，绝不把按键解析为全局快捷键。
 * 否则用户改名时会误删对象、按 Space 激活按钮时会误切换播放。
 */

/**
 * 语义动作。只保留导演台里已经存在真实执行路径的动作：
 * 变换模式（DirectorViewportDock 的 W/E/R）、删除选中对象或灯光、
 * 撤销/重做（顶栏按钮）、切换选中对象显隐（检查器「可见」开关）、
 * 取消选择、播放/暂停（时间轴 transport）。
 *
 * 聚焦、复制、重命名没有对应实现，不在这里造无处可去的动作。
 */
export type DirectorShortcutAction = { kind: "transform-mode"; mode: "translate" | "rotate" | "scale" } | { kind: "delete-selected" } | { kind: "undo" } | { kind: "redo" } | { kind: "toggle-visibility" } | { kind: "deselect" } | { kind: "toggle-play" };

/** 只取事件的必要形状，便于测试构造，也避免耦合真实 KeyboardEvent。 */
export type DirectorKeyEvent = {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    /** 事件目标是否落在交互控件内，由调用方判定后传入。 */
    isInteractiveTarget?: boolean;
};

const TRANSFORM_KEYS: Record<string, "translate" | "rotate" | "scale"> = {
    w: "translate",
    e: "rotate",
    r: "scale",
};

/**
 * 解析按键为动作；不匹配返回 null。
 *
 * 约定：
 * - 交互控件语境一律不解析，交还给控件本身；
 * - 带修饰键的组合优先（Undo/Redo），避免 Ctrl+R 被当作 scale；
 * - 单字母快捷键不区分大小写，Shift+W 仍是 translate；
 * - Redo 同时接受 Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y。
 */
export function resolveDirectorShortcut(event: DirectorKeyEvent): DirectorShortcutAction | null {
    if (event.isInteractiveTarget) return null;

    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const accel = Boolean(event.ctrlKey || event.metaKey);

    if (accel) {
        // Alt 组合留给浏览器/系统，不抢。
        if (event.altKey) return null;
        if (lower === "z") return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
        if (lower === "y") return { kind: "redo" };
        return null;
    }

    if (event.altKey) return null;

    if (lower in TRANSFORM_KEYS) return { kind: "transform-mode", mode: TRANSFORM_KEYS[lower] };
    if (key === "Delete" || key === "Backspace") return { kind: "delete-selected" };
    if (lower === "h") return { kind: "toggle-visibility" };
    if (key === "Escape") return { kind: "deselect" };
    if (key === " " || key === "Spacebar") return { kind: "toggle-play" };

    return null;
}

/**
 * 交互控件的唯一真源。
 * DIRECTOR_INTERACTIVE_SELECTOR（真实 DOM 的 closest 用）与
 * isDirectorInteractiveNode（单节点判定）都从这里派生，避免两处清单漂移。
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
export const DIRECTOR_INTERACTIVE_SELECTOR = [...INTERACTIVE_TAGS.map((tag) => tag.toLowerCase()), ...INTERACTIVE_ROLES.map((role) => `[role="${role}"]`), '[contenteditable="true"]', '[contenteditable=""]'].join(",");

/**
 * 判断单个节点自身是否是交互控件。不看祖先。
 * 祖先由 blocksDirectorShortcut 通过 closest 处理。
 */
export function isDirectorInteractiveNode(target: unknown): boolean {
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
export function blocksDirectorShortcut(target: unknown): boolean {
    if (!target || typeof target !== "object") return false;
    const node = target as { closest?: (selector: string) => unknown };
    if (typeof node.closest === "function") return Boolean(node.closest(DIRECTOR_INTERACTIVE_SELECTOR));
    return isDirectorInteractiveNode(target);
}

/**
 * 指针激活后释放焦点，使全局快捷键立刻可用。
 *
 * 为什么需要：blocksDirectorShortcut 会吃掉聚焦控件上的所有全局快捷键（这是刻意的，
 * Space/Delete/Backspace 属于控件自己）。但鼠标点完一个工具按钮或场景行之后，
 * 焦点仍留在按钮上，于是「点选对象 -> 按 Delete」这类主流程会静默失效。
 *
 * detail === 0 表示键盘激活（Enter/Space 合成的 click），此时必须保留焦点，
 * 否则 Tab 序列会断、键盘用户会丢失位置。判据与 plugins 页一致。
 *
 * 导演台的按钮分散在 workbench、dock、sequencer 三处，各自没有公共基组件，
 * 因此这条规则集中在这里，避免每个 onClick 各写一遍而慢慢走偏。
 */
export function releaseDirectorFocusAfterPointer(event: { detail: number; currentTarget: { blur?: () => void } }): void {
    if (event.detail === 0) return;
    event.currentTarget.blur?.();
}
