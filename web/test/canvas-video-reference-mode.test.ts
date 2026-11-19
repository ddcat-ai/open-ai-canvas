import { describe, expect, test } from "bun:test";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { buildVideoGenerationMetadata } from "@/lib/canvas/canvas-project-generation";
import { canvasVideoReferenceMode } from "@/lib/canvas/canvas-video-reference-mode";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

const channel = createModelChannel({ id: "canvas-video", name: "方舟", interfaceType: "volcengine-ark-video", models: ["seedance-2.0"] });
const model = encodeChannelModel(channel.id, "seedance-2.0");
const config = { ...defaultConfig, channels: [channel], model, videoModel: model, interfaceType: channel.interfaceType };

function videoNode(metadata: CanvasNodeMetadata = {}): CanvasNodeData {
    return { id: "shot", type: CanvasNodeType.Video, title: "场景", position: { x: 0, y: 0 }, width: 240, height: 135, metadata };
}

async function prepare(metadata: CanvasNodeMetadata, imageIds: string[], prompt = "镜头拉远") {
    const source = videoNode(metadata);
    const images = imageIds.map((id) => ({ ...source, id, type: CanvasNodeType.Image, metadata: { storageKey: `resource:${id}`, content: `https://media.example/${id}.png` } }));
    const connections = images.map(({ id }) => ({ id: `to-${id}`, fromNodeId: id, toNodeId: source.id }));
    const context = buildNodeGenerationContext(source.id, [...images, source], connections, prompt, [], true);
    const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: context.prompt, referenceImages: context.referenceImages, metadata: buildVideoGenerationMetadata(source, context, config) });
    return { task, ids: context.referenceImages.map((image) => image.id) };
}

describe("画布视频提示词模式与实际任务", () => {
    test("无连线是文生视频；即使上次提交的是文生，连一张图片也使用全能参考", async () => {
        expect(canvasVideoReferenceMode(videoNode(), false)).toBe("text");
        expect((await prepare({}, [])).task).toMatchObject({ operation: "text_to_video", input: { referenceImages: [], metadata: { videoEditOperation: "text_to_video" } } });
        const previous = { videoEditOperation: "text_to_video" } as const;
        expect(canvasVideoReferenceMode(videoNode(previous), true)).toBe("all");
        expect((await prepare(previous, ["forest"])).task).toMatchObject({ operation: "reference_to_video", input: { referenceImages: [{ id: "forest" }], metadata: { videoEditOperation: "reference_to_video", videoStartFrameNodeId: undefined } } });
    });

    test("帧模式只发送指定的首尾帧；交换帧后，正文引用按真实图片顺序重编号", async () => {
        const { task, ids } = await prepare({ videoReferenceMode: "frames", videoStartFrameNodeId: "end", videoEndFrameNodeId: "start" }, ["start", "unused", "end"], "从 @图片3 转到 @图片1");
        expect(ids).toEqual(["end", "start"]);
        expect(task).toMatchObject({
            operation: "image_to_video",
            prompt: "从 @图片1 转到 @图片2",
            input: { referenceImages: [{ id: "end" }, { id: "start" }], metadata: { videoEditOperation: "image_to_video", videoStartFrameNodeId: "end", videoEndFrameNodeId: "start" } },
        });
    });

    test("兼容旧画布已保存的帧节点，且尾帧可留空", async () => {
        expect((await prepare({ videoStartFrameNodeId: "start" }, ["other", "start"])).ids).toEqual(["start"]);
        expect((await prepare({ videoEndFrameNodeId: "end" }, ["end"])).task).toMatchObject({ operation: "image_to_video", input: { metadata: { videoEndFrameNodeId: "end" } } });
    });

    test("手动选文生不拆连线、不夹带旧帧；全能参考也不提交旧帧角色", async () => {
        expect((await prepare({ videoReferenceMode: "text", videoStartFrameNodeId: "old" }, ["forest"])).task).toMatchObject({ operation: "text_to_video", input: { referenceImages: [], metadata: { videoStartFrameNodeId: undefined } } });
        expect((await prepare({ videoReferenceMode: "all", videoEndFrameNodeId: "old" }, ["forest"])).task).toMatchObject({ operation: "reference_to_video", input: { metadata: { videoEndFrameNodeId: undefined } } });
    });

    test("断线、同图双帧或提示词引用了不会发送的素材时，生成前给出原因", async () => {
        await expect(prepare({ videoReferenceMode: "frames", videoStartFrameNodeId: "missing" }, ["other"])).rejects.toThrow("首帧图片已断开");
        await expect(prepare({ videoReferenceMode: "frames", videoStartFrameNodeId: "same", videoEndFrameNodeId: "same" }, ["same"])).rejects.toThrow("同一张");
        await expect(prepare({ videoReferenceMode: "frames", videoStartFrameNodeId: "start" }, ["start", "other"], "参照 @图片2")).rejects.toThrow("首尾帧以外");
        await expect(prepare({ videoReferenceMode: "text" }, ["forest"], "参照 @图片1")).rejects.toThrow("文生视频不使用媒体引用");
    });

    test("工作流字段映射与专用的视频编辑操作不接入三段模式", () => {
        expect(canvasVideoReferenceMode(videoNode({ workflowProvider: "runninghub" }), true)).toBeUndefined();
        expect(canvasVideoReferenceMode(videoNode({ videoEditOperation: "inpaint" }), true)).toBeUndefined();
    });

    test("短剧投送的普通参考与续接帧共存，直到用户显式切换模式", async () => {
        const metadata: CanvasNodeMetadata = { videoStartFrameNodeId: "previous", videoEditOperation: "image_to_video", dramaRef: { kind: "segment", id: "segment", projectId: "drama" } };
        expect((await prepare(metadata, ["cast", "previous"], "参考 @图片1")).task).toMatchObject({ operation: "image_to_video", input: { referenceImages: [{ id: "cast" }, { id: "previous" }], metadata: { videoStartFrameNodeId: "previous" } } });
        expect((await prepare({ ...metadata, videoReferenceMode: "frames" }, ["cast", "previous"])).ids).toEqual(["previous"]);
    });
});
