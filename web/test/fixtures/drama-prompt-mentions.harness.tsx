import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaSegmentReference } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "HTMLTextAreaElement", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { renderEditableContent, serializeEditableValue, serializeEditableSelection, setEditableSelection, getEditableSelection } = await import("../../src/components/canvas/canvas-mention-editable");
const { buildDramaPromptReferences } = await import("../../src/lib/drama/asset-references");

const segmentReferences: DramaSegmentReference[] = [
    { castId: "lin", label: "参考图1", name: "林朗", kind: "character", sent: true },
    { castId: "market", label: "参考图2", name: "夜市", kind: "scene", sent: true },
    { castId: "note", label: "参考图3", name: "纸条", kind: "prop", sent: true },
];

afterAll(() => dom.happyDOM.abort());

test("造型使用独立名称，同名资产显示编号以避免误认", () => {
    const cast = new Map([
        ["day", { id: "day", name: "林朗", lookName: "日常服装" } as DramaCast],
        ["night", { id: "night", name: "林朗", lookName: "夜行服装" } as DramaCast],
    ]);
    const references = buildDramaPromptReferences(
        [
            { ...segmentReferences[0], castId: "day" },
            { ...segmentReferences[0], castId: "night", label: "参考图2" },
            { castId: "gate", label: "参考图3", name: "城门", kind: "scene", sent: true },
            { castId: "model", label: "参考图4", name: "城门", kind: "prop", sent: true },
        ],
        cast,
    );
    expect(references.map((reference) => reference.displayLabel)).toEqual(["参考图1 · 林朗 · 日常服装", "参考图2 · 林朗 · 夜行服装", "参考图3 · 城门", "参考图4 · 城门"]);
    expect(references.map((reference) => reference.mentionToken)).toEqual(["参考图1", "参考图2", "参考图3", "参考图4"]);
});

test("彩色资产名称、类别和缩略图不进入提交正文或复制文本", () => {
    const references = buildDramaPromptReferences(segmentReferences, new Map());
    const editor = document.createElement("div");
    document.body.append(editor);
    const prompt = "参考图1走入参考图2，拿起参考图3。参考图10仍需核对。";
    try {
        renderEditableContent(editor, prompt, references);
        expect(serializeEditableValue(editor)).toBe(prompt);
        expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(3);
        expect(editor.textContent).toContain("林朗角色");
        expect(editor.textContent).toContain("夜市环境");
        expect(editor.textContent).toContain("纸条道具");
        expect(editor.querySelector<HTMLElement>('[data-mention-token="参考图1"]')?.dataset.assetKind).toBe("character");
        expect(editor.querySelector<HTMLElement>('[data-mention-token="参考图2"]')?.dataset.assetKind).toBe("scene");
        expect(editor.querySelector<HTMLElement>('[data-mention-token="参考图3"]')?.dataset.assetKind).toBe("prop");
        setEditableSelection(editor, 0, prompt.length);
        expect(serializeEditableSelection(editor)).toBe(prompt);

        renderEditableContent(editor, "@参考图1 在参考图2 等待。", references);
        expect(serializeEditableValue(editor)).toBe("参考图1 在参考图2 等待。");
        expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(2);
    } finally {
        editor.remove();
    }
});

test("真实编辑器改名保留令牌和光标，继续编辑仅保存正文", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let references = buildDramaPromptReferences(segmentReferences, new Map());
    let value = "参考图1在参考图2。";
    const writes: string[] = [];
    const render = () =>
        root.render(
            <CanvasResourceMentionTextarea
                value={value}
                references={references}
                onChange={(next) => {
                    value = next;
                    writes.push(next);
                    render();
                }}
                aria-label="完整视频提示词"
            />,
        );
    try {
        await act(async () => render());
        const editor = host.querySelector<HTMLElement>('[role="textbox"]')!;
        editor.focus();
        setEditableSelection(editor, 4);
        references = buildDramaPromptReferences([{ ...segmentReferences[0], name: "林朗 · 雨衣" }, ...segmentReferences.slice(1)], new Map());
        await act(async () => render());
        expect(editor.textContent).toContain("林朗 · 雨衣");
        expect(serializeEditableValue(editor)).toBe(value);
        expect(getEditableSelection(editor)).toEqual({ start: 4, end: 4 });
        expect(writes).toEqual([]);
        await act(async () => {
            editor.append(document.createTextNode("抬头看向远处。"));
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true }));
        });
        expect(writes.at(-1)).toBe("参考图1在参考图2。抬头看向远处。");
        expect(writes.at(-1)).not.toContain("林朗");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("从 @ 菜单按资产名称选择时插入模型可识别的参考图编号", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const references = buildDramaPromptReferences(segmentReferences, new Map());
    let value = "";
    const render = () =>
        root.render(
            <CanvasResourceMentionTextarea
                value={value}
                references={references}
                onChange={(next) => {
                    value = next;
                    render();
                }}
                aria-label="完整视频提示词"
                mentionMenuLabels={{ connected: "本段资产" }}
            />,
        );
    try {
        await act(async () => render());
        const editor = host.querySelector<HTMLElement>('[role="textbox"]')!;
        await act(async () => {
            editor.focus();
            editor.textContent = "@夜市";
            setEditableSelection(editor, 3);
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true }));
        });
        const menu = document.querySelector<HTMLElement>("[data-canvas-resource-mention-menu]");
        expect(menu).not.toBeNull();
        const choice = [...menu!.querySelectorAll<HTMLButtonElement>("button[data-asset-kind]")].find((button) => button.textContent?.includes("夜市"));
        expect(choice?.dataset.assetKind).toBe("scene");
        expect(choice?.textContent).toContain("环境");
        await act(async () => choice!.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
        expect(value).toBe("参考图2 ");
        expect(serializeEditableValue(editor)).toBe("参考图2 ");
        expect(editor.textContent).toContain("夜市");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
