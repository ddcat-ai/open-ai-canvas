import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "Element", "SVGElement", "ShadowRoot", "Node", "CustomEvent", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, {
    window: dom,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
let reloads = 0;
let missingConfigurations = 0;
mock.module("@/lib/user-session", () => ({
    refreshSystemChannels: async () => {
        reloads++;
        useModelCatalogStore.setState({ status: "loading" });
        await Promise.resolve();
        useConfigStore.setState({ config });
        useModelCatalogStore.setState({ status: "ready" });
    },
}));
const { ModelPicker } = await import("../../src/components/model-picker");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useModelCatalogStore } = await import("../../src/stores/use-model-catalog-store");
const user = { id: "picker-user", username: "fixture", displayName: "fixture", role: "user" as const, status: "active" as const };
const channel = createModelChannel({
    id: "picker-test",
    name: "本地测试",
    scope: "system",
    models: ["image-a", "image-b"],
    modelCosts: ["a", "b"].map((suffix) => ({
        model: `image-${suffix}`,
        displayName: `分组${suffix.toUpperCase()}`,
        channelLabel: `线路${suffix.toUpperCase()}`,
        capability: "image" as const,
        unitPriceMicrocredits: 0,
        capabilityConfig: defaultModelCapabilityConfig("openai-image", `image-${suffix}`),
    })),
});
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], imageModel: "picker-test::image-a", imageModels: ["picker-test::image-a", "picker-test::image-b"] } }).config;
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
    reloads = 0;
    missingConfigurations = 0;
    useUserStore.setState((state) => ({ user, hydrated: true, features: { ...state.features, creditsEnabled: false, customChannelsEnabled: false } }));
    useModelCatalogStore.setState({ status: "ready" });
});

async function mount(initial = "picker-test::image-a", settings: { config?: typeof config; live?: boolean; modelFilter?: (model: string) => boolean; catalogSource?: "provided" } = {}) {
    const changes: string[] = [];
    function Harness() {
        const [value, setValue] = useState(initial);
        const storedConfig = useConfigStore((state) => state.config);
        return (
            <ModelPicker
                config={settings.live ? storedConfig : settings.config || config}
                value={value}
                capability="image"
                showSelectedPrice={false}
                onMissingConfig={() => missingConfigurations++}
                modelFilter={settings.modelFilter}
                catalogSource={settings.catalogSource}
                onChange={(next) => {
                    changes.push(next);
                    setValue(next);
                }}
            />
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <Harness />
            </ConfigProvider>,
        ),
    );
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.click());
    return { trigger, changes };
}
function menu() {
    return document.querySelector<HTMLElement>(".canvas-model-picker-menu")!;
}
function button(text: string) {
    return Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(text))!;
}
async function click(text: string) {
    const target = button(text);
    expect(target, `缺少按钮 ${text}`).toBeDefined();
    await act(async () => target.click());
}
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());

test("目录加载失败提供重试而不误跳配置，恢复后可选择模型", async () => {
    useConfigStore.setState({ config: defaultConfig });
    useModelCatalogStore.setState({ status: "loading" });
    const { changes } = await mount("", { live: true });
    expect(menu().textContent).toContain("正在加载模型");
    expect(button("重新加载")).toBeUndefined();
    expect(missingConfigurations).toBe(0);
    await act(async () => useModelCatalogStore.setState({ status: "error" }));
    expect(menu().textContent).toContain("模型列表加载失败");
    await click("重新加载");
    expect(reloads).toBe(1);
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
});

test("目录刷新失败保留缓存模型的正常选择", async () => {
    useModelCatalogStore.setState({ status: "error" });
    const { changes } = await mount();
    expect(menu().textContent).toContain("仍可选择已加载模型");
    await act(async () => menu().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }) as unknown as KeyboardEvent));
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
    expect(reloads).toBe(0);
});

test("目录错误不影响纯个人配置和独立传入的预览目录", async () => {
    useModelCatalogStore.setState({ status: "error" });
    const personal = { ...config, channels: config.channels.map((item) => ({ ...item, scope: "user" as const })) };
    await mount(undefined, { config: personal });
    expect(menu().querySelector('[role="option"]')).not.toBeNull();
    expect(menu().textContent).not.toContain("加载失败");
    await act(async () => roots.pop()!.unmount());
    document.body.innerHTML = "";
    await mount(undefined, { catalogSource: "provided" });
    expect(menu().querySelector('[role="option"]')).not.toBeNull();
    expect(menu().textContent).not.toContain("加载失败");
});

test("已成功读取的空目录仍保留原有缺少配置回调", async () => {
    useConfigStore.setState({ config: defaultConfig });
    const { changes } = await mount("", { live: true });
    expect(missingConfigurations).toBe(1);
    expect(menu().querySelector('[role="option"]')).toBeNull();
    expect(button("重新加载")).toBeUndefined();
    expect(changes).toEqual([]);
});
