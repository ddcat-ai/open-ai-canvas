import assert from "node:assert/strict";
import { mock } from "bun:test";
import { Window } from "happy-dom";
import type { AiConfig } from "../../src/stores/use-config-store";
import type { ModelQuoteRequest } from "../../src/services/api/logical-models";
const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: storage, localForageStorageForScope: () => storage }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const antd = await import("antd");
const errors: string[] = [];
const app = { message: { error: (v: string) => errors.push(v), warning: (v: string) => errors.push(v), success() {} }, modal: {} };
mock.module("antd", () => ({ ...antd, App: { useApp: () => app } }));
const stores = await import("../../src/stores/use-config-store");
let config: AiConfig;
mock.module("@/stores/use-config-store", () => ({ ...stores, useEffectiveConfig: () => config }));
const api = await import("../../src/services/api/workbench");
const requests: Parameters<typeof api.createWorkbenchTask>[0][] = [];
mock.module("@/services/api/workbench", () => ({
    ...api,
    listWorkbenchTools: async () => ({ tools: [] }),
    listWorkbenchTasks: async () => [],
    createWorkbenchTask: async (input: Parameters<typeof api.createWorkbenchTask>[0]) => {
        requests.push(input);
        throw new Error("transport boundary reached");
    },
}));
const quoteApi = await import("../../src/services/api/logical-models");
const quotes: ModelQuoteRequest[] = [];
mock.module("@/services/api/logical-models", () => ({
    ...quoteApi,
    quoteModel: async (input: ModelQuoteRequest) => {
        quotes.push(input);
        return { quote: { amountMicrocredits: 0 } };
    },
}));
const composer = await import("../../src/pages/workbench/workbench-composer");
let submit: undefined | (() => void);
let setPrompt: undefined | ((value: string) => void);
mock.module("../../src/pages/workbench/workbench-composer", () => ({
    ...composer,
    ComposerFooter: (props: { onSubmit(): void }) => {
        submit = props.onSubmit;
        return null;
    },
}));
mock.module("@/components/canvas/canvas-resource-mention-textarea", () => ({
    CanvasResourceMentionTextarea: (props: { onChange(value: string): void }) => {
        setPrompt = props.onChange;
        return null;
    },
}));
const { useCreationPreferencesStore } = await import("../../src/stores/use-creation-preferences-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { WorkbenchPage } = await import("../../src/pages/workbench/image-workbench-page");
useUserStore.setState({ features: { ...useUserStore.getState().features, creditsEnabled: true } });
try {
    for (const supportedAudio of [false, true]) {
        const protocol = "newapi-channel-2";
        const capability = defaultModelCapabilityConfig(protocol);
        capability.video!.duration = { selection: "enum", values: [5, 10], default: 5 };
        capability.video!.ratios = ["16:9"];
        capability.video!.defaultRatio = "16:9";
        capability.video!.resolutions = ["720p"];
        capability.video!.defaultResolution = "720p";
        capability.video!.generateAudio = { supported: supportedAudio, default: false };
        capability.video!.watermark = { supported: false, default: false };
        config = {
            ...stores.defaultConfig,
            videoGenerateAudio: "true",
            videoWatermark: "true",
            model: "test::model",
            videoModel: "test::model",
            channels: [
                stores.createModelChannel({
                    id: "test",
                    scope: "system",
                    baseUrl: "/api",
                    apiKey: "fixture-only",
                    models: ["model"],
                    modelCosts: [{ model: "model", capability: "video", protocol, capabilityConfig: capability, billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
                }),
            ],
        };
        useCreationPreferencesStore.setState({ hydrated: true, preferences: { video: { seconds: "30", ratio: "21:9", videoQuality: "2K" } } });
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter>
                        <WorkbenchPage kind="video" />
                    </MemoryRouter>,
                ),
            );
            assert.ok(setPrompt);
            assert.ok(submit);
            await act(async () => setPrompt!("测试提示词"));
            await act(async () => submit!());
            const request = requests.pop();
            assert.ok(request, errors.join(";"));
            const expected = { seconds: 5, ratio: "16:9", resolution: "720p" };
            assert.equal(request.parameters.seconds, expected.seconds);
            assert.equal(request.parameters.ratio, expected.ratio);
            assert.equal(request.parameters.resolution, expected.resolution);
            assert.equal(request.parameters.generateAudio, supportedAudio ? true : undefined);
            assert.equal(request.parameters.watermark, undefined);
            const quote = quotes.at(-1)!;
            assert.ok(quote);
            assert.equal(quote.intent.options.videoSeconds, expected.seconds);
            assert.equal(quote.intent.options.size, expected.ratio);
            assert.equal(quote.intent.options.vquality, expected.resolution);
            assert.equal(quote.intent.options.videoGenerateAudio, supportedAudio ? true : undefined);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    }
    console.log("workbench video submission: passed");
} finally {
    dom.happyDOM.abort();
}
