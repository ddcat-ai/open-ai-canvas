import { afterEach, describe, expect, test } from "bun:test";
import { App } from "antd";
import axios from "axios";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasVideoSettingsPopover } from "../src/components/canvas/canvas-video-settings-popover";
import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { mergeFetchedChannelModelCosts, type ChannelModelCatalogItem } from "../src/lib/channel-model-catalog";
import { defaultModelCapabilityConfig, pluginWorkflowCapabilityConfig } from "../src/lib/model-capabilities";
import { ChannelModelSettings } from "../src/pages/settings/channel-video-pricing";
import { fetchChannelModels } from "../src/services/api/image";
import { createVideoGenerationTask } from "../src/services/api/video";
import { createModelChannel, defaultConfig, modelDisplayName, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "../src/stores/use-config-store";

const originalAxiosPost = axios.post;

afterEach(() => {
    axios.post = originalAxiosPost;
});

const omniCatalog: ChannelModelCatalogItem = {
    id: "omni",
    displayName: "Omni Flash",
    modelType: "video",
    supportsImages: false,
    minImages: 0,
    maxImages: 0,
    defaultParameters: { aspectRatio: "16:9", durationSeconds: "10" },
    options: {
        aspectRatio: [{ value: "16:9" }, { value: "9:16" }],
        durationSeconds: [{ value: "8" }, { value: "10" }],
    },
};

function configForCatalog(catalog: ChannelModelCatalogItem[], input: Partial<AiConfig> = {}) {
    const channel = createModelChannel({
        id: "flow",
        name: "Flow2API",
        baseUrl: "https://flow.example",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        models: catalog.map((item) => item.id),
    });
    const configured = { ...channel, modelCosts: mergeFetchedChannelModelCosts(channel, catalog) };
    const normalized = normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            ...input,
            channels: [configured],
            model: `flow::${catalog[0]!.id}`,
            videoModel: `flow::${catalog[0]!.id}`,
        },
    }).config;
    return input.vquality ? { ...normalized, vquality: input.vquality } : normalized;
}

function formEntries(body: unknown) {
    expect(body).toBeInstanceOf(FormData);
    return Object.fromEntries(Array.from((body as FormData).entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

describe("public channel model catalog", () => {
    test("projects Manifest video workflow parameters without inventing a size capability", () => {
        const profile = pluginWorkflowCapabilityConfig("autodl-comfyui", {
            id: "minimax_h3_lightx2v_no_pic",
            label: "MiniMax H3 文生视频",
            providerId: "autodl-comfyui",
            capability: "video",
            parameters: [
                { name: "prompt", type: "string", required: true, mapping: "prompt" },
                { name: "duration", type: "integer", mapping: "duration" },
                { name: "resolution", type: "string", mapping: "resolution", values: ["480p竖", "480p横"] },
            ],
            defaults: { duration: 5, resolution: "480p竖" },
        })!.video!;

        expect(profile.ratios).toEqual([]);
        expect(profile.defaultRatio).toBe("");
        expect(profile.resolutions).toEqual(["480p竖", "480p横"]);
        expect(profile.defaultResolution).toBe("480p竖");
        expect(profile.duration).toEqual({ selection: "enum", values: [5], default: 5 });
    });

    test("preserves six public capabilities without expanding compatibility IDs", async () => {
        axios.post = (async () => ({
            data: {
                code: 0,
                data: {
                    models: [
                        { id: "image-fast", displayName: "Image Fast", modelType: "image" },
                        { id: "image-quality", displayName: "Image Quality", modelType: "image" },
                        { ...omniCatalog, compatibilityMap: [{ modelId: "omni_portrait_10s" }] },
                        { id: "veo-lite", displayName: "Veo Lite", modelType: "video" },
                        { id: "veo-fast", displayName: "Veo Fast", modelType: "video" },
                        { id: "veo-quality", displayName: "Veo Quality", modelType: "video" },
                    ],
                },
            },
        })) as typeof axios.post;
        const channel = createModelChannel({ baseUrl: "https://flow.example", apiKey: "synthetic-test-key", models: [] });

        const result = await fetchChannelModels(channel, true);

        expect(result.models).toHaveLength(6);
        expect(result.models).toContain("omni");
        expect(result.models).not.toContain("omni_portrait_10s");
        expect(result.catalog.find((item) => item.id === "omni")).toEqual(omniCatalog);
        expect(result.catalog.find((item) => item.id === "omni")).not.toHaveProperty("compatibilityMap");
    });

    test("maps Omni metadata to friendly video/NewAPI configuration with 8/10 seconds and both ratios", () => {
        const config = configForCatalog([omniCatalog]);
        const model = "flow::omni";
        const cost = config.channels[0]!.modelCosts![0]!;

        expect(modelDisplayName(config, model)).toBe("Omni Flash");
        expect(selectableModelsByCapability(config, "video")).toEqual([model]);
        expect(selectableModelsByCapability(config, "text")).toEqual([]);
        expect(resolveModelRequestConfig(config, model).interfaceType).toBe("newapi");
        expect(cost.capabilityConfig?.video).toMatchObject({
            duration: { selection: "enum", values: [8, 10], default: 10 },
            ratios: ["16:9", "9:16"],
            defaultRatio: "16:9",
            resolutions: [],
            defaultResolution: "",
        });
    });

    test("does not infer a protocol from endpoint-only video metadata", () => {
        const catalog: ChannelModelCatalogItem = {
            id: "endpoint-video",
            supportedEndpointTypes: ["openai-video"],
        };
        const config = configForCatalog([catalog], { videoSeconds: "6", size: "16:9", vquality: "720" });

        expect(config.channels[0]!.modelCosts).toEqual([]);
    });

    test("preserves a manually configured capability profile when a catalog only returns an ID", () => {
        const channel = createModelChannel({
            id: "manual",
            name: "Manual",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            models: ["manual-video"],
        });
        const capabilityConfig = defaultModelCapabilityConfig("newapi", "manual-video");
        capabilityConfig.video!.resolutions = ["1440p"];
        capabilityConfig.video!.defaultResolution = "1440p";
        channel.modelCosts = [{ model: "manual-video", displayName: "Manual Video", capability: "video", protocol: "newapi", billingMode: "fixed_request", unitPriceMicrocredits: 0, capabilityConfig }];

        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "manual-video" }]);

        expect(costs[0]?.capabilityConfig).toEqual(capabilityConfig);
        expect(costs[0]?.displayName).toBe("Manual Video");
    });

    test("preserves an ID-only manual model cost when the per-model protocol is missing", () => {
        const channel = createModelChannel({
            id: "manual-text-channel",
            name: "Manual Text Channel",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            interfaceType: "chat-completion",
            models: ["manual-video"],
        });
        const capabilityConfig = defaultModelCapabilityConfig("newapi", "manual-video");
        capabilityConfig.video!.resolutions = ["1440p"];
        capabilityConfig.video!.defaultResolution = "1440p";
        const existing = {
            model: "manual-video",
            displayName: "Manual Video",
            capability: "video" as const,
            billingMode: "per_second" as const,
            unitPriceMicrocredits: 4321,
            inputTokenPriceMicrocredits: 11,
            outputTokenPriceMicrocredits: 22,
            cachedTokenPriceMicrocredits: 3,
            capabilityConfig,
        };
        channel.modelCosts = [existing];

        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "manual-video", displayName: "Catalog Video" }]);

        expect(costs[0]).toEqual({ ...existing, displayName: "Catalog Video" });
    });

    test("uses modelType only for capability and preserves an existing manual protocol and profile", () => {
        const channel = createModelChannel({
            id: "manual-partial",
            name: "Manual Partial",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            interfaceType: "chat-completion",
            models: ["video-x"],
        });
        const capabilityConfig = defaultModelCapabilityConfig("gemini-veo", "video-x");
        capabilityConfig.video!.resolutions = ["1440p"];
        capabilityConfig.video!.defaultResolution = "1440p";
        channel.modelCosts = [{ model: "video-x", capability: "video", protocol: "gemini-veo", billingMode: "per_second", unitPriceMicrocredits: 7654, capabilityConfig }];

        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "video-x", modelType: "video" }]);

        expect(costs).toEqual(channel.modelCosts);
    });

    test("requires the declared minimum image count and selects image-to-video", async () => {
        const catalog: ChannelModelCatalogItem = {
            id: "image-required-video",
            modelType: "video",
            minImages: 1,
            maxImages: 2,
        };
        const config = configForCatalog([catalog]);
        const profile = config.channels[0]!.modelCosts![0]!.capabilityConfig!.video!;

        expect(profile.references).toMatchObject({ minImages: 1, maxImages: 2 });
        expect(profile.operations).toEqual(["image_to_video"]);
        expect(profile.defaultOperation).toBe("image_to_video");
        expect(createVideoGenerationTask(config, "synthetic prompt")).rejects.toThrow("至少需要 1 张参考图");
    });

    test("preserves an ID-only manual video model cost when both protocol sources are missing", () => {
        const channel = createModelChannel({
            id: "manual-no-protocol",
            name: "Manual No Protocol",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            models: ["manual-video"],
        });
        const capabilityConfig = defaultModelCapabilityConfig("newapi", "manual-video");
        capabilityConfig.video!.resolutions = ["1440p"];
        capabilityConfig.video!.defaultResolution = "1440p";
        const existing = {
            model: "manual-video",
            displayName: "Manual Video",
            capability: "video" as const,
            billingMode: "per_second" as const,
            unitPriceMicrocredits: 8765,
            inputTokenPriceMicrocredits: 31,
            outputTokenPriceMicrocredits: 47,
            cachedTokenPriceMicrocredits: 5,
            capabilityConfig,
        };
        channel.modelCosts = [existing];

        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "manual-video", displayName: "Catalog Video" }]);

        expect(costs).toEqual([{ ...existing, displayName: "Catalog Video" }]);
    });

    test("does not show a synthetic 720P label in the Canvas summary when the model declares no resolutions", () => {
        const config = configForCatalog([omniCatalog], { videoSeconds: "10", size: "16:9", vquality: "720" });

        const html = renderToStaticMarkup(React.createElement(CanvasVideoSettingsPopover, { config, onConfigChange: () => undefined }));

        expect(html).toContain("16:9 · 10s");
        expect(html).not.toContain("720P");
    });

    test("does not show size controls when the video capability declares no ratios", () => {
        const config = configForCatalog([omniCatalog], { videoSeconds: "10", size: "16:9", vquality: "1080" });
        const profile = config.channels[0]!.modelCosts![0]!.capabilityConfig!.video!;
        profile.ratios = [];
        profile.defaultRatio = "";
        profile.resolutions = ["1080p"];
        profile.defaultResolution = "1080p";

        const summaryHtml = renderToStaticMarkup(React.createElement(CanvasVideoSettingsPopover, { config, onConfigChange: () => undefined }));
        const panelHtml = renderToStaticMarkup(React.createElement(VideoSettingsPanel, { config, onConfigChange: () => undefined, theme: canvasThemes.dark }));

        expect(summaryHtml).toContain("1080P · 10s");
        expect(summaryHtml).not.toContain("16:9");
        expect(panelHtml).not.toContain("尺寸");
    });

    test("shows dimensions derived from the selected video resolution and ratio", () => {
        const config = configForCatalog([omniCatalog], { videoSeconds: "10", size: "16:9", vquality: "1080" });
        const profile = config.channels[0]!.modelCosts![0]!.capabilityConfig!.video!;
        profile.resolutions = ["720p", "1080p", "2160p"];
        profile.defaultResolution = "720p";

        const panelHtml = renderToStaticMarkup(React.createElement(VideoSettingsPanel, { config, onConfigChange: () => undefined, theme: canvasThemes.dark }));

        expect(panelHtml).toContain("1920");
        expect(panelHtml).toContain("1080");
        expect(panelHtml).not.toContain("1280");
    });

    test("shows the public display name in channel model settings instead of only the internal ID", () => {
        const config = configForCatalog([omniCatalog]);

        const html = renderToStaticMarkup(React.createElement(App, null, React.createElement(ChannelModelSettings, { channel: config.channels[0]!, onChange: () => undefined })));

        expect(html).toContain("Omni Flash");
    });

    test("builds the creation catalog only from public backend models and user channels", () => {
        const platform = createModelChannel({
            id: "public-logical-models",
            name: "平台模型",
            scope: "system",
            apiKey: "system",
            models: ["frontend-image"],
            modelCosts: [{ model: "frontend-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
        });
        const custom = createModelChannel({
            id: "custom-channel",
            name: "我的渠道",
            baseUrl: "https://custom.example.com",
            apiKey: "synthetic-test-key",
            models: ["custom-image-v1"],
        });
        const normalized = normalizeConfigSnapshot({
            config: {
                ...defaultConfig,
                channels: [platform, custom, createModelChannel({ id: "default", name: "默认渠道", apiKey: "", models: ["gpt-image-2"] })],
                models: ["default::gpt-image-2", "ghost-image"],
                imageModels: ["default::gpt-image-2", "ghost-image"],
                imageModel: "default::gpt-image-2",
            },
        }).config;
        const staleSnapshot = { ...normalized, models: [...normalized.models, "ghost-image"], imageModels: [...normalized.imageModels, "ghost-image"] };

        expect(selectableModelsByCapability(staleSnapshot, "image")).toEqual(["public-logical-models::frontend-image", "custom-channel::custom-image-v1"]);
        expect(staleSnapshot.channels.some((channel) => channel.id === "default")).toBe(false);
        expect(selectableModelsByCapability(staleSnapshot, "image")).not.toContain("default::gpt-image-2");
        expect(selectableModelsByCapability(staleSnapshot, "image")).not.toContain("ghost-image");
    });

    test("omits resolution_name for Omni and for auto instead of inventing 720p", async () => {
        const bodies: Record<string, string>[] = [];
        axios.post = (async (_url: string, body: unknown) => {
            bodies.push(formEntries(body));
            return { data: { id: `synthetic-${bodies.length}` } };
        }) as typeof axios.post;

        const omniConfig = configForCatalog([omniCatalog], { videoSeconds: "10", size: "16:9", vquality: "720" });
        await createVideoGenerationTask(omniConfig, "synthetic prompt");

        const declaredResolution: ChannelModelCatalogItem = {
            ...omniCatalog,
            id: "veo-public",
            displayName: "Veo Public",
            defaultParameters: { ...omniCatalog.defaultParameters, durationSeconds: "8", resolution: "1080p" },
            options: { ...omniCatalog.options, durationSeconds: [{ value: "8" }], resolution: [{ value: "720p" }, { value: "1080p" }] },
        };
        const autoConfig = configForCatalog([declaredResolution], { videoSeconds: "8", size: "16:9", vquality: "auto" });
        await createVideoGenerationTask(autoConfig, "synthetic prompt");

        expect(bodies[0]).not.toHaveProperty("resolution_name");
        expect(bodies[1]).not.toHaveProperty("resolution_name");
    });

    test("sends a declared compatible HD resolution for a video capability", async () => {
        let body: Record<string, string> = {};
        axios.post = (async (_url: string, requestBody: unknown) => {
            body = formEntries(requestBody);
            return { data: { id: "synthetic-hd" } };
        }) as typeof axios.post;
        const catalog: ChannelModelCatalogItem = {
            ...omniCatalog,
            id: "veo-public",
            displayName: "Veo Public",
            defaultParameters: { aspectRatio: "16:9", durationSeconds: "8", resolution: "1080p" },
            options: { ...omniCatalog.options, durationSeconds: [{ value: "8" }], resolution: [{ value: "1080p" }] },
        };
        const config = configForCatalog([catalog], { videoSeconds: "8", size: "16:9", vquality: "1080" });

        await createVideoGenerationTask(config, "synthetic prompt");

        expect(body.resolution_name).toBe("1080p");
        expect(body.model).toBe("veo-public");
        expect(body.seconds).toBe("8");
        expect(body.size).toBe("1280x720");
    });

    test("preserves provider resolution enums with direction suffixes across Canvas display and requests", async () => {
        let body: Record<string, string> = {};
        axios.post = (async (_url: string, requestBody: unknown) => {
            body = formEntries(requestBody);
            return { data: { id: "synthetic-directional" } };
        }) as typeof axios.post;
        const catalog: ChannelModelCatalogItem = {
            ...omniCatalog,
            id: "directional-video",
            displayName: "Directional Video",
            defaultParameters: { aspectRatio: "16:9", durationSeconds: "8", resolution: "768p竖" },
            options: {
                ...omniCatalog.options,
                durationSeconds: [{ value: "8" }],
                resolution: [{ value: "480p竖" }, { value: "768p竖" }, { value: "480p横" }, { value: "768p横" }],
            },
        };
        const config = configForCatalog([catalog], { videoSeconds: "8", size: "16:9", vquality: "768P竖" });

        const html = renderToStaticMarkup(React.createElement(CanvasVideoSettingsPopover, { config, onConfigChange: () => undefined }));
        const panelHtml = renderToStaticMarkup(React.createElement(VideoSettingsPanel, { config, onConfigChange: () => undefined, theme: canvasThemes.dark }));
        await createVideoGenerationTask(config, "synthetic prompt");

        expect(html).toContain("768P竖 · 16:9 · 8s");
        expect(panelHtml).toMatch(/aria-pressed="true"[^>]*>768P竖<\/button>/);
        expect(body.resolution_name).toBe("768p竖");
    });
});
