import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "@/lib/canvas/canvas-project-generation";
import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { videoRemakeInputIssue } from "@/lib/canvas/canvas-video-regeneration";
import { buildVideoRemakeDraft } from "@/lib/canvas/canvas-video-remake";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

const seedance = "seedance-2.0";
const channel = createModelChannel({
    id: "remake",
    name: "视频参考",
    interfaceType: "volcengine-ark-video",
    models: [seedance],
    modelCosts: [{ model: seedance, protocol: "volcengine-ark-video", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 1 }],
});
const model = encodeChannelModel(channel.id, channel.models[0]);
const config = { ...defaultConfig, channels: [channel], videoModel: model };
const video: CanvasNodeData = { id: "source", type: CanvasNodeType.Video, title: "样片", position: { x: 80, y: 120 }, width: 720, height: 405, metadata: { storageKey: "resource:original", durationMs: 6000, naturalWidth: 720, naturalHeight: 1280 } };
const image: CanvasNodeData = { ...video, id: "portrait", type: CanvasNodeType.Image, title: "角色", metadata: { storageKey: "resource:portrait" } };
const scene: CanvasNodeData = { ...image, id: "scene", title: "场景", metadata: { storageKey: "resource:scene" } };
const link = (from: string, to: string): CanvasConnection => ({ id: `${from}:${to}`, fromNodeId: from, toNodeId: to });

async function prepare(draft: ReturnType<typeof buildVideoRemakeDraft>, prompt = nodeGenerationPrompt(draft.target)) {
    const context = buildNodeGenerationContext(draft.target.id, draft.nodes, draft.connections, prompt, [], true);
    const selected = buildGenerationConfig(config, draft.target, "video");
    return prepareBackendGenerationTask({
        mode: "video",
        config: selected,
        prompt: context.prompt,
        referenceVideos: context.referenceVideos,
        referenceImages: context.referenceImages,
        metadata: buildVideoGenerationMetadata(draft.target, context, selected),
    });
}

describe("视频复刻草稿", () => {
    test("生成面板的缺图、补图和手动提交", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-video-remake-panel.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
        expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0);
    }, 30000);

    test("生成视频按输入边顺序复用参考图，保留原图和原片，任务实际收到图和视频", async () => {
        const source = { ...video, metadata: { ...video.metadata, taskId: "old-task", status: "success" as const, videoReferenceMode: "frames" as const, videoStartFrameNodeId: image.id, videoPreview: { content: "poster.jpg" }, prompt: "旧提示词" } };
        const original = [source, scene, image];
        const originalLinks = [link(image.id, source.id), link(scene.id, source.id), { ...link(image.id, source.id), id: "duplicate" }];
        const draft = buildVideoRemakeDraft(source.id, original, originalLinks, config);
        expect(draft.nodes).toEqual([...original, draft.target]);
        expect(draft.connections.slice(0, originalLinks.length)).toEqual(originalLinks);
        expect(draft.connections.slice(originalLinks.length).map((edge) => [edge.fromNodeId, edge.toNodeId])).toEqual([video, image, scene].map((input) => [input.id, draft.target.id]));
        expect(draft.target.metadata).toMatchObject({ status: "idle", content: "", videoReferenceMode: "all", model, size: "9:16", seconds: "6" });
        expect(draft.target.metadata?.taskId).toBeUndefined();
        expect(draft.target.metadata?.videoStartFrameNodeId).toBeUndefined();
        expect(draft.target.metadata?.videoPreview).toBeUndefined();
        expect(draft.target.metadata?.composerContent).not.toContain("旧提示词");
        const task = await prepare(draft);
        expect(task).toMatchObject({
            operation: "reference_to_video",
            prompt: draft.target.metadata?.composerContent,
            input: { referenceImages: [{ storageKey: "resource:portrait" }, { storageKey: "resource:scene" }], referenceVideos: [{ storageKey: "resource:original" }] },
        });
        expect(task.prompt).toContain("@图片2");
        expect(task.prompt).toContain("@视频1");
    });

    test("上传视频没有参考图时预连空位；补图前不提交，不选取无关画布图片", async () => {
        const draft = buildVideoRemakeDraft(video.id, [video, scene], [], config);
        const slot = draft.nodes.find((node) => node.title === "复刻参考图")!;
        expect(slot.type).toBe(CanvasNodeType.Image);
        expect(draft.connections.map((edge) => [edge.fromNodeId, edge.toNodeId])).toEqual([
            [video.id, draft.target.id],
            [slot.id, draft.target.id],
        ]);
        await expect(prepare(draft)).rejects.toThrow("没有对应的画布资源");
        await expect(prepare(draft, "沿用运镜")).rejects.toThrow("缺少参考图片");
        const filled = { ...draft, nodes: draft.nodes.map((node) => (node === slot ? { ...slot, metadata: image.metadata } : node)) };
        expect(await prepare(filled)).toMatchObject({ operation: "reference_to_video", input: { referenceImages: [{ storageKey: "resource:portrait" }], referenceVideos: [{ storageKey: "resource:original" }] } });
        await expect(prepare({ ...filled, connections: filled.connections.filter((edge) => edge.fromNodeId !== video.id) }, "更换主体")).rejects.toThrow("缺少动作参考");
    });

    test("参考时长按模型检查；未知不猜测，普通全能参考不强制要求图片", () => {
        const metadata = { videoRemake: true, videoReferenceMode: "all" } as const;
        expect(videoRemakeInputIssue(metadata, 1, [16000], { ...config, model })).toContain("参考片段");
        expect(videoRemakeInputIssue(metadata, 1, [1000], { ...config, model })).toContain("至少 2 秒");
        expect(videoRemakeInputIssue(metadata, 1, [0], { ...config, model })).toBe("");
        expect(videoRemakeInputIssue({ videoReferenceMode: "all" }, 0, [], config)).toBe("");
    });

    test("生成配置的实际输入按角色分工，不把排在第一张的场景当主角或把下游图片当原始参考", async () => {
        const generatingConfig = { ...video, id: "generator", type: CanvasNodeType.Config, metadata: { generationMode: "video" as const } };
        const otherConfig = { ...generatingConfig, id: "other-generator" };
        const background = { ...scene, metadata: { ...scene.metadata, assetCategory: "environment" as const } };
        const character = { ...image, metadata: { ...image.metadata, assetCategory: "character" as const } };
        const prop = { ...image, id: "cup", metadata: { storageKey: "resource:cup", assetCategory: "prop" as const } };
        const style = { ...image, id: "style", metadata: { storageKey: "resource:style", workflowKind: "styleboard" as const } };
        const unrelated = { ...image, id: "downstream-image" };
        const draft = buildVideoRemakeDraft(
            video.id,
            [background, prop, style, character, generatingConfig, video, otherConfig, unrelated],
            [
                link(background.id, generatingConfig.id),
                link(character.id, generatingConfig.id),
                link(prop.id, generatingConfig.id),
                link(style.id, generatingConfig.id),
                link(generatingConfig.id, video.id),
                link(video.id, otherConfig.id),
                link(unrelated.id, otherConfig.id),
            ],
            config,
        );
        const task = await prepare(draft);
        expect(task.input.referenceImages.map((reference) => reference.id)).toEqual([background.id, character.id, prop.id, style.id]);
        expect(task.prompt).toContain("@图片1 只替换布景");
        expect(task.prompt).toContain("@图片2 替换承担主要动作的角色");
        expect(task.prompt).toContain("@图片3 替换对应的道具");
        expect(task.prompt).toContain("@图片4 只取画风");
    });

    test("只有场景图时不强制换人；未配置混合参考模型仍能准备草稿", () => {
        const background = { ...scene, metadata: { ...scene.metadata, workflowKind: "scene" as const } };
        const draft = buildVideoRemakeDraft(video.id, [video, background], [link(background.id, video.id)], { ...config, channels: [] });
        expect(draft.nodes).toHaveLength(3);
        expect(draft.target.metadata?.model).toBeUndefined();
        const prompt = nodeGenerationPrompt(draft.target);
        expect(prompt).toContain("@图片1 只替换布景");
        expect(prompt).not.toContain("替换原片的主要展示对象");
        expect(prompt).not.toContain("@图片2");
    });

    test("分镜时间码取自原片的分镜表，按时间顺序使用启用行的最新镜头笔记", async () => {
        const rows = [
            createStoryboardRow(2, { sourceStartMs: 2400, sourceEndMs: 6000, performanceBlocking: "杯把转向镜头", camera: "旧机位", dialogue: "旧广告词" }),
            createStoryboardRow(1, { sourceStartMs: 0, sourceEndMs: 2400, shotSize: "中景", motion: "固定机位", performanceBlocking: "手指扣住杯把" }),
            createStoryboardRow(3, { plotDescription: "未标时间的设想" }),
            createStoryboardRow(4, { sourceStartMs: 1000, sourceEndMs: 2000, camera: "停用的机位" }),
        ];
        const table: CanvasNodeData = {
            ...video,
            id: "breakdown",
            type: CanvasNodeType.BatchTable,
            metadata: {
                batchTable: {
                    operation: "creative",
                    contentKind: "storyboard",
                    concurrency: 1,
                    storyboardSourceNodeIds: [video.id],
                    storyboardRows: rows,
                    rows: rows.map((row, index) => ({ id: row.id, enabled: index !== 3, inputNodeIds: [video.id], prompt: "", cells: index === 0 ? { "storyboard-camera": "杯沿高度侧拍" } : undefined })),
                },
            },
        };
        const edges = [link(image.id, video.id), link(video.id, table.id)];
        const prompt = (await prepare(buildVideoRemakeDraft(video.id, [video, image, table], edges, config))).prompt;
        expect(prompt).toContain("0–2.4 秒｜中景，固定机位，手指扣住杯把\n2.4–6 秒｜杯沿高度侧拍，杯把转向镜头");
        expect(prompt).not.toMatch(/旧广告词|未标时间的设想|停用的机位|旧机位/u);
        const secondVideo = { ...video, id: "second" };
        const mixed = { ...table, metadata: { batchTable: { ...table.metadata!.batchTable!, storyboardSourceNodeIds: [video.id, secondVideo.id] } } };
        for (const draft of [buildVideoRemakeDraft(video.id, [video, image, table], edges.slice(0, 1), config), buildVideoRemakeDraft(video.id, [video, image, mixed, secondVideo], [...edges, link(secondVideo.id, mixed.id)], config)]) {
            expect(nodeGenerationPrompt(draft.target)).not.toContain("原片镜头笔记");
        }
    });

    test("只有封面或尚未就绪的视频不能建草稿；重复复刻不会覆盖已有节点", () => {
        for (const metadata of [
            { previewContent: "poster.jpg" },
            { content: "old.mp4", status: "loading" },
            { content: "old.mp4", taskId: "queued-job", taskStatus: "queued" },
            { storageKey: "resource:old", fileUpload: "uploading" },
        ] satisfies CanvasNodeMetadata[]) {
            expect(() => buildVideoRemakeDraft(video.id, [{ ...video, metadata }], [], config)).toThrow("原视频尚不可用");
        }
        const first = buildVideoRemakeDraft(video.id, [video], [], config);
        const second = buildVideoRemakeDraft(video.id, first.nodes, first.connections, config);
        expect(second.target.position).not.toEqual(first.target.position);
        expect(second.target.id).not.toBe(first.target.id);
    });
});
