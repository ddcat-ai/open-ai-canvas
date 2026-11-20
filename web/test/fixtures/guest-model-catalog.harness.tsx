import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";

const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(dom.Element.prototype, "animate", { configurable: true, value: undefined });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { ModelPicker } = await import("../../src/components/model-picker");
const { CreationComposer } = await import("../../src/pages/create/creation-workspace");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { modelQuoteRequest } = await import("../../src/lib/model-pricing");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot } = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { apiClient } = await import("../../src/services/api/request");
const noop = () => {};
afterAll(() => dom.happyDOM.abort());

const profile = defaultModelCapabilityConfig("openai-video", "sora-2");
const channel = createModelChannel({
    id: "guest-catalog",
    scope: "system",
    models: ["sora-2"],
    modelCosts: [
        {
            model: "sora-2",
            modelKey: "sora-2",
            channelId: "guest-catalog",
            displayName: "游客可见视频模型",
            capability: "video",
            protocol: "openai-video",
            capabilityConfig: profile,
            billingMode: "fixed_request",
            unitPriceMicrocredits: 1000000,
            logicalPriceTiers: [{ selector: {}, billingMode: "fixed_request", unitPriceMicrocredits: 1000000, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
        },
    ],
});
const model = "guest-catalog::sora-2";
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model, videoModel: model } }).config;

for (const component of ["picker", "composer"] as const) {
    test(`${component} 游客不报价，登录后恢复报价`, async () => {
        const originalAdapter = apiClient.defaults.adapter;
        const requests: string[] = [];
        apiClient.defaults.adapter = async (request) => {
            requests.push(request.url!);
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { quote: { amountMicrocredits: 2000000, estimated: false } } } };
        };
        useUserStore.setState({ user: null, hydrated: true });
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const props: ComponentProps<typeof CreationComposer> = {
            variant: "empty",
            mode: "video",
            prompt: "测试",
            setPrompt: noop,
            busy: false,
            generationActive: false,
            referenceReplacementBusy: false,
            attachments: [],
            maxReferences: 0,
            references: [],
            onRemoveAttachment: noop,
            onClearAttachments: noop,
            onClearComposer: noop,
            onReorderAttachments: noop,
            onReplaceAttachment: noop,
            onReplaceReferenceFiles: noop,
            onOpenLibrary: noop,
            onModeChange: noop,
            model,
            modelRequirements: { capability: "video" },
            videoProfile: profile.video!,
            imageProfile: defaultModelCapabilityConfig("openai-image").image!,
            config,
            onModelChange: noop,
            ratio: config.videoRatio,
            setRatio: noop,
            seconds: config.videoSeconds,
            setSeconds: noop,
            quality: config.quality,
            setQuality: noop,
            imageResolution: config.imageResolution,
            setImageResolution: noop,
            setImageParameters: noop,
            setTransparentBackground: noop,
            videoQuality: config.videoQuality,
            setVideoQuality: noop,
            count: "1",
            setCount: noop,
            textStreaming: false,
            setTextStreaming: noop,
            textThinkingLevels: [],
            textThinkingLevel: "",
            textThinkingRequest: "auto",
            setTextThinkingLevel: noop,
            promptOptimizerProvider: null,
            composerFocusRef: createRef<HTMLTextAreaElement>(),
            onPromptFocus: noop,
            onSubmit: noop,
        };
        try {
            expect(modelQuoteRequest(config, model, "video")).toBeDefined();
            await act(async () =>
                root.render(
                    <MemoryRouter>
                        <ConfigProvider theme={{ token: { motion: false } }}>
                            <App>{component === "picker" ? <ModelPicker config={config} value={model} capability="video" onChange={noop} /> : <CreationComposer {...props} />}</App>
                        </ConfigProvider>
                    </MemoryRouter>,
                ),
            );
            expect(host.textContent).toContain("游客可见视频模型");
            expect(requests).toEqual([]);
            if (component === "composer") expect(host.querySelector('button[aria-label^="预估"]')).not.toBeNull();
            await act(async () => useUserStore.setState({ user: { id: "member", username: "member", displayName: "会员", role: "user", status: "active" } }));
            expect(requests.length).toBeGreaterThan(0);
            expect(requests.every((url) => url === "/model-catalog/quote")).toBe(true);
            const count = requests.length;
            await act(async () => useUserStore.setState({ user: null }));
            expect(requests).toHaveLength(count);
            expect(host.textContent).toContain("游客可见视频模型");
            if (component === "composer") expect(host.querySelector('button[aria-label^="预估"]')).not.toBeNull();
        } finally {
            await act(async () => root.unmount());
            apiClient.defaults.adapter = originalAdapter;
            host.remove();
        }
    });
}
