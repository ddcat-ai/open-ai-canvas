import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CommerceImageTransfer } from "@/pages/ecommerce/image-transfer";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    DOMParser: dom.DOMParser,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ReferenceUploader } = await import("@/pages/ecommerce/reference-uploader");
let host: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    host = undefined;
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function sourceTransfer(files: File[], data: Record<string, string> = {}) {
    return { files, items: [], types: [...(files.length ? ["Files"] : []), ...Object.keys(data)], getData: (type: string) => data[type] || "" } as unknown as DataTransfer;
}
async function render(options: { onTransfer?: (source: CommerceImageTransfer) => Promise<void>; uploading?: boolean } = {}) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const imported = mock(options.onTransfer || (async (_source: CommerceImageTransfer) => {}));
    const upload = mock(async (_files: File[]) => {});
    await act(async () => root!.render(<ReferenceUploader references={[]} uploading={options.uploading || false} onTransfer={imported} onUpload={upload} onChange={() => {}} />));
    return { imported, upload, zone: host.querySelector("section")! };
}
async function dispatch(target: Element, type: string, transfer: DataTransfer) {
    const event = new dom.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: transfer });
    await act(async () => target.dispatchEvent(event as unknown as Event));
    return event;
}

test("a native file drop is consumed once and drag highlighting clears", async () => {
    const { imported, zone } = await render();
    const image = new File(["image"], "wechat.png");
    const transfer = sourceTransfer([image]);
    expect((await dispatch(zone, "dragenter", transfer)).defaultPrevented).toBe(true);
    expect(zone.classList.contains("is-dragging")).toBe(true);
    expect((await dispatch(zone, "drop", transfer)).defaultPrevented).toBe(true);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(imported.mock.calls[0][0].files).toEqual([image]);
    expect(zone.classList.contains("is-dragging")).toBe(false);
});

test("focused upload region accepts image paste but preserves ordinary text editing", async () => {
    const { imported, zone } = await render();
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    expect((await dispatch(zone, "paste", sourceTransfer([image]))).defaultPrevented).toBe(true);
    const textarea = document.createElement("textarea");
    zone.append(textarea);
    expect((await dispatch(textarea, "paste", sourceTransfer([image]))).defaultPrevented).toBe(false);
    expect((await dispatch(zone, "paste", sourceTransfer([], { "text/plain": "这是一段商品文案" }))).defaultPrevented).toBe(false);
    expect(imported).toHaveBeenCalledTimes(1);
});

test("a second drop is blocked while an import is pending and errors remain visible", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const { imported, zone } = await render({
        onTransfer: async () =>
            await new Promise<void>((_resolve, rejectPromise) => {
                reject = rejectPromise;
            }),
    });
    const transfer = sourceTransfer([new File(["image"], "file.png")]);
    await dispatch(zone, "drop", transfer);
    expect(zone.getAttribute("aria-busy")).toBe("true");
    await dispatch(zone, "drop", transfer);
    expect(imported).toHaveBeenCalledTimes(1);
    await act(async () => reject!(new Error("图片无权访问")));
    expect(zone.getAttribute("aria-busy")).toBe("false");
    expect(zone.querySelector('[role="alert"]')?.textContent).toBe("图片无权访问");
});

test("file picker snapshots selected files before clearing input for reuse", async () => {
    const { upload } = await render();
    const input = host!.querySelector('input[type="file"]')!;
    const file = new File(["image"], "selected.png");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(upload.mock.calls[0][0]).toEqual([file]);
    expect((input as HTMLInputElement).value).toBe("");
});
