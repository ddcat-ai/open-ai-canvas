import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApprovalCard } = await import("../../src/components/canvas/canvas-cloud-agent-panel-parts");
const { canvasThemes } = await import("../../src/lib/canvas-theme");
const { defaultImageCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { imagePresetForRatio, imageSizeConfigWithPresets } = await import("../../src/lib/image-size-presets");
const { imageParameterRequest, projectImageParameters } = await import("../../src/lib/image-parameters");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } = await import("../../src/stores/use-config-store");
type AgentMediaSettings = import("../../src/services/api/agent").AgentMediaSettings;

const ratios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];
const tiers = ["1k", "2k", "4k"];
const presets = tiers.flatMap((tier) => ratios.map((ratio) => imagePresetForRatio(tier, ratio)));
const parameters = [
    { name: "size", label: "尺寸", type: "string" as const, encoding: "pixels" as const, values: presets.map((preset) => preset.size), default: "1024x1024" },
    { name: "imageResolution", label: "分辨率", type: "string" as const, values: tiers, default: "1k" },
    { name: "quality", label: "图片质量", type: "string" as const, values: ["auto", "low", "medium", "high"], default: "auto" },
    { name: "seed", label: "种子", type: "integer" as const, values: [1, 42], default: 1 },
    { name: "count", label: "张数", type: "integer" as const, min: 1, max: 1, default: 1 },
    { name: "transparentBackground", label: "透明背景", type: "boolean" as const, default: false },
];
let profile = projectImageParameters(defaultImageCapabilityConfig("openai-image", "gpt-image-2"), parameters);
profile = { ...profile, size: imageSizeConfigWithPresets(profile, presets) };
const models = ["gpt-image-2", "gpt-image-2.5"];
const channel = createModelChannel({
    id: "image-system",
    scope: "system",
    interfaceType: "openai-image",
    models,
    modelCosts: models.map((model) => ({
        model,
        channelModelId: `image-system-${model}`,
        displayName: "GPT-Image-YC",
        capability: "image",
        protocol: "openai-image",
        capabilityConfig: { version: 1, image: profile },
        billingMode: "fixed_request",
        unitPriceMicrocredits: 10_000_000,
    })),
});
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel] } }).config;
useConfigStore.setState({ config });
afterAll(() => dom.happyDOM.abort());

test("真实图片审批卡片可切换比例、分辨率、质量，提交值与界面一致", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let submitted: AgentMediaSettings | undefined;
    const initial = {
        channelId: channel.id,
        channelModelKey: "gpt-image-2",
        size: "1024x1024",
        imageResolution: "1k",
        quality: "auto",
        imageParameters: JSON.stringify({ seed: 42, size: "1024x1024", imageResolution: "1k", quality: "auto", count: 1, transparentBackground: false }),
        prompt: "测试图片",
        referenceNodeIds: [],
    };
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)!;
    const press = async (label: string) => {
        expect(button(label), label).toBeDefined();
        await act(async () => button(label).click());
    };
    const selected = (label: string) => {
        expect(button(label), [...host.querySelectorAll("button")].map((item) => item.textContent).join(", ")).toBeDefined();
        expect(button(label).getAttribute("aria-pressed"), label).toBe("true");
    };
    const submit = async (size: string, resolution: string, quality: string) => {
        await press("同意执行");
        expect(submitted).toMatchObject({ channelId: channel.id, channelModelKey: "gpt-image-2", size, imageResolution: resolution, quality });
        expect(JSON.parse(submitted!.imageParameters!)).toEqual({ seed: 42, count: 1, transparentBackground: false });
        expect(imageParameterRequest(profile, submitted!, true)).toEqual({ size, imageResolution: resolution, quality, seed: 42, count: 1, transparentBackground: false });
    };
    const render = (submitting = false) =>
        root.render(
            <ApprovalCard
                approval={{ approvalId: "image-approval", detail: { toolName: "generate_media", arguments: { ...initial, mode: "image" } }, reason: "" }}
                theme={canvasThemes.dark}
                submitting={submitting}
                blocked={false}
                onReasonChange={() => {}}
                onApprove={(settings) => {
                    submitted = settings;
                }}
                onReject={() => {}}
            />,
        );
    try {
        await act(async () => render());
        selected("1:1");
        selected("1K");
        await press("16:9");
        selected("16:9");
        expect(host.querySelector("output")?.textContent).toContain("16:9");
        await submit(imagePresetForRatio("1k", "16:9").size, "1k", "auto");
        await press("2K");
        selected("2K");
        selected("16:9");
        await submit(imagePresetForRatio("2k", "16:9").size, "2k", "auto");
        await press("high");
        selected("high");
        selected("16:9");
        await submit(imagePresetForRatio("2k", "16:9").size, "2k", "high");
        await press("9:16");
        selected("9:16");
        await press("4K");
        selected("4K");
        selected("9:16");
        await submit(imagePresetForRatio("4k", "9:16").size, "4k", "high");
        await press("1");
        expect(button("1").getAttribute("aria-pressed")).toBe("true");
        await press("42");
        await submit(imagePresetForRatio("4k", "9:16").size, "4k", "high");
        await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click());
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        const alternative = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes("gpt-image-2.5"));
        expect(alternative).toBeDefined();
        await act(async () => alternative!.click());
        await press("同意执行");
        expect(submitted).toMatchObject({ channelId: channel.id, channelModelKey: "gpt-image-2.5", size: imagePresetForRatio("4k", "9:16").size, imageResolution: "4k", quality: "high" });
        expect(JSON.parse(submitted!.imageParameters!)).toEqual({ seed: 42, count: 1, transparentBackground: false });
        submitted = undefined;
        await act(async () => render(true));
        expect(host.querySelector("fieldset")?.disabled).toBe(true);
        await press("1:1");
        selected("9:16");
        await press("正在提交");
        expect(submitted).toBeUndefined();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
