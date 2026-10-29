import { describe, expect, test } from "bun:test";

import { buildImageToPrevisAgentPrompt, buildImageToPrevisDisplayText, modelSupportsImageInspection, selectImageInspectionModel } from "@/lib/canvas/image-to-previs-agent";
import type { AiConfig } from "@/stores/use-config-store";

describe("image to previs Agent prompt", () => {
    test("requires visual inspection and editable semantic objects", () => {
        const prompt = buildImageToPrevisAgentPrompt({
            id: "image-ref",
            nodeId: "image-node-1",
            kind: "image",
            label: "场景图",
            title: "场景图",
            active: true,
            mentionToken: "@[node:image-node-1]",
        });

        expect(prompt).toContain("@[node:image-node-1]");
        expect(prompt).toContain("canvas_inspect_image");
        expect(prompt).toContain("不要改用 image_text_detect");
        expect(prompt).toContain("previs_scene_create");
        expect(prompt).toContain("previs_scene_read");
        expect(prompt).toContain("previs_apply_patch");
        expect(prompt).toContain("actor");
        expect(prompt).toContain("不要把原图作为 billboard");
        expect(prompt).toContain("普通图片中的人物不是角色卡");
        expect(prompt).toContain("禁止传 characterName");
        expect(prompt).not.toContain("createPrevisBillboard");
        expect(buildImageToPrevisDisplayText()).toBe("根据此图生成世界引擎场景");
    });

    test("routes the image workflow to a configured vision-capable text model", () => {
        const config = {
            channels: [
                {
                    id: "plain",
                    scope: "system",
                    models: ["plain-text"],
                    modelCosts: [
                        {
                            model: "plain-text",
                            capability: "text",
                            protocol: "chat-completion",
                            billingMode: "fixed_request",
                            unitPriceMicrocredits: 1,
                            capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 16384, references: { promptMaxChars: 32000, maxImages: 0, maxImageBytes: 0, maxVideos: 0, maxVideoBytes: 0 } } },
                        },
                    ],
                },
                {
                    id: "vision",
                    scope: "system",
                    models: ["vision-text"],
                    modelCosts: [
                        {
                            model: "vision-text",
                            capability: "text",
                            protocol: "chat-completion",
                            billingMode: "fixed_request",
                            unitPriceMicrocredits: 1,
                            capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 16384, references: { promptMaxChars: 32000, maxImages: 3, maxImageBytes: 30 * 1024 * 1024, maxVideos: 0, maxVideoBytes: 0 } } },
                        },
                    ],
                },
            ],
        } as AiConfig;

        expect(modelSupportsImageInspection(config, "plain::plain-text")).toBe(false);
        expect(selectImageInspectionModel(config, "plain::plain-text")).toBe("vision::vision-text");
        expect(selectImageInspectionModel(config, "vision::vision-text")).toBe("vision::vision-text");
    });

    test("does not route the cloud Agent through a browser-only custom channel", () => {
        const config = {
            channels: [
                {
                    id: "custom",
                    scope: "user",
                    models: ["custom-vision"],
                    modelCosts: [
                        {
                            model: "custom-vision",
                            capability: "text",
                            protocol: "chat-completion",
                            billingMode: "fixed_request",
                            unitPriceMicrocredits: 1,
                            capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 16384, references: { promptMaxChars: 32000, maxImages: 3, maxImageBytes: 30 * 1024 * 1024, maxVideos: 0, maxVideoBytes: 0 } } },
                        },
                    ],
                },
                {
                    id: "managed",
                    scope: "system",
                    models: ["managed-vision"],
                    modelCosts: [
                        {
                            model: "managed-vision",
                            capability: "text",
                            protocol: "chat-completion",
                            billingMode: "fixed_request",
                            unitPriceMicrocredits: 1,
                            capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 16384, references: { promptMaxChars: 32000, maxImages: 3, maxImageBytes: 30 * 1024 * 1024, maxVideos: 0, maxVideoBytes: 0 } } },
                        },
                    ],
                },
            ],
        } as unknown as AiConfig;

        expect(selectImageInspectionModel(config, "custom::custom-vision")).toBe("managed::managed-vision");
    });
});
