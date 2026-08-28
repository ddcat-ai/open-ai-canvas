import { describe, expect, test } from "bun:test";

import { resolveProjectTextGenerationConfig } from "../src/lib/project-generation-model";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";

function customGenerationConfig() {
    const custom = createModelChannel({
        id: "custom-generation",
        name: "我的模型",
        baseUrl: "https://custom.example.com",
        apiKey: "synthetic-test-key",
        models: ["4.5 block", "custom-video-1"],
        modelCosts: [
            { model: "4.5 block", capability: "text", billingMode: "token", unitPriceMicrocredits: 0 },
            { model: "custom-video-1", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 0 },
        ],
    });
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            channels: [custom],
            textModel: "4.5 block",
        },
    }).config;
}

describe("project text generation model", () => {
    test("normalizes a custom text model and preserves its channel routing", () => {
        const generation = resolveProjectTextGenerationConfig(customGenerationConfig(), "4.5 block");

        expect(generation?.textModel).toBe("custom-generation::4.5 block");
        expect(generation?.requestConfig).toMatchObject({
            model: "custom-generation::4.5 block",
            textModel: "custom-generation::4.5 block",
            imageModel: "custom-generation::4.5 block",
            videoModel: "custom-generation::4.5 block",
        });
        expect(resolveModelRequestConfig(generation!.requestConfig, generation!.requestConfig.model)).toMatchObject({
            model: "4.5 block",
            baseUrl: "https://custom.example.com",
            apiKey: "synthetic-test-key",
        });
    });

    test("falls back to the first text model without selecting a video model", () => {
        const generation = resolveProjectTextGenerationConfig(customGenerationConfig(), "missing-model");

        expect(generation?.textModel).toBe("custom-generation::4.5 block");
    });

    test("keeps an already encoded custom model", () => {
        const generation = resolveProjectTextGenerationConfig(customGenerationConfig(), "custom-generation::4.5 block");

        expect(generation?.textModel).toBe("custom-generation::4.5 block");
    });

    test("returns null when no text-capable model exists", () => {
        const config = normalizeConfigSnapshot({
            config: {
                ...defaultConfig,
                channels: [
                    createModelChannel({
                        id: "video-only",
                        models: ["custom-video-1"],
                        modelCosts: [{ model: "custom-video-1", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 0 }],
                    }),
                ],
            },
        }).config;

        expect(resolveProjectTextGenerationConfig(config, "custom-video-1")).toBeNull();
    });
});
