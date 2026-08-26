import { describe, expect, it } from "bun:test";

import { portraitVisionModelError, portraitVisionModels, resolvePortraitVisionModel } from "@/lib/portrait-clearance/vision";
import type { AiConfig } from "@/stores/use-config-store";

function config(): AiConfig {
    return {
        channelMode: "local",
        baseUrl: "https://example.test",
        apiKey: "key",
        apiFormat: "openai",
        model: "system::vision-text",
        imageModel: "system::image",
        videoModel: "",
        textModel: "system::vision-text",
        audioModel: "",
        audioVoice: "",
        audioFormat: "mp3",
        audioSpeed: "1",
        audioInstructions: "",
        videoSeconds: "6",
        vquality: "720",
        videoGenerateAudio: "true",
        videoWatermark: "false",
        videoArkPrivateAssetUpload: "true",
        systemPrompt: "",
        models: [],
        imageModels: [],
        videoModels: [],
        textModels: [],
        audioModels: [],
        quality: "auto",
        size: "1:1",
        transparentBackground: "false",
        count: "1",
        canvasImageCount: "1",
        channels: [{ id: "system", name: "系统", baseUrl: "https://example.test", apiKey: "key", apiFormat: "openai", models: ["vision-text", "text-only"], modelCosts: [{ model: "vision-text", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1, capabilityConfig: { version: 1, text: { references: { promptMaxChars: 10000, maxImages: 2, maxImageBytes: 12_000_000, maxVideos: 0, maxVideoBytes: 0 } } } }, { model: "text-only", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1 }] }],
    };
}

describe("portrait clearance model selection", () => {
    it("uses any selectable text model without requiring a separate image capability flag", () => {
        const value = config();
        expect(portraitVisionModels(value)).toEqual(["system::vision-text", "system::text-only"]);
        expect(resolvePortraitVisionModel(value, { mode: "project-default" })).toBe("system::vision-text");
        expect(resolvePortraitVisionModel(value, { mode: "pinned", modelRef: "system::text-only" })).toBe("system::text-only");
        expect(portraitVisionModelError(value, { mode: "pinned", modelRef: "system::text-only" })).toBe("");
    });
});
