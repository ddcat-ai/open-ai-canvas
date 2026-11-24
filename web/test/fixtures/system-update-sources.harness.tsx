import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { Window } from "happy-dom";
import type { SystemUpdateStatus } from "../../src/services/api/system-update";

const dom = new Window({ url: "http://localhost:3000/admin/settings/system-update" });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
// 只隔离无关导航外壳；更新页面、来源组件、共享设置卡、按钮和 Select 均使用真实实现。
mock.module("../../src/pages/admin/components/admin-shell", () => ({
    AdminPageFrame: ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
        <main data-admin-root>
            <h1>{title}</h1>
            {actions}
            {children}
        </main>
    ),
}));
const { default: SystemUpdatePage } = await import("../../src/pages/admin/settings/system-update-page");
const { apiClient } = await import("../../src/services/api/request");
const originalAdapter = apiClient.defaults.adapter;
const endpoint = "/admin/system-update";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let server: SystemUpdateStatus;
let calls: InternalAxiosRequestConfig[];
let failSave: boolean;

function availableRelease() {
    return { version: "v2.0.0", name: "v2.0.0", body: "release", url: "https://github.com/ddcat-ai/open-ai-canvas/releases/tag/v2.0.0", publishedAt: "2026-11-11T00:00:00Z", prerelease: false };
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

function button(label: string) {
    const node = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label);
    expect(node, label).toBeDefined();
    return node!;
}

async function click(label: string) {
    expect(button(label).disabled).toBe(false);
    await act(async () => {
        button(label).click();
    });
    await settle();
}

async function mount() {
    await act(async () => {
        root.render(
            <ConfigProvider>
                <App>
                    <SystemUpdatePage />
                </App>
            </ConfigProvider>,
        );
    });
    await settle();
}

beforeEach(() => {
    calls = [];
    failSave = false;
    server = {
        supported: true,
        connected: true,
        repository: "ddcat-ai/open-ai-canvas",
        deployment: "docker-compose-host-updater",
        currentVersion: "v1.0.0",
        latestRelease: availableRelease(),
        updateAvailable: true,
        sources: { githubSource: "direct", imageSource: "ghcr" },
        checks: [],
        operation: { phase: "ready", automaticRollback: false, logs: [] },
    };
    apiClient.defaults.adapter = async (config): Promise<AxiosResponse> => {
        calls.push(config);
        let code = 0;
        if (config.url === `${endpoint}/sources`) {
            if (failSave) code = 500;
            else server = { ...server, sources: JSON.parse(config.data as string), latestRelease: undefined, updateAvailable: false, sourceProbe: undefined };
        } else if (config.url === `${endpoint}/sources/test`) {
            server = { ...server, sourceProbe: { id: "probe-1", status: "running", sources: server.sources!, startedAt: "2026-11-12T00:00:00Z", checks: [{ key: "backend", label: "Backend 镜像清单", status: "pending", blocking: false }] } };
        } else if (config.url === `${endpoint}/check`) {
            server = { ...server, latestRelease: availableRelease(), updateAvailable: true };
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code, msg: code ? "保存失败" : "ok", data: structuredClone(server) } };
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    host.remove();
});

afterAll(async () => {
    apiClient.defaults.adapter = originalAdapter;
    await dom.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("未保存来源阻止检测和更新，持久化后必须重新检查版本", async () => {
    await mount();
    expect(button("开始更新").disabled).toBe(false);
    await click("镜像加速GH-Proxy + 南京大学镜像源");
    expect(host.textContent).toContain("gh-proxy.com → GitHub");
    expect(button("检查更新").disabled).toBe(true);
    expect(button("开始更新").disabled).toBe(true);
    expect(button("测试连通性").disabled).toBe(true);
    await click("保存来源");
    const write = calls.find((call) => call.url === `${endpoint}/sources`)!;
    expect(write.method).toBe("put");
    expect(JSON.parse(write.data)).toEqual({ githubSource: "gh_proxy", imageSource: "nju" });
    expect(button("开始更新").disabled).toBe(true);
    expect(button("检查更新").disabled).toBe(false);
    await click("检查更新");
    expect(button("开始更新").disabled).toBe(false);
});

test("来源检测异步轮询，运行中锁定控件，失败详情可见", async () => {
    await mount();
    await click("测试连通性");
    expect(button("官方直连GitHub + GHCR").disabled).toBe(true);
    expect(button("检查更新").disabled).toBe(true);
    server = { ...server, sourceProbe: { ...server.sourceProbe!, status: "failed", checks: [{ key: "backend", label: "Backend 镜像清单", status: "failed", detail: "registry unavailable", blocking: false }] } };
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2700));
    });
    await settle();
    expect(host.textContent).toContain("registry unavailable");
    expect(host.textContent).toContain("检测未通过");
    expect(button("官方直连GitHub + GHCR").disabled).toBe(false);
});

test("保存失败保留草稿，不假装配置已持久化", async () => {
    await mount();
    await click("镜像加速GH-Proxy + 南京大学镜像源");
    failSave = true;
    await click("保存来源");
    expect(server.sources).toEqual({ githubSource: "direct", imageSource: "ghcr" });
    expect(host.textContent).toContain("尚未保存");
    expect(button("保存来源").disabled).toBe(false);
    expect(button("检查更新").disabled).toBe(true);
});

test("两类来源可以独立混合选择", async () => {
    await mount();
    await click("镜像加速GH-Proxy + 南京大学镜像源");
    const details = host.querySelector("details")!;
    await act(async () => {
        details.open = true;
    });
    const input = host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="容器镜像来源"]')!;
    await act(async () => {
        input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    });
    await settle();
    const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((node) => node.textContent?.trim() === "GHCR · ghcr.io");
    expect(option).toBeDefined();
    await act(async () => {
        option!.click();
    });
    await settle();
    expect(host.textContent).toContain("当前为混合配置");
    await click("保存来源");
    expect(server.sources).toEqual({ githubSource: "gh_proxy", imageSource: "ghcr" });
});

test("更新器不提供配置时来源控件不可用", async () => {
    server.sources = undefined;
    await mount();
    expect(host.textContent).toContain("当前更新器未提供来源配置");
    expect(button("官方直连GitHub + GHCR").disabled).toBe(true);
    expect(button("保存来源").disabled).toBe(true);
    expect(button("测试连通性").disabled).toBe(true);
});
