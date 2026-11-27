import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";
import type { CanvasResourceMentionTextareaActions } from "../../src/components/canvas/canvas-resource-mention-textarea";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "HTMLTextAreaElement", "SVGElement", "ShadowRoot", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MentionMenu } = await import("../../src/components/canvas/canvas-mention-menu");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { buildToolMentionReference, canvasResourceMentionToken } = await import("../../src/lib/canvas/canvas-resource-references");
const { renderEditableContent, serializeEditableValue, setEditableSelection, getEditableSelection } = await import("../../src/components/canvas/canvas-mention-editable");
const { getNineGridMenuItems } = await import("../../src/components/canvas/canvas-image-toolbar-tools");
const { CanvasNineGridPicker } = await import("../../src/components/canvas/canvas-nine-grid-picker");
const { ConfigProvider } = await import("antd");
afterAll(() => dom.happyDOM.abort());

test("添加素材直接展示未连接的画布视频，选择后建立引用", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions = { current: null as CanvasResourceMentionTextareaActions | null };
    const reference: CanvasResourceReference = { id: "video", nodeId: "video", kind: "video", label: "视频1", title: "画布原片", displayLabel: "画布原片", active: false };
    const selected: string[] = [];
    const writes: string[] = [];
    try {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value="运镜"
                    references={[reference]}
                    actionsRef={actions}
                    onSelectReference={(item) => {
                        selected.push(item.id);
                        return { ...item, active: true };
                    }}
                    onChange={(next) => {
                        writes.push(next);
                    }}
                />,
            ),
        );
        await act(async () => actions.current!.openReferencePicker());
        const item = document.querySelector<HTMLButtonElement>(".canvas-resource-mention-item")!;
        expect(item?.textContent).toContain("画布原片");
        await act(async () => item.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
        expect(selected).toEqual(["video"]);
        expect(writes).toEqual([`运镜 ${canvasResourceMentionToken(reference)}`]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("异步素材选择期间继续输入时保留新正文，重复点击只读取一次", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions = { current: null as CanvasResourceMentionTextareaActions | null };
    const reference: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", title: "参考图", active: false };
    let finish!: (value: CanvasResourceReference) => void;
    const pending = new Promise<CanvasResourceReference>((resolve) => {
        finish = resolve;
    });
    let reads = 0;
    const writes: string[] = [];
    const render = (value: string) =>
        root.render(
            <CanvasResourceMentionTextarea
                value={value}
                references={[reference]}
                actionsRef={actions}
                onSelectReference={() => {
                    reads += 1;
                    return pending;
                }}
                onChange={(next) => {
                    writes.push(next);
                }}
            />,
        );
    try {
        await act(async () => render("原正文"));
        await act(async () => actions.current!.openReferencePicker());
        const item = document.querySelector<HTMLButtonElement>(".canvas-resource-mention-item")!;
        await act(async () => {
            item.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
            item.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        });
        expect(reads).toBe(1);
        await act(async () => render("用户继续输入的新正文"));
        await act(async () => finish({ ...reference, active: true }));
        expect(writes).toEqual([]);
        expect(host.querySelector("textarea")?.value).toBe("用户继续输入的新正文");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

for (const action of ["关闭菜单", "关闭后移动光标", "重新打开菜单", "切换引用位置", "卸载编辑器"] as const) {
    test(`异步选择素材期间${action}使旧请求失效`, async () => {
        const host = document.createElement("div");
        const outside = document.createElement("button");
        document.body.append(host, outside);
        const root = createRoot(host);
        const actions = { current: null as CanvasResourceMentionTextareaActions | null };
        const reference: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", title: "参考图", active: false };
        let finish!: (value: CanvasResourceReference) => void;
        const pending = new Promise<CanvasResourceReference>((resolve) => {
            finish = resolve;
        });
        const writes: string[] = [];
        let unmounted = false;
        try {
            await act(async () =>
                root.render(
                    <CanvasResourceMentionTextarea
                        value="前景远景"
                        references={[reference]}
                        actionsRef={actions}
                        onSelectReference={() => pending}
                        onChange={(next) => {
                            writes.push(next);
                        }}
                    />,
                ),
            );
            const editor = host.querySelector<HTMLTextAreaElement>("textarea")!;
            editor.focus();
            editor.setSelectionRange(2, 2);
            await act(async () => actions.current!.openReferencePicker());
            const item = document.querySelector<HTMLButtonElement>(".canvas-resource-mention-item")!;
            await act(async () => item.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
            if (action === "卸载编辑器") {
                await act(async () => root.unmount());
                unmounted = true;
            } else if (action !== "切换引用位置") {
                await act(async () => editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
                expect(document.querySelector("[data-canvas-resource-mention-menu]")).toBeNull();
            }
            if (action === "关闭后移动光标") editor.setSelectionRange(0, 0);
            if (action === "重新打开菜单" || action === "切换引用位置") {
                editor.setSelectionRange(0, 0);
                await act(async () => actions.current!.openReferencePicker());
            }
            await act(async () => outside.focus());
            await act(async () => finish({ ...reference, active: true }));
            expect(writes).toEqual([]);
            expect(document.activeElement).toBe(outside);
            if (!unmounted) expect(editor.selectionStart).toBe(action === "关闭菜单" ? 2 : 0);
            if (action === "重新打开菜单" || action === "切换引用位置") expect(document.querySelector("[data-canvas-resource-mention-menu]")).not.toBeNull();
        } finally {
            if (!unmounted) await act(async () => root.unmount());
            host.remove();
            outside.remove();
        }
    });
}

test("关闭旧菜单后可重新异步选择素材，旧请求返回不影响新会话", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions = { current: null as CanvasResourceMentionTextareaActions | null };
    const reference: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", title: "参考图", active: false };
    const finish: Array<(value: CanvasResourceReference) => void> = [];
    const writes: string[] = [];
    try {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value="前景远景"
                    references={[reference]}
                    actionsRef={actions}
                    onSelectReference={() =>
                        new Promise<CanvasResourceReference>((resolve) => {
                            finish.push(resolve);
                        })
                    }
                    onChange={(next) => {
                        writes.push(next);
                    }}
                />,
            ),
        );
        const editor = host.querySelector<HTMLTextAreaElement>("textarea")!;
        editor.focus();
        editor.setSelectionRange(2, 2);
        const select = async () => {
            await act(async () => actions.current!.openReferencePicker());
            await act(async () => document.querySelector<HTMLButtonElement>(".canvas-resource-mention-item")!.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
        };
        await select();
        await act(async () => editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        await select();
        expect(finish).toHaveLength(2);
        await act(async () => finish[0]({ ...reference, active: true }));
        expect(writes).toEqual([]);
        expect(document.querySelector("[data-canvas-resource-mention-menu]")).not.toBeNull();
        await act(async () => finish[1]({ ...reference, active: true }));
        expect(writes).toEqual([`前景 ${canvasResourceMentionToken(reference)} 远景`]);
        expect(document.querySelector("[data-canvas-resource-mention-menu]")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("提示词预设回显当前选项，改选四视图只提交一次并收起菜单", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selections: Array<[number, string, string]> = [];
    const render = (selectedToolId: number) =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <CanvasNineGridPicker
                    selectedToolId={selectedToolId}
                    onSelect={(id, label, icon) => {
                        selections.push([id, label, icon]);
                        render(id);
                    }}
                />
            </ConfigProvider>,
        );
    try {
        await act(async () => render(85));
        const trigger = host.querySelector("button")!;
        await act(async () => trigger.click());
        const option = (id: number) => document.querySelector<HTMLElement>(`[role="menuitemradio"][data-preset-id="${id}"]`)!;
        expect(option(85).getAttribute("aria-checked")).toBe("true");
        expect(option(1000089).getAttribute("aria-checked")).toBe("false");
        await act(async () => option(1000089).click());
        expect(selections).toEqual([[1000089, "角色四视图", "ContactRound"]]);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        await act(async () => trigger.click());
        expect(option(1000089).getAttribute("aria-checked")).toBe("true");
        expect(option(85).getAttribute("aria-checked")).toBe("false");
        await act(async () => option(85).focus());
        expect(document.querySelector(".canvas-tool-menu-detail")!.textContent).toContain(option(85).getAttribute("aria-description")!);
        await act(async () => option(85).dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(document.activeElement).toBe(trigger);
        await act(async () => trigger.click());
        await act(async () => trigger.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(selections).toHaveLength(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("参考栏加号复用引用菜单，取消不写入，选择时插入到光标", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions = { current: null as CanvasResourceMentionTextareaActions | null };
    const reference: CanvasResourceReference = { id: "connected", nodeId: "connected", kind: "image", label: "图片1", title: "林间回望", active: true };
    const writes: string[] = [];
    const prompt = "前景远景";
    try {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={[reference]}
                    actionsRef={actions}
                    onChange={(next) => {
                        writes.push(next);
                    }}
                />,
            ),
        );
        const editor = host.querySelector<HTMLElement>('[role="textbox"]')!;
        editor.focus();
        setEditableSelection(editor, 2);
        await act(async () => actions.current!.openReferencePicker());
        expect(document.querySelector("[data-canvas-resource-mention-menu]")).not.toBeNull();
        await act(async () => editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(document.querySelector("[data-canvas-resource-mention-menu]")).toBeNull();
        expect(writes).toEqual([]);
        await act(async () => actions.current!.openReferencePicker());
        await act(async () => editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        expect(writes).toEqual([`前景 ${canvasResourceMentionToken(reference)} 远景`]);
        expect(document.querySelector("[data-canvas-resource-mention-menu]")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("行首参考图前后都能放置光标，零宽锚点不进入提示词", () => {
    const editor = document.createElement("div");
    const image: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", active: true };
    const token = canvasResourceMentionToken(image);
    renderEditableContent(editor, `前缀${token}后缀`, [image]);

    const leadingAnchor = editor.firstChild;
    expect(leadingAnchor?.textContent).toBe("前缀");
    setEditableSelection(editor, 0);
    expect(getEditableSelection(editor)).toEqual({ start: 0, end: 0 });

    renderEditableContent(editor, token, [image]);
    expect(editor.firstChild?.textContent).toBe("\u200B");
    expect(serializeEditableValue(editor)).toBe(token);
    setEditableSelection(editor, 0);
    expect(getEditableSelection(editor)).toEqual({ start: 0, end: 0 });
    setEditableSelection(editor, token.length);
    expect(getEditableSelection(editor)).toEqual({ start: token.length, end: token.length });
});

for (const inModal of [true, false]) {
    test(`${inModal ? "放大" : "普通"}编辑器在故事板标签后显示占位提示，输入正文后隐藏且不写入内容`, async () => {
        const host = document.createElement("div");
        if (inModal) host.className = "ant-modal";
        document.body.append(host);
        const root = createRoot(host);
        const image: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", active: true };
        const writes: string[] = [];
        const presets = getNineGridMenuItems().filter((item) => item.id === "short_storyboard" || item.id === "blocking_storyboard");
        let references: CanvasResourceReference[] = [];
        let placeholder = "描述要生成的图片内容";
        const render = (value: string) =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={value}
                    references={references}
                    placeholder={placeholder}
                    onChange={(next) => {
                        writes.push(next);
                        render(next);
                    }}
                    aria-label="图片提示词"
                />,
            );
        try {
            expect(presets).toHaveLength(2);
            for (const preset of presets) {
                const tool = buildToolMentionReference(preset.toolId, preset.label, "nine_grid", preset.toolIconName);
                references = [image, tool];
                placeholder = preset.placeholder!;
                expect(placeholder).toContain(preset.id === "short_storyboard" ? "4–8" : "4–6");
                const tokens = `${canvasResourceMentionToken(image)} ${canvasResourceMentionToken(tool)} `;
                await act(async () => render(tokens));
                const editor = host.querySelector<HTMLElement>('[role="textbox"]')!;
                expect(editor.dataset.placeholder).toBe(placeholder);
                expect(editor.getAttribute("aria-placeholder")).toBe(placeholder);
                expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(2);
                expect(serializeEditableValue(editor)).toBe(tokens);
                expect(editor.textContent).not.toContain(placeholder);
                await act(async () => {
                    editor.append(document.createTextNode("女孩推开门"));
                    editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true }));
                });
                expect(editor.hasAttribute("data-placeholder")).toBe(false);
                expect(writes.at(-1)).toBe(`${tokens}女孩推开门`);
                await act(async () => render(tokens));
                expect(editor.dataset.placeholder).toBe(placeholder);
                await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true })));
                expect(editor.hasAttribute("data-placeholder")).toBe(false);
                await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionend", { bubbles: true })));
                expect(editor.dataset.placeholder).toBe(placeholder);
            }
            references = [];
            placeholder = "描述要生成的图片内容";
            await act(async () => render(""));
            expect(host.querySelector("textarea")?.placeholder).toBe(placeholder);
            expect(writes.some((value) => value.includes("描述一个 10–15 秒"))).toBe(false);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    test(inModal ? "放大弹窗保留焦点边界、搜索和资产点击" : "普通编辑仍使用 body Portal", async () => {
        const host = document.createElement("div");
        const container = document.createElement("div");
        container.className = inModal ? "ant-modal" : "inline-editor";
        container.style.pointerEvents = "none";
        const anchor = document.createElement("textarea");
        container.append(anchor);
        document.body.append(host, container);
        const root = createRoot(host);
        const reference: CanvasResourceReference = { id: "asset-1", nodeId: "asset-1", kind: "image", label: "图片1", title: "角色参考", active: true };
        const selected: string[] = [];
        let query = "";
        try {
            await act(async () =>
                root.render(
                    <MentionMenu
                        anchor={anchor}
                        connectedReferences={[reference]}
                        assetReferences={[]}
                        filteredReferences={[reference]}
                        query=""
                        cursorOffset={0}
                        preferredWidth={320}
                        onQueryChange={(value) => {
                            query = value;
                        }}
                        onClose={() => {}}
                        onSelect={(item) => selected.push(item.id)}
                    />,
                ),
            );
            const menu = document.querySelector<HTMLElement>("[data-canvas-resource-mention-menu]")!;
            expect(menu.parentElement).toBe(inModal ? container : document.body);
            expect(menu.classList.contains("pointer-events-auto")).toBe(true);
            const search = menu.querySelector("input")!;
            search.focus();
            expect(document.activeElement).toBe(search);
            expect(inModal ? container.contains(document.activeElement) : true).toBe(true);
            await act(async () => {
                Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(search, "角色");
                search.dispatchEvent(new dom.Event("input", { bubbles: true }));
            });
            expect(query).toBe("角色");
            await act(async () => menu.querySelector<HTMLButtonElement>(".canvas-resource-mention-item")!.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
            expect(selected).toEqual(["asset-1"]);
        } finally {
            await act(async () => root.unmount());
            container.remove();
            host.remove();
        }
    });
}
