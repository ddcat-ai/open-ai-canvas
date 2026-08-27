import { describe, expect, test } from "bun:test";

import { DIRECTOR_INTERACTIVE_SELECTOR, blocksDirectorShortcut, isDirectorInteractiveNode, releaseDirectorFocusAfterPointer, resolveDirectorShortcut, type DirectorKeyEvent } from "../src/lib/canvas/director/director-shortcuts";

const press = (overrides: Partial<DirectorKeyEvent> & { key: string }): DirectorKeyEvent => ({ ...overrides });

describe("变换模式快捷键", () => {
    test("W/E/R 映射到平移/旋转/缩放", () => {
        expect(resolveDirectorShortcut(press({ key: "w" }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "e" }))).toEqual({ kind: "transform-mode", mode: "rotate" });
        expect(resolveDirectorShortcut(press({ key: "r" }))).toEqual({ kind: "transform-mode", mode: "scale" });
    });

    test("大写与 Shift 组合仍然生效", () => {
        expect(resolveDirectorShortcut(press({ key: "W" }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "E", shiftKey: true }))).toEqual({ kind: "transform-mode", mode: "rotate" });
    });

    test("带 Ctrl/Cmd 时不再当作变换模式", () => {
        // Ctrl+R 是刷新，绝不能被解析成 scale。
        expect(resolveDirectorShortcut(press({ key: "r", ctrlKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "w", metaKey: true }))).toBeNull();
    });
});

describe("对象操作快捷键", () => {
    test("Delete 与 Backspace 都删除选中对象", () => {
        expect(resolveDirectorShortcut(press({ key: "Delete" }))).toEqual({ kind: "delete-selected" });
        expect(resolveDirectorShortcut(press({ key: "Backspace" }))).toEqual({ kind: "delete-selected" });
    });

    test("H 切换显隐、Escape 取消选择", () => {
        expect(resolveDirectorShortcut(press({ key: "h" }))).toEqual({ kind: "toggle-visibility" });
        expect(resolveDirectorShortcut(press({ key: "Escape" }))).toEqual({ kind: "deselect" });
    });

    test("没有执行路径的键不解析：F 聚焦、F2 重命名、Ctrl+D 复制", () => {
        expect(resolveDirectorShortcut(press({ key: "f" }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "F2" }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "d", ctrlKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "d", metaKey: true }))).toBeNull();
    });

    test("空格切换播放", () => {
        expect(resolveDirectorShortcut(press({ key: " " }))).toEqual({ kind: "toggle-play" });
        expect(resolveDirectorShortcut(press({ key: "Spacebar" }))).toEqual({ kind: "toggle-play" });
    });
});

describe("撤销/重做", () => {
    test("Ctrl/Cmd+Z 撤销", () => {
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true }))).toEqual({ kind: "undo" });
        expect(resolveDirectorShortcut(press({ key: "z", metaKey: true }))).toEqual({ kind: "undo" });
    });

    test("Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 都是重做", () => {
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
        expect(resolveDirectorShortcut(press({ key: "Z", metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
        expect(resolveDirectorShortcut(press({ key: "y", ctrlKey: true }))).toEqual({ kind: "redo" });
    });

    test("裸 Z/Y 不触发撤销重做", () => {
        for (const key of ["z", "y"]) expect(resolveDirectorShortcut(press({ key }))).toBeNull();
    });
});

describe("修饰键与未知键边界", () => {
    test("Alt 组合一律不解析，留给系统", () => {
        expect(resolveDirectorShortcut(press({ key: "w", altKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, altKey: true }))).toBeNull();
    });

    test("未映射的键返回 null", () => {
        for (const key of ["q", "1", "ArrowUp", "Tab", "", "F5"]) {
            expect(resolveDirectorShortcut(press({ key }))).toBeNull();
        }
    });
});

describe("交互控件语境不劫持按键", () => {
    test("isInteractiveTarget 为真时所有快捷键都不解析", () => {
        for (const key of ["w", "Delete", "Backspace", "h", "Escape", " "]) {
            expect(resolveDirectorShortcut(press({ key, isInteractiveTarget: true }))).toBeNull();
        }
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, isInteractiveTarget: true }))).toBeNull();
    });

    test("文本输入控件判为交互语境", () => {
        expect(isDirectorInteractiveNode({ tagName: "INPUT" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "textarea" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "SELECT" })).toBe(true);
        expect(isDirectorInteractiveNode({ isContentEditable: true })).toBe(true);
    });

    test("BUTTON 与 A 判为交互语境：Space/Delete 属于控件自己", () => {
        expect(isDirectorInteractiveNode({ tagName: "BUTTON" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "button" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "A" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "OPTION" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "LABEL" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "SUMMARY" })).toBe(true);
    });

    test("常见 role 型控件判为交互语境", () => {
        const roles = ["textbox", "combobox", "spinbutton", "searchbox", "button", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "checkbox", "radio", "link", "listbox", "menu", "radiogroup", "treeitem"];
        for (const role of roles) {
            expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "role" ? role : null) })).toBe(true);
        }
    });

    test("contenteditable 属性形式也判为交互语境", () => {
        for (const value of ["", "true"]) {
            expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? value : null) })).toBe(true);
        }
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? "false" : null) })).toBe(false);
    });

    test("普通元素、未知 role 与非法目标不判为交互语境", () => {
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: () => null })).toBe(false);
        expect(isDirectorInteractiveNode({ tagName: "SPAN" })).toBe(false);
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: () => "presentation" })).toBe(false);
        expect(isDirectorInteractiveNode(null)).toBe(false);
        expect(isDirectorInteractiveNode(undefined)).toBe(false);
        expect(isDirectorInteractiveNode("input")).toBe(false);
    });
});

describe("blocksDirectorShortcut：交互祖先同样阻止全局快捷键", () => {
    test("有 closest 时用选择器向上找，命中祖先即阻止", () => {
        // 按钮里的 <svg>/<span>：event.target 是子元素，只判自身会漏掉整个控件。
        const queried: string[] = [];
        const nestedChild = {
            tagName: "svg",
            closest: (selector: string) => {
                queried.push(selector);
                return { tagName: "BUTTON" };
            },
        };
        expect(blocksDirectorShortcut(nestedChild)).toBe(true);
        expect(queried).toEqual([DIRECTOR_INTERACTIVE_SELECTOR]);
    });

    test("closest 没命中交互祖先时放行", () => {
        const plainChild = { tagName: "SPAN", closest: () => null };
        expect(blocksDirectorShortcut(plainChild)).toBe(false);
    });

    test("选择器覆盖标签、role 与 contenteditable 三类", () => {
        for (const fragment of ["button", "a", "input", "textarea", "select", "option", "label", "summary"]) {
            expect(DIRECTOR_INTERACTIVE_SELECTOR.split(",")).toContain(fragment);
        }
        for (const role of ["button", "switch", "tab", "menuitem", "option", "slider", "checkbox", "radio"]) {
            expect(DIRECTOR_INTERACTIVE_SELECTOR).toContain(`[role="${role}"]`);
        }
        expect(DIRECTOR_INTERACTIVE_SELECTOR).toContain('[contenteditable="true"]');
    });

    test("没有 closest 的目标退化为单节点判定", () => {
        expect(blocksDirectorShortcut({ tagName: "BUTTON" })).toBe(true);
        expect(blocksDirectorShortcut({ tagName: "DIV", getAttribute: () => null })).toBe(false);
        expect(blocksDirectorShortcut(null)).toBe(false);
        expect(blocksDirectorShortcut("button")).toBe(false);
    });

    test("普通 DIV 容器仍允许全局快捷键：视口空白处按 W/Delete 必须生效", () => {
        const viewportBackdrop = { tagName: "DIV", closest: () => null };
        expect(blocksDirectorShortcut(viewportBackdrop)).toBe(false);
        expect(resolveDirectorShortcut(press({ key: "w", isInteractiveTarget: blocksDirectorShortcut(viewportBackdrop) }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(viewportBackdrop) }))).toEqual({ kind: "delete-selected" });
    });
});

describe("releaseDirectorFocusAfterPointer：点完工具按钮后快捷键必须立刻可用", () => {
    const fakeButton = () => {
        let blurred = 0;
        return {
            blur: () => {
                blurred += 1;
            },
            blurCount: () => blurred,
        };
    };

    test("鼠标激活（detail > 0）释放焦点", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 1, currentTarget: target });
        expect(target.blurCount()).toBe(1);
    });

    test("键盘激活（detail === 0）保留焦点，Tab 序列不断", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 0, currentTarget: target });
        expect(target.blurCount()).toBe(0);
    });

    test("双击等多次点击仍然释放焦点", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 2, currentTarget: target });
        expect(target.blurCount()).toBe(1);
    });

    test("目标没有 blur 方法时不抛异常", () => {
        expect(() => releaseDirectorFocusAfterPointer({ detail: 1, currentTarget: {} })).not.toThrow();
    });

    test("释放焦点后守卫不再拦截：这正是修复的行为", () => {
        // 焦点在按钮上 -> 拦截；释放到视口容器 -> 放行。
        const button = { tagName: "BUTTON", closest: () => ({ tagName: "BUTTON" }) };
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(button) }))).toBeNull();

        const bodyAfterBlur = { tagName: "BODY", closest: () => null };
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(bodyAfterBlur) }))).toEqual({ kind: "delete-selected" });
    });
});
