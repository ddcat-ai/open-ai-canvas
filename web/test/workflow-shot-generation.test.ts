import { expect, test } from "bun:test";

import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import { submitBackendGenerationTask, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import type { GenerationTask } from "../src/services/api/task-center";
import type { ProjectDetail } from "../src/services/api/projects";
import { buildShotAssetReferenceContext, resolveShotAssetMentionPrompt } from "../src/pages/projects/detail/workflow-shot-references";

function videoTaskConfig() {
    const channel = createModelChannel({
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimaxi.com",
        apiKey: "test-key",
        interfaceType: "minimax-video",
        models: ["MiniMax-H3"],
        modelCosts: [{ model: "MiniMax-H3", capability: "video", protocol: "minimax-video", billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "MiniMax-H3");
    return { ...defaultConfig, channels: [channel], model, videoModel: model };
}

test("production workbench does not silently drop bound voice samples before backend validation", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();

    expect(source).toContain('const generationReferenceAudios = generationCapability === "video" ? shotAssetReferenceContext.referenceAudios : [];');
    expect(source).not.toContain("selectedVideoProfile?.references.maxAudios");
});

test("shot generation submits historical character image, current voice and asset prompt", async () => {
    const detail = {
        assets: [
            {
                id: "character-1",
                title: "张天昊",
                category: "character",
                mediaType: "image",
                primaryVersionId: "character-version-2",
                character: {
                    versionId: "character-version-2",
                    definition: { voiceLanguage: "普通话", voiceAge: "青年男性", voiceTimbre: "略带疲惫和震惊" },
                    representations: [{ id: "representation-1", resourceId: "character-image-1", mediaType: "image/png", role: "primary" }],
                    voice: { profile: { sampleResourceId: "character-audio-1", language: "普通话", timbre: "沉稳" }, instructions: "内心独白语气" },
                },
            },
            {
                id: "scene-1",
                title: "坑底场景",
                category: "environment",
                mediaType: "image",
                primaryVersionId: "scene-version-1",
                storageKey: "resource:scene-image-1",
            },
        ],
        shotReferences: [
            {
                shotId: "shot-1",
                assetVersionId: "character-version-1",
                status: "linked",
                asset: {
                    id: "character-1",
                    title: "张天昊",
                    category: "character",
                    mediaType: "entity",
                    primaryVersionId: "character-version-2",
                    character: {
                        versionId: "character-version-2",
                        definition: { voiceLanguage: "普通话", voiceAge: "青年男性", voiceTimbre: "略带疲惫和震惊" },
                        representations: [{ id: "representation-2", resourceId: "character-image-2", mediaType: "image/png", role: "primary" }],
                        voice: { profile: { sampleResourceId: "character-audio-1", language: "普通话", timbre: "沉稳" }, instructions: "内心独白语气" },
                    },
                },
                referencedVersion: {
                    id: "character-version-1",
                    assetId: "character-1",
                    version: 1,
                    representations: [{ id: "representation-1", resourceId: "character-image-1", mediaType: "image/png", role: "primary" }],
                },
            },
            { shotId: "shot-1", assetVersionId: "scene-version-1", status: "linked" },
        ],
    } as ProjectDetail;

    const context = buildShotAssetReferenceContext(detail, "shot-1");
    const prompt = resolveShotAssetMentionPrompt("张天昊在 @[asset:scene-1] 睁开眼睛", context, { dialogue: "我穿越了？瓦西国张家废柴少主？" });

    expect(context.referenceImages).toHaveLength(2);
    expect(context.referenceImages[0]?.storageKey).toBe("resource:character-image-1");
    expect(context.referenceAudios).toHaveLength(1);
    expect(context.referenceAudios[0]?.storageKey).toBe("resource:character-audio-1");
    expect(context.resolvedCharacterVersions).toEqual([{ assetId: "character-1", versionId: "character-version-1" }]);
    expect(prompt).toContain("张天昊在 图片2 睁开眼睛");
    expect(prompt).toContain("- 张天昊：人物参考：图片1；声音参考：音频1");
    expect(prompt).toContain("声音画像：普通话；青年男性；略带疲惫和震惊；内心独白语气");
    expect(prompt).toContain("镜头台词：我穿越了？瓦西国张家废柴少主？");
    expect(prompt).toContain("- 坑底场景：场景参考：图片2");

    let createdInput: Parameters<GenerationTaskDependencies["createTask"]>[0] | undefined;
    const task = {
        id: "shot-task-1",
        type: "canvas_video",
        status: "queued",
        prompt,
        attempts: 0,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
    } satisfies GenerationTask;
    await submitBackendGenerationTask({
        projectId: "project-1",
        mode: "video",
        prompt,
        config: videoTaskConfig(),
        referenceImages: context.referenceImages,
        referenceAudios: context.referenceAudios,
        metadata: { shotId: "shot-1", videoEditOperation: "reference_to_video" },
    }, {
        createTask: async (input) => { createdInput = input; return task; },
        waitTask: async () => { throw new Error("should not wait"); },
        runLocal: async () => ({ mode: "video" }),
        createId: () => "shot-asset-reference-submission",
        now: () => "2026-08-30T00:00:00.000Z",
    });

    expect(createdInput?.prompt).toContain("【资产参考】");
    expect(createdInput?.input.referenceImages.map((reference) => reference.storageKey)).toEqual(["resource:character-image-1", "resource:scene-image-1"]);
    expect(createdInput?.input.referenceAudios.map((reference) => reference.storageKey)).toEqual(["resource:character-audio-1"]);
});

test("background generation submission returns after task creation without waiting", async () => {
    let waitCalls = 0;
    const task = {
        id: "task-1",
        type: "canvas_video",
        status: "queued",
        prompt: "角色表演",
        attempts: 0,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
    } satisfies GenerationTask;
    const dependencies: GenerationTaskDependencies = {
        createTask: async () => task,
        waitTask: async () => {
            waitCalls += 1;
            throw new Error("should not wait");
        },
        runLocal: async () => ({ mode: "video" }),
        createId: () => "background-video-submission",
        now: () => "2026-08-30T00:00:00.000Z",
    };

    const submitted = await submitBackendGenerationTask({
        projectId: "project-1",
        mode: "video",
        prompt: "角色表演",
        config: videoTaskConfig(),
        metadata: { shotId: "shot-1", videoEditOperation: "reference_to_video" },
    }, dependencies);

    expect(submitted).toBe(task);
    expect(waitCalls).toBe(0);
});
