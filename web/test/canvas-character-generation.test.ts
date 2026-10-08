import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { http } from "../src/services/api/request";
import type { ProjectCharacterDetail } from "../src/services/api/projects";
import * as imageStorage from "../src/services/image-storage";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import type { Asset } from "../src/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const restores: Array<() => void> = [];
afterEach(() =>
    restores
        .splice(0)
        .reverse()
        .forEach((restore) => restore()),
);

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, metadata, position: { x: 0, y: 0 }, width: 100, height: 100 };
}

function characterNode(id: string) {
    return node(id, CanvasNodeType.Text, { workflowKind: "character", characterAssetId: id });
}

function detail(id: string, representations: Array<[string, string]> = [["primary", `${id}-main`]]): ProjectCharacterDetail {
    return {
        asset: { id, title: id, category: "character", mediaType: "entity", status: "ready", versionCount: 1, usages: [], position: 0, updatedAt: "" },
        character: {
            versionId: `${id}-version`,
            version: 1,
            definition: { appearance: "角色外观设定" },
            visualStatus: "ready",
            voiceStatus: "missing",
            representations: representations.map(([role, resourceId], index) => ({ id: `${id}-${index}`, role, resourceId, mediaType: "image/png" })),
        },
    };
}

function mockResources(details: ProjectCharacterDetail[]) {
    const get = spyOn(http, "get").mockImplementation(async (url) => {
        const character = details.find((item) => url === `/characters/${item.asset.id}`);
        if (character) return character as never;
        if (url === "/resources/shared-voice") return { resource: { id: "shared-voice", mimeType: "audio/wav", objectKey: "voice.wav" } } as never;
        throw new Error(`Unexpected request: ${url}`);
    });
    const images = spyOn(imageStorage, "imageToDataUrl").mockImplementation(async (image) => {
        // Resource I/O is stubbed; ordering, character resolution and task serialization run unchanged.
        return `data:image/png;base64,${btoa(image.storageKey || image.dataUrl || "image")}`;
    });
    restores.push(
        () => get.mockRestore(),
        () => images.mockRestore(),
    );
    return { get, images };
}

function contextFor(sources: CanvasNodeData[], prompt: string, assets: Asset[] = [], mode = CanvasNodeType.Video) {
    const target = node("target", mode);
    const connections = sources.map((source) => ({ id: `edge-${source.id}`, fromNodeId: source.id, toNodeId: target.id }));
    return buildNodeGenerationContext(target.id, [...sources, target], connections, prompt, assets, true);
}

function videoConfig() {
    const channel = createModelChannel({
        id: "video-test",
        name: "Video",
        baseUrl: "https://example.com",
        apiKey: "test-key",
        interfaceType: "volcengine-ark-video",
        models: ["video-model"],
        modelCosts: [{ model: "video-model", capability: "video", protocol: "volcengine-ark-video", billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "video-model");
    return { ...defaultConfig, channels: [channel], model, videoModel: model };
}

describe("canvas character reference delivery", () => {
    test("mixed references preserve primary slots through hydration and backend task preparation", async () => {
        const a = detail("a", [
            ["primary", "a-main"],
            ["front", "a-front"],
            ["side", "a-front"],
            ["back", ""],
        ]);
        const b = detail("b", [
            ["primary", "b-main"],
            ["front", "b-front"],
        ]);
        const voice = {
            profile: { id: "voice", name: "声音", provider: "sample", voiceKey: "voice-key", language: "中文", timbre: "低沉", sampleResourceId: "shared-voice", compatibleModels: [], status: "ready" },
            instructions: "轻声朗读",
        };
        a.character.voice = voice;
        b.character.voice = voice;
        mockResources([a, b]);
        const asset: Asset = {
            id: "library-image",
            kind: "image",
            title: "素材图",
            tags: [],
            createdAt: "",
            updatedAt: "",
            data: { dataUrl: "", storageKey: "resource:library", mimeType: "image/png", bytes: 1, width: 1, height: 1 },
        };
        const context = contextFor(
            [characterNode("a"), node("scene", CanvasNodeType.Image, { storageKey: "resource:scene" }), characterNode("b"), node("audio", CanvasNodeType.Audio, { storageKey: "resource:music" })],
            "@图片2场景里@角色3看向@角色1，参考@[asset:library-image]，配合@音频1",
            [asset],
        );
        const hydrated = await hydrateNodeGenerationContext(context, "canvas", undefined, "video", true, false, { maxImages: 6, maxVideos: 1, maxAudios: 2 });
        const expectedKeys = ["resource:a-main", "resource:scene", "resource:b-main", "resource:library", "resource:a-front", "resource:b-front"];
        expect(hydrated.referenceImages.map((image) => image.storageKey)).toEqual(expectedKeys);
        expect(hydrated.prompt).toStartWith("@图片2场景里@图片3看向@图片1，参考@图片4，配合@音频1");
        expect(hydrated.prompt).toContain("【角色卡：a】\n参考图片：@图片1；补充视角：@图片5");
        expect(hydrated.prompt).toContain("【角色卡：b】\n参考图片：@图片3；补充视角：@图片6");
        expect(hydrated.prompt).toContain("【角色声音：a】\n声音参考：@音频2");
        expect(hydrated.prompt).toContain("【角色声音：b】\n声音参考：@音频2");
        expect(hydrated.prompt).not.toContain("角色外观设定");
        expect(hydrated.prompt).not.toContain("轻声朗读");
        expect(hydrated.referenceAudios.map((audio) => audio.storageKey)).toEqual(["resource:music", "resource:shared-voice"]);
        expect(hydrated.resolvedCharacterVersions).toEqual([
            { assetId: "a", versionId: "a-version" },
            { assetId: "b", versionId: "b-version" },
        ]);

        const task = await prepareBackendGenerationTask({ mode: "video", config: videoConfig(), prompt: hydrated.prompt, referenceImages: hydrated.referenceImages, referenceAudios: hydrated.referenceAudios });
        const input = task.input as { prompt: string; referenceImages: Array<{ storageKey: string }>; referenceAudios: Array<{ storageKey: string }> };
        expect(input.prompt).toBe(hydrated.prompt);
        expect(input.referenceImages.map((image) => image.storageKey)).toEqual(expectedKeys);
        expect(input.referenceAudios.map((audio) => audio.storageKey)).toEqual(["resource:music", "resource:shared-voice"]);
    });

    test("reserved primary images cannot be displaced by supplements", async () => {
        mockResources([
            detail("a", [
                ["primary", "a-main"],
                ["front", "a-front"],
            ]),
            detail("b"),
        ]);
        const context = contextFor([characterNode("a"), node("scene", CanvasNodeType.Image, { storageKey: "resource:scene" }), characterNode("b")], "@角色3与@角色1");
        const hydrated = await hydrateNodeGenerationContext(context, "canvas", undefined, "video", false, true, { maxImages: 3, maxVideos: 0, maxAudios: 0 });
        expect(hydrated.referenceImages.map((image) => image.storageKey)).toEqual(["resource:a-main", "resource:scene", "resource:b-main"]);
        expect(hydrated.prompt).not.toContain("补充视角");
        await expect(hydrateNodeGenerationContext(context, "canvas", undefined, "video", false, true, { maxImages: 2, maxVideos: 0, maxAudios: 0 })).rejects.toThrow("参考图容量不足");
    });

    test("pinned version changes and missing image identities stop submission", async () => {
        mockResources([detail("a")]);
        const source = characterNode("a");
        source.metadata = { ...source.metadata, characterVersionPolicy: "pinned", characterVersionId: "old-version" };
        await expect(hydrateNodeGenerationContext(contextFor([source], "@角色1"), "canvas", undefined, "video")).rejects.toThrow("固定版本已变化");
    });

    test("image and video generation reject character cards without a usable main image", async () => {
        mockResources([detail("a", [["primary", ""]])]);
        const context = contextFor([characterNode("a")], "@角色1");
        for (const mode of ["image", "video"] as const) {
            await expect(hydrateNodeGenerationContext(context, "canvas", undefined, mode)).rejects.toThrow("缺少可用的主参考图");
        }
    });

    test("text and audio may use an imageless character without shifting another image to the wrong mention", async () => {
        mockResources([detail("a", []), detail("b")]);
        const context = contextFor([characterNode("a"), node("scene", CanvasNodeType.Image, { storageKey: "resource:scene" }), characterNode("b")], "@角色1对@角色3说话，位于@图片2");
        for (const mode of ["text", "audio"] as const) {
            const hydrated = await hydrateNodeGenerationContext(context, "canvas", undefined, mode);
            expect(hydrated.prompt).toStartWith("a对@图片2说话，位于@图片1");
            expect(hydrated.referenceImages.map((image) => image.storageKey)).toEqual(["resource:scene", "resource:b-main"]);
            expect(hydrated.prompt).toContain("【角色卡：b】\n角色外观设定\n参考图片：@图片2");
        }
    });

    test("character authorization and image delivery failures remain errors", async () => {
        const { get, images } = mockResources([detail("a")]);
        const context = contextFor([characterNode("a")], "@角色1");
        get.mockRejectedValueOnce(new Error("无权读取角色"));
        await expect(hydrateNodeGenerationContext(context, "canvas", undefined, "video")).rejects.toThrow("无权读取角色");
        images.mockRejectedValueOnce(new Error("图片下载失败"));
        await expect(hydrateNodeGenerationContext(context, "canvas", undefined, "video")).rejects.toThrow("图片下载失败");
    });
});
