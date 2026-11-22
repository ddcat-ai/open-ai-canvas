import { expect, spyOn, test } from "bun:test";
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
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { CreationModelCatalogDialog } = await import("../../src/pages/admin/channels/creation-model-catalog-dialog");
const { refreshSystemChannels, suspendUserSession } = await import("../../src/lib/user-session");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { http } = await import("../../src/services/api/request");
const { createModelChannel, normalizeConfigSnapshot, defaultConfig, useConfigStore } = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
import type { PublicChannelModel } from "../../src/services/api/logical-models";

const model = (domain: string, displayName: string, available = true): PublicChannelModel => ({
    id: displayName,
    modelKey: `${domain}-${displayName}`,
    displayName,
    channelLabel: `${displayName}线路`,
    icon: "",
    capability: domain,
    priceTiers: [],
    pricingMode: "fixed_request",
    priceLabel: "",
    available,
});

const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const menu = () => document.querySelector<HTMLElement>(".canvas-model-picker-menu")!;
async function chooseMode(value: string) {
    const labels: Record<string, string> = { video: "视频", image: "图片", text: "文本" };
    const item = Array.from(document.querySelectorAll(".ant-segmented-item-label")).find((element) => element.textContent === labels[value]);
    await act(async () => item!.closest("label")!.querySelector<HTMLInputElement>("input")!.click());
    await act(async () => button(".creation-model-picker").click());
}

test("真实创作选择器按视频、图片、文本展示会话目录，且失效后隐藏停用模型", async () => {
    setActiveUserScope("catalog-admin");
    useUserStore.setState((state) => ({
        user: { id: "catalog-admin", username: "catalog-admin", displayName: "catalog-admin", role: "admin", status: "active" },
        hydrated: true,
        features: { ...state.features, creditsEnabled: true, customChannelsEnabled: false },
    }));
    const personal = createModelChannel({ id: "private-channel", name: "未开放个人线路", scope: "user", models: ["private-video"] });
    useConfigStore.setState({ config: normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [personal] } }).config });
    const list = [model("video", "可见视频"), model("image", "可见图片"), model("text", "可见文本"), model("video", "停用视频", false)];
    let activeModels = list;
    const get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path !== "/model-catalog") throw new Error(`非目录查询：${path}`);
        return { source: "system", channels: [{ id: "test-channel", name: "授权渠道", displayName: "授权渠道", models: activeModels }] };
    });
    const post = spyOn(http, "post").mockRejectedValue(new Error("预览不应发送 POST"));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <CreationModelCatalogDialog onClose={() => {}} />
                </ConfigProvider>,
            ),
        );
        expect(Array.from(document.querySelectorAll(".ant-segmented-item-label"), (element) => element.textContent)).toEqual(["视频", "图片", "文本"]);
        await act(async () => button(".creation-model-picker").click());
        expect(menu().textContent).toContain("可见视频");
        expect(menu().textContent).not.toContain("停用视频");
        expect(menu().textContent).not.toContain("private-video");
        const group = Array.from(menu().querySelectorAll("button")).find((entry) => entry.textContent?.includes("可见视频"))!;
        await act(async () => group.click());
        const route = Array.from(menu().querySelectorAll("button")).find((entry) => entry.textContent?.includes("可见视频线路"))!;
        await act(async () => route.click());
        expect(button(".creation-model-picker").textContent).toContain("可见视频");
        await chooseMode("image");
        expect(menu().textContent).toContain("可见图片");
        await chooseMode("text");
        expect(menu().textContent).toContain("可见文本");
        activeModels = list.filter((entry) => entry.displayName !== "可见视频").concat(model("video", "新增视频"));
        await act(async () => refreshSystemChannels({ invalidate: true }));
        await chooseMode("video");
        expect(menu().textContent).toContain("新增视频");
        expect(menu().textContent).not.toContain("可见视频");
        expect(get).toHaveBeenCalledTimes(2);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        get.mockRestore();
        post.mockRestore();
        suspendUserSession();
        dom.happyDOM.abort();
    }
});
