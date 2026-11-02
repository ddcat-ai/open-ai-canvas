import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "HTMLTextAreaElement", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MentionMenu } = await import("../../src/components/canvas/canvas-mention-menu");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { buildToolMentionReference, canvasResourceMentionToken } = await import("../../src/lib/canvas/canvas-resource-references");
const { serializeEditableValue } = await import("../../src/components/canvas/canvas-mention-editable");
const { getNineGridMenuItems } = await import("../../src/components/canvas/canvas-image-toolbar-tools");
afterAll(() => dom.happyDOM.abort());

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
