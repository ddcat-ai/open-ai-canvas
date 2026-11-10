import assert from "node:assert/strict";
import { mock } from "bun:test";
import { Window } from "happy-dom";
const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
// 只替换媒体加载，不替换真实版本面板、大图或事件处理。
const loader = await import("../../src/services/canvas-image-loader");
mock.module("@/services/canvas-image-loader", () => ({ ...loader, prepareCanvasImage: async () => {} }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { CanvasMediaVersionModal } = await import("../../src/components/canvas/canvas-media-version-modal");
const { CanvasNodeType } = await import("../../src/types/canvas");
const image = (width: number, height: number) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`);
const versions = [image(300, 500), image(600, 300)].map((content, index) => ({ id: `v${index + 1}`, number: index + 1, createdAt: "2026-11-10T00:00:00Z", source: "upload" as const, media: { content } }));
const node = { id: "node", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 300, height: 500, metadata: { content: versions[1].media.content, currentMediaVersionId: "v2", mediaVersions: versions } };
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let closeCount = 0,
    adoptCount = 0;
try {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <CanvasMediaVersionModal
                    node={node}
                    onClose={() => closeCount++}
                    onAdopt={() => {
                        adoptCount++;
                        return true;
                    }}
                    onDelete={() => true}
                    onExtract={() => {}}
                />
            </ConfigProvider>,
        ),
    );
    const thumb = document.querySelector<HTMLButtonElement>('[data-version-id="v1"]')!;
    await act(async () => thumb.click());
    const stage = () => document.querySelector<HTMLImageElement>(".canvas-version-stage img")!;
    assert.equal(stage().src, versions[0].media.content);
    assert.match(stage().className, /object-contain/);
    for (const thumbImage of document.querySelectorAll('[role="option"] img')) assert.match(thumbImage.className, /object-contain/);
    await act(async () => stage().dispatchEvent(new dom.MouseEvent("dblclick", { bubbles: true }) as unknown as Event));
    const enlarged = document.querySelector<HTMLImageElement>(".canvas-image-preview-modal img")!;
    assert.ok(enlarged);
    assert.equal(enlarged.src, versions[0].media.content);
    await act(async () => enlarged.dispatchEvent(new dom.Event("load") as unknown as Event));
    enlarged.parentElement!.getBoundingClientRect = () => new dom.DOMRect(0, 0, 600, 400) as unknown as DOMRect;
    const wheel = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    Object.assign(wheel, { clientX: 300, clientY: 200 });
    await act(async () => enlarged.dispatchEvent(wheel as unknown as Event));
    assert.ok(Number(enlarged.style.transform.match(/scale\(([^)]+)\)/)![1]) > 1);
    const wrap = document.querySelector<HTMLElement>(".canvas-image-preview-modal")!.closest(".ant-modal-wrap")!;
    await act(async () => wrap.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "Escape", keyCode: 27 }) as unknown as Event));
    assert.equal(Boolean(document.querySelector(".canvas-image-preview-modal")), false);
    assert.equal(closeCount, 0);
    assert.equal(adoptCount, 0);
    assert.equal(thumb.getAttribute("aria-selected"), "true");
    assert.equal(stage().src, versions[0].media.content);
    await act(async () => document.querySelector<HTMLButtonElement>(".canvas-version-stage button")!.click());
    assert.ok(document.querySelector(".canvas-image-preview-modal"));
    await act(async () => document.querySelector<HTMLButtonElement>(".canvas-image-preview-modal .ant-modal-close")!.click());
    assert.equal(Boolean(document.querySelector(".canvas-image-preview-modal")), false);
    assert.equal(closeCount, 0);
    assert.equal(thumb.getAttribute("aria-selected"), "true");
    console.log("version preview: passed");
} finally {
    await act(async () => root.unmount());
    host.remove();
    dom.happyDOM.abort();
}
