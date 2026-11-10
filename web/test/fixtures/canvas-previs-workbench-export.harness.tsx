import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { PrevisCanvasExport, PrevisScene } from "@/types/previs";
import type { PrevisViewportHandle } from "@/components/canvas/previs/previs-viewport";

const dom = new Window({ url: "http://localhost/canvas/previs-ui-test" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const React = await import("react");
const { act, forwardRef, useImperativeHandle } = React;
const { createRoot } = await import("react-dom/client");
const antd = await import("antd");
const silent = () => {};
const message = { success: mock(silent), warning: mock(silent), error: mock(silent), info: mock(silent) };
const capture = mock<PrevisViewportHandle["capture"]>(async () => new Blob(["captured frame"], { type: "image/png" }));
const download = mock((_blob: Blob, _name: string) => {});
const createUrl = mock((_blob: Blob) => `blob:previs-preview-${++urlSequence}`);
const revokeUrl = mock((_url: string) => {});
let urlSequence = 0;
const originalCreateUrl = URL.createObjectURL;
const originalRevokeUrl = URL.revokeObjectURL;
URL.createObjectURL = createUrl;
URL.revokeObjectURL = revokeUrl;
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message, modal: { confirm: silent } }) } }));
mock.module("file-saver", () => ({ saveAs: download }));
// Only render-heavy children and browser media boundaries are replaced. The workbench,
// AntD controls, prompt compiler, save coordinator and workbench store are real.
mock.module("@/components/canvas/previs/previs-viewport", () => ({
    PrevisViewport: forwardRef((_props, ref) => {
        useImperativeHandle(ref, () => ({ capture }), []);
        return <div data-testid="viewport-boundary" />;
    }),
}));
mock.module("@/components/canvas/previs/previs-inspectors", () => ({
    cameraMoveOptions: [],
    poseEditBones: [],
    shotSizeOptions: [],
    poseOptions: [],
    BoneRotationFields: () => null,
    ObjectInspector: () => null,
    LightInspector: () => null,
    ShotInspector: () => null,
}));
mock.module("@/components/canvas/previs/previs-canvas-dock", () => ({ PrevisCanvasDock: () => null }));
mock.module("@/components/canvas/previs/previs-add-dialog", () => ({ PrevisAddDialog: () => null }));
mock.module("@/components/canvas/previs/previs-sequencer", () => ({ PrevisSequencer: () => null }));
mock.module("@/components/canvas/previs/canvas-previs-onboarding", () => ({ CanvasPrevisOnboarding: () => null }));
mock.module("@/lib/canvas/canvas-video-merge", () => ({
    transcodeVideoToMp4: async () => {
        throw new Error("Unexpected video export");
    },
}));

const { CanvasPrevisWorkbench } = await import("@/components/canvas/previs/canvas-previs-workbench");
const { usePrevisWorkbenchStore } = await import("@/stores/canvas/use-previs-workbench-store");
const { createPrevisSceneFromTemplate } = await import("@/lib/canvas/previs/previs-templates");
const { compilePrevisPrompt } = await import("@/lib/canvas/previs/previs-prompt-compiler");
const addToCanvas = mock(async (_output: PrevisCanvasExport) => {});
const apply = mock(async () => {});
let scene: PrevisScene;
let open: boolean;
let canvasId: string;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}
async function render() {
    await act(async () => root!.render(<CanvasPrevisWorkbench open={open} canvasId={canvasId} scene={scene} imageNodes={[]} onboardingScope="" onClose={silent} onChange={silent} onApply={apply} onAddToCanvas={addToCanvas} onDeleteImageNode={silent} />));
}
function screenshotButton() {
    const button = container.querySelector<HTMLButtonElement>('button[title^="截图："]');
    expect(button).not.toBeNull();
    return button!;
}
function preview() {
    return container.querySelector<HTMLElement>('[aria-label="最新镜头截图"]');
}
function previewButton() {
    const button = preview()?.querySelector<HTMLButtonElement>("button");
    expect(button).toBeDefined();
    return button!;
}
async function click(button: HTMLButtonElement) {
    await act(async () => button.click());
}
async function invalidate(kind: "close" | "scene switch" | "canvas switch" | "unmount") {
    if (kind === "unmount") {
        await act(async () => root!.unmount());
        root = undefined;
    } else {
        if (kind === "close") open = false;
        else if (kind === "scene switch") scene = createPrevisSceneFromTemplate("empty", "另一个场景");
        else canvasId = "another-canvas";
        await render();
    }
}

beforeEach(async () => {
    scene = createPrevisSceneFromTemplate("empty", "雨夜街角");
    scene.shots[0] = { ...scene.shots[0], name: "镜头 A", duration: 7.5, fps: 24, prompt: "雨滴落在窗边，主角缓慢回头。" };
    scene.shots.push({ ...scene.shots[0], id: "second-shot", name: "镜头 B", duration: 12, prompt: "镜头 B 使用不同动作与描述。" });
    canvasId = "previs-ui-test";
    open = true;
    urlSequence = 0;
    for (const fn of [capture, download, createUrl, revokeUrl, addToCanvas, apply, ...Object.values(message)]) fn.mockClear();
    capture.mockImplementation(async () => new Blob(["captured frame"], { type: "image/png" }));
    addToCanvas.mockImplementation(async () => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    container.remove();
});
afterAll(() => {
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
    mock.restore();
    dom.happyDOM.abort();
});

test("the real prompt button sends the current compiled text without capturing or downloading", async () => {
    const prompt = compilePrevisPrompt(scene, scene.shots[0]);
    expect(container.querySelector(".pv-prompt-preview__text")?.textContent).toBe(prompt);
    await click(container.querySelector<HTMLButtonElement>('[aria-label="将镜头提示词加入画布"]')!);
    expect(addToCanvas).toHaveBeenCalledTimes(1);
    expect(addToCanvas.mock.calls[0][0]).toEqual({ kind: "prompt", sceneId: scene.id, shotId: scene.shots[0].id, title: "镜头 A", prompt });
    expect(capture).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
});

test("screenshot click freezes shot, prompt, duration, render mode and timecode before awaiting capture", async () => {
    const pending = deferred<Blob>();
    capture.mockImplementationOnce(() => pending.promise);
    const prompt = compilePrevisPrompt(scene, scene.shots[0]);
    await act(async () => usePrevisWorkbenchStore.getState().setPlayhead(2.5));
    await act(async () => {
        screenshotButton().click();
        screenshotButton().click();
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(screenshotButton().disabled).toBe(true);
    expect(preview()).toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(capture.mock.calls[0][0]).toBe("beauty");
    expect(capture.mock.calls[0][1]?.signal?.aborted).toBe(false);
    const otherShot = Array.from(container.querySelectorAll<HTMLButtonElement>(".pv-shot-list__item")).find((button) => button.textContent?.includes("镜头 B"))!;
    await click(otherShot);
    await act(async () => {
        usePrevisWorkbenchStore.getState().setRenderMode("clay");
        usePrevisWorkbenchStore.getState().setPlayhead(5);
    });
    const blob = new Blob(["snapshot A"], { type: "image/png" });
    await act(async () => {
        pending.resolve(blob);
        await pending.promise;
    });
    expect(screenshotButton().disabled).toBe(false);
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0]).toBe(blob);
    expect(download.mock.calls[0][1]).toContain("镜头 A");
    expect(download.mock.calls[0][1]).toContain("000212");
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe("blob:previs-preview-1");
    expect(preview()?.textContent).toContain("00:02:12");
    expect(preview()?.textContent).toContain("镜头 A");
    expect(addToCanvas).not.toHaveBeenCalled();
    await click(previewButton());
    expect(addToCanvas).toHaveBeenCalledTimes(1);
    expect(addToCanvas.mock.calls[0][0]).toMatchObject({ kind: "screenshot", sceneId: scene.id, shotId: scene.shots[0].id, prompt, image: blob, renderMode: "beauty", duration: 7.5, timecode: "00:02:12" });
    expect(previewButton().textContent).toContain("已加入画布");
    expect(previewButton().disabled).toBe(true);
    expect(revokeUrl).not.toHaveBeenCalled();
    await click(previewButton());
    expect(addToCanvas).toHaveBeenCalledTimes(1);
});

test("failed add keeps the same preview for retry and blocks duplicate clicks while awaiting insertion", async () => {
    await click(screenshotButton());
    const url = preview()?.querySelector("img")?.getAttribute("src");
    const failed = deferred<void>();
    addToCanvas.mockImplementationOnce(() => failed.promise);
    await act(async () => {
        previewButton().click();
        previewButton().click();
    });
    expect(addToCanvas).toHaveBeenCalledTimes(1);
    expect(previewButton().disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="将镜头提示词加入画布"]')?.disabled).toBe(true);
    await act(async () => {
        failed.reject(new Error("资产登记失败，可重试"));
        await failed.promise.catch(silent);
    });
    expect(message.error).toHaveBeenCalledWith("资产登记失败，可重试");
    expect(previewButton().disabled).toBe(false);
    expect(previewButton().textContent).toContain("加入画布做图生视频");
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(revokeUrl).not.toHaveBeenCalled();
    await click(previewButton());
    expect(addToCanvas).toHaveBeenCalledTimes(2);
    expect(addToCanvas.mock.calls[1][0]).toBe(addToCanvas.mock.calls[0][0]);
    expect(previewButton().textContent).toContain("已加入画布");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
});

test("capture failure clears busy state and retry produces the preview without an early canvas insertion", async () => {
    capture.mockImplementationOnce(async () => {
        throw new Error("GPU capture failed");
    });
    await click(screenshotButton());
    expect(message.error).toHaveBeenCalledWith("GPU capture failed");
    expect(screenshotButton().disabled).toBe(false);
    expect(preview()).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(addToCanvas).not.toHaveBeenCalled();
    await click(screenshotButton());
    expect(capture).toHaveBeenCalledTimes(2);
    expect(preview()).not.toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    expect(addToCanvas).not.toHaveBeenCalled();
});

test("replacing a screenshot releases only the old URL and unmount releases the final URL once", async () => {
    await click(screenshotButton());
    await click(previewButton());
    expect(revokeUrl).not.toHaveBeenCalled();
    await click(screenshotButton());
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe("blob:previs-preview-2");
    expect(previewButton().disabled).toBe(false);
    expect(revokeUrl.mock.calls).toEqual([["blob:previs-preview-1"]]);
    await invalidate("unmount");
    expect(revokeUrl.mock.calls).toEqual([["blob:previs-preview-1"], ["blob:previs-preview-2"]]);
});

for (const invalidation of ["close", "scene switch", "canvas switch"] as const) {
    test(`${invalidation} discards the screenshot preview and revokes its URL`, async () => {
        await click(screenshotButton());
        await invalidate(invalidation);
        expect(preview()).toBeNull();
        expect(revokeUrl.mock.calls).toEqual([["blob:previs-preview-1"]]);
        expect(addToCanvas).not.toHaveBeenCalled();
    });
}

for (const invalidation of ["close", "scene switch", "canvas switch", "unmount"] as const) {
    test(`${invalidation} aborts capture and ignores a late blob without allocating a URL or downloading`, async () => {
        const pending = deferred<Blob>();
        capture.mockImplementationOnce(() => pending.promise);
        await click(screenshotButton());
        const signal = capture.mock.calls[0][1]?.signal;
        expect(signal?.aborted).toBe(false);
        await invalidate(invalidation);
        expect(signal?.aborted).toBe(true);
        await act(async () => {
            pending.resolve(new Blob(["late frame"], { type: "image/png" }));
            await pending.promise;
        });
        expect(preview()).toBeNull();
        expect(createUrl).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        expect(addToCanvas).not.toHaveBeenCalled();
        expect(message.error).not.toHaveBeenCalled();
    });
}
