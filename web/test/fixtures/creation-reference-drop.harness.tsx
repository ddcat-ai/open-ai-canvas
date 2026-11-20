import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";

const dom = new Window({ url: "http://localhost/create" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationComposer } = await import("../../src/pages/create/creation-workspace");
const { defaultConfig } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { CREATION_IMAGE_DRAG_TYPE } = await import("../../src/pages/create/creation-reference-drop");
const { buildCreationMentionReferences } = await import("../../src/pages/create/creation-references");
const { canvasResourceMentionToken } = await import("../../src/lib/canvas/canvas-resource-references");
afterAll(() => dom.happyDOM.abort());

test("文件与生成图片拖到编辑区均追加；标签替换只消费一次；忙碌时不接收", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const drops: unknown[] = [],
        replacements: unknown[] = [];
    const noop = () => {};
    const capability = defaultModelCapabilityConfig();
    const props: ComponentProps<typeof CreationComposer> = {
        variant: "thread",
        mode: "image",
        prompt: "",
        setPrompt: noop,
        busy: false,
        generationActive: false,
        referenceReplacementBusy: false,
        referenceDropBusy: false,
        onReferenceDrop: (drop) => drops.push(drop),
        attachments: [],
        maxReferences: 3,
        references: [],
        onRemoveAttachment: noop,
        onClearAttachments: noop,
        onClearComposer: noop,
        onReorderAttachments: noop,
        onReplaceAttachment: noop,
        onReplaceReferenceFiles: (...args) => replacements.push(args),
        onOpenLibrary: noop,
        onModeChange: noop,
        model: "",
        modelRequirements: {},
        videoProfile: capability.video!,
        imageProfile: capability.image!,
        config: defaultConfig,
        onModelChange: noop,
        ratio: "1:1",
        setRatio: noop,
        seconds: "5",
        setSeconds: noop,
        quality: "auto",
        setQuality: noop,
        imageResolution: "auto",
        setImageResolution: noop,
        setImageParameters: noop,
        setTransparentBackground: noop,
        videoQuality: "720",
        setVideoQuality: noop,
        count: "1",
        setCount: noop,
        textStreaming: true,
        setTextStreaming: noop,
        textThinkingLevels: [],
        textThinkingLevel: "",
        textThinkingRequest: "auto",
        setTextThinkingLevel: noop,
        promptOptimizerProvider: null,
        composerFocusRef: { current: null },
        onPromptFocus: noop,
        onSubmit: noop,
    };
    const fire = async (target: Element, type: string, transfer: unknown) => {
        const event = new dom.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: transfer });
        await act(async () => target.dispatchEvent(event as unknown as Event));
        return event.defaultPrevented;
    };
    const file = new File(["png"], "reference.png", { type: "image/png" });
    const transfer = { types: ["Files"], files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }], getData: () => "", dropEffect: "none" };
    try {
        await act(async () => root.render(<CreationComposer {...props} />));
        const editor = host.querySelector("textarea, [contenteditable]")!;
        expect(await fire(editor, "dragover", transfer)).toBe(true);
        expect(host.textContent).toContain("松开添加参考图");
        expect(await fire(editor, "drop", transfer)).toBe(true);
        expect(drops).toEqual([{ kind: "files", files: [file] }]);
        await fire(editor, "drop", { types: [CREATION_IMAGE_DRAG_TYPE], files: [], items: [], getData: () => JSON.stringify({ messageId: "done", resultKey: "resource:image" }) });
        expect(drops[1]).toEqual({ kind: "result", image: { messageId: "done", resultKey: "resource:image" } });
        const attachment = { id: "image", name: "old.png", type: "image/png", dataUrl: "/old.png", previewUrl: "/old.png" };
        const references = buildCreationMentionReferences([], [attachment]);
        await act(async () => root.render(<CreationComposer {...props} attachments={[attachment]} references={references} prompt={canvasResourceMentionToken(references[0])} />));
        const chip = host.querySelector("[data-mention-reference-id]")!;
        expect(chip).not.toBeNull();
        await fire(chip, "drop", transfer);
        expect(replacements).toHaveLength(1);
        expect(drops).toHaveLength(2);
        await act(async () => root.render(<CreationComposer {...props} referenceDropBusy />));
        await fire(host.querySelector(".creation-chat-composer")!, "drop", transfer);
        expect(drops).toHaveLength(2);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
