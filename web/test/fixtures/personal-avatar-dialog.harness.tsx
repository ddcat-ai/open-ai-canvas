import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://canvas.example/settings" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { I18nextProvider } = await import("react-i18next");
const { i18n } = await import("../../src/i18n");
const { PersonalAvatarDialog } = await import("../../src/pages/settings/personal-avatar-dialog");
const { apiClient } = await import("../../src/services/api/request");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("the upload dialog explains real materials and creation steps and rejects ordinary images", async () => {
    let requests = 0;
    const adapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async () => {
        requests++;
        throw new Error("Unexpected network request");
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => {
            root.render(
                <I18nextProvider i18n={i18n}>
                    <App>
                        <PersonalAvatarDialog userId="creator" onClose={() => {}} />
                    </App>
                </I18nextProvider>,
            );
        });
        expect(document.body.textContent).toContain("avatar.json");
        expect(document.body.textContent).toContain("128 MiB");
        expect(document.body.textContent).toContain("纯绿色背景");
        const example = document.querySelector<HTMLElement>(".ant-collapse-header")!;
        await act(async () => {
            example.click();
        });
        expect(document.body.textContent).toContain("统一 Q 版五官");
        expect(document.body.textContent).toContain("检查循环首尾");

        expect(document.body.textContent).toContain('"width": 480');
        const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [new dom.File(["image"], "portrait.png", { type: "image/png" })] });
        await act(async () => {
            input.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
        });
        expect(document.body.textContent).toContain("请选择不超过 128 MiB 的 ZIP 文件");
        expect(requests).toBe(0);
        const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "使用此形象")!;
        expect(apply.disabled).toBe(true);
    } finally {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        apiClient.defaults.adapter = adapter;
    }
});

test("strict mode keeps successful uploads mounted and starts the private preview", async () => {
    const adapter = apiClient.defaults.adapter;
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const previews: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url!);
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
                code: 0,
                data: {
                    bundle: {
                        resourceId: "my-avatar",
                        manifest: { version: 1, width: 480, height: 640, clips: { idle: "idle.mp4" } },
                    },
                },
            },
        };
    };
    globalThis.fetch = ((url, init) => {
        previews.push(String(url));
        return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
    }) as typeof fetch;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => {
            root.render(
                <StrictMode>
                    <I18nextProvider i18n={i18n}>
                        <App>
                            <PersonalAvatarDialog userId="creator" onClose={() => {}} />
                        </App>
                    </I18nextProvider>
                </StrictMode>,
            );
        });
        const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [new File(["zip"], "avatar.zip", { type: "application/zip" })] });
        await act(async () => {
            input.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
        });
        expect(requests).toEqual(["/appearance/avatar-bundles"]);
        expect(previews).toEqual(["/api/appearance/avatar/my-avatar/avatar.json"]);
    } finally {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        apiClient.defaults.adapter = adapter;
        globalThis.fetch = originalFetch;
    }
});
