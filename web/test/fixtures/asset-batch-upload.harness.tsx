import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AssetFolder } from "../../src/services/api/user-data";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Node: dom.Node,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const uploaded = { url: "blob:fixture", storageKey: "fixture", width: 32, height: 32, bytes: 1, mimeType: "image/png" };
const uploadImage = mock(async (_file: File) => uploaded);
const flush = mock(async () => {});
const sync = mock(async () => {});
const addAsset = mock((_value: { title: string; folderId?: string }) => "fixture-asset");

mock.module("../../src/services/image-storage", () => ({ uploadImage }));
mock.module("../../src/services/user-data-sync", () => ({ saveRemoteUserDataNow: sync, localSavedRemotePendingMessage: (text: string) => text }));
mock.module("../../src/stores/use-asset-store", () => ({ useAssetStore: (selector: (store: { addAsset: typeof addAsset }) => unknown) => selector({ addAsset }), flushAssetStorePersistence: flush }));
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { AssetBatchUploadModal } = await import("../../src/pages/assets/asset-batch-upload-modal");
let root: ReturnType<typeof createRoot> | undefined;
const folders = [
    { id: "folder-a", name: "目录 A" },
    { id: "folder-b", name: "目录 B" },
] as AssetFolder[];
let open = true;
let folderId = "folder-a";
let completions = 0;
let completion = async () => {};

async function render() {
    if (!root) {
        const host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <AssetBatchUploadModal
                        open={open}
                        defaultFolderId={folderId}
                        folders={folders}
                        onClose={() => {
                            open = false;
                        }}
                        onComplete={async () => {
                            completions++;
                            open = false;
                            await completion();
                        }}
                    />
                </App>
            </ConfigProvider>,
        );
    });
}
const input = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const start = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => /library\.assets\.batch\.(start|retryFailed)/.test(button.textContent || ""))!;
const zone = () => document.querySelector<HTMLButtonElement>(".batch-upload-dropzone")!;
async function choose(name: string) {
    await act(async () => {
        Object.defineProperty(input(), "files", { configurable: true, value: [new dom.File(["image"], name, { type: "image/png" })] });
        input().dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
}
async function finishMicrotasks() {
    await act(async () => {});
}
beforeEach(() => {
    uploadImage.mockReset();
    uploadImage.mockImplementation(async () => uploaded);
    flush.mockReset();
    flush.mockImplementation(async () => {});
    sync.mockReset();
    sync.mockImplementation(async () => {});
    addAsset.mockClear();
    open = true;
    folderId = "folder-a";
    completions = 0;
    completion = async () => {};
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("上传及同步收尾期间锁定文件和分类，重复点击不会产生重复上传", async () => {
    const transfer = deferred<typeof uploaded>();
    const persistence = deferred<void>();
    const remote = deferred<void>();
    uploadImage.mockImplementation(() => transfer.promise);
    flush.mockImplementation(() => persistence.promise);
    sync.mockImplementation(() => remote.promise);
    await render();
    await choose("first.png");
    await act(async () => {
        start().click();
        start().click();
    });
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(input().disabled).toBe(true);
    expect(zone().disabled).toBe(true);
    expect(document.querySelectorAll(".ant-select-disabled")).toHaveLength(3);
    await choose("late.png");
    await act(async () => {
        const drop = new dom.Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", { value: { files: [new dom.File(["image"], "dropped.png", { type: "image/png" })] } });
        zone().dispatchEvent(drop);
    });
    expect(document.querySelectorAll(".batch-upload-item")).toHaveLength(1);
    await act(async () => transfer.resolve(uploaded));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(0);
    expect(input().disabled).toBe(true);
    await act(async () => persistence.resolve());
    expect(sync).toHaveBeenCalledTimes(1);
    expect(completions).toBe(0);
    expect(input().disabled).toBe(true);
    await act(async () => remote.resolve());
    expect(completions).toBe(1);
    expect(addAsset.mock.calls[0][0].folderId).toBe("folder-a");
    expect(document.querySelectorAll(".batch-upload-item")).toHaveLength(0);
});

test("失败项保留并只重试失败文件，成功关闭后新批次采用当前目录", async () => {
    uploadImage.mockImplementation(async (file) => {
        if (file.name === "bad.png") throw new Error("fixture upload rejected");
        return uploaded;
    });
    await render();
    await choose("good.png");
    await choose("bad.png");
    await act(async () => start().click());
    await finishMicrotasks();
    expect(completions).toBe(0);
    expect(input().disabled).toBe(false);
    expect(document.querySelectorAll(".batch-upload-item")).toHaveLength(2);
    expect(document.body.textContent).toContain("fixture upload rejected");
    expect(addAsset).toHaveBeenCalledTimes(1);
    uploadImage.mockImplementation(async () => uploaded);
    await act(async () => start().click());
    await finishMicrotasks();
    expect(uploadImage.mock.calls.map(([file]) => file.name)).toEqual(["good.png", "bad.png", "bad.png"]);
    expect(completions).toBe(1);
    expect(addAsset).toHaveBeenCalledTimes(2);
    await render();
    folderId = "folder-b";
    open = true;
    await render();
    expect(document.querySelectorAll(".batch-upload-item")).toHaveLength(0);
    expect(document.body.textContent).toContain("目录 B");
    await choose("next.png");
    await act(async () => start().click());
    await finishMicrotasks();
    expect(addAsset.mock.calls.at(-1)![0].folderId).toBe("folder-b");
});

test("同步失败仍释放锁，刷新回调完成前不能开始另一批", async () => {
    const refresh = deferred<void>();
    completion = () => refresh.promise;
    flush.mockImplementation(async () => {
        throw new Error("fixture sync failure");
    });
    await render();
    await choose("first.png");
    await act(async () => start().click());
    await finishMicrotasks();
    expect(completions).toBe(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(input().disabled).toBe(true);
    await choose("late.png");
    expect(document.querySelectorAll(".batch-upload-item")).toHaveLength(0);
    await render();
    folderId = "folder-b";
    open = true;
    await render();
    expect(input().disabled).toBe(true);
    await act(async () => refresh.resolve());
    expect(input().disabled).toBe(false);
    expect(document.body.textContent).toContain("目录 B");
    expect(uploadImage).toHaveBeenCalledTimes(1);
});
