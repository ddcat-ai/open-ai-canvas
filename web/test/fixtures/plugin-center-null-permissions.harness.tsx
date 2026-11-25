import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

import type { BackendPlugin } from "@/services/api/plugins";

const dom = new Window({ url: "https://plugins.example.com/plugins" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    matchMedia: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const memoryStorage = new Map<string, string>();
const storage = {
    getItem: async (name: string) => memoryStorage.get(name) ?? null,
    setItem: async (name: string, value: string) => {
        memoryStorage.set(name, value);
    },
    removeItem: async (name: string) => {
        memoryStorage.delete(name);
    },
};
mock.module("@/lib/localforage-storage", () => ({
    localForageStorage: storage,
    localForageStorageForScope: () => storage,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const { usePluginStore } = await import("@/stores/use-plugin-store");
const { default: PluginsPage } = await import("@/pages/plugins");
const { AdminPluginDetailModal } = await import("@/pages/admin/plugins/plugin-detail-modal");

const customProtocolWithNullPermissions = {
    manifest: {
        apiVersion: "yingce.plugin/v2",
        id: "custom-sample-video",
        name: "自定义视频请求协议",
        version: "1.0.0",
        description: "未显式声明 permissions 的自定义协议包",
        permissions: null,
        trusted: false,
        contributes: {
            providers: [
                {
                    id: "custom-sample-video",
                    label: "自定义视频请求协议",
                    capabilities: ["video"],
                    scopes: ["admin.system-channel"],
                    create: { method: "POST", path: "/v1/videos" },
                    response: {},
                },
            ],
        },
    },
    source: "uploaded",
    fileName: "custom-sample-video.yingce-plugin",
    package: "yingce-plugin/v1",
    sha256: "abc123",
    installedAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
    status: "enabled",
    management: {
        origin: "uploaded",
        kind: "protocol",
        activationScope: "system",
        configurationScope: "system",
    },
} as unknown as BackendPlugin;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let request: ReturnType<typeof spyOn<typeof apiClient, "request">>;

beforeEach(() => {
    memoryStorage.clear();
    useUserStore.setState({ hydrated: true, user: { id: "admin-1", username: "admin", displayName: "Admin", role: "admin", status: "active" } });
    usePluginStore.setState({ pluginStates: {}, runtimeStatuses: {} });
    request = spyOn(apiClient, "request").mockImplementation((async (config) => {
        if (config.url === "/plugins") {
            return { data: { code: 0, data: { plugins: [customProtocolWithNullPermissions], states: {} }, msg: "ok" }, status: 200, headers: {} };
        }
        throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    }) as typeof apiClient.request);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    request.mockRestore();
    useUserStore.setState({ hydrated: false, user: null });
});

afterAll(() => {
    dom.happyDOM.abort();
});

test("插件中心收到 permissions 为 null 的后端插件时正常渲染列表与详情文档", async () => {
    await act(async () =>
        root.render(
            <MemoryRouter>
                <App>
                    <PluginsPage />
                </App>
            </MemoryRouter>,
        ),
    );

    expect(host.textContent).toContain("自定义视频请求协议");
    expect(host.textContent).toContain("0 项能力");

    const openDetails = host.querySelector<HTMLButtonElement>('button[aria-label="查看自定义视频请求协议文档"]');
    expect(openDetails).not.toBeNull();
    await act(async () => openDetails!.click());
    expect(document.body.textContent).toContain("能力：未声明");
});

test("管理后台插件详情弹窗在 permissions 为 null 时显示未声明权限而不崩溃", async () => {
    await act(async () =>
        root.render(
            <App>
                <AdminPluginDetailModal plugin={customProtocolWithNullPermissions} typeLabel="自定义插件" onClose={() => {}} />
            </App>,
        ),
    );

    expect(document.body.textContent).toContain("自定义视频请求协议");
    expect(document.body.textContent).toContain("未声明权限");
});
