import { describe, expect, test } from "bun:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import { imageGenerationReferenceConnections } from "../src/lib/canvas/canvas-resource-references";

describe("image generation connections", () => {
    test("重新生成已有图片节点时，只有在用户显式引用源图时才连接源图，避免误将旧结果当作参考图", () => {
        const sourceImageNode: CanvasNodeData = {
            id: "img-1",
            type: CanvasNodeType.Image,
            title: "第一次生成结果",
            position: { x: 0, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,mock",
                storageKey: "user:img-1:file",
            },
        };

        const rootId = "img-2";
        const workingNodes = [sourceImageNode];
        const workingConnections: CanvasConnection[] = [];

        // Case 1: 用户修改提示词重新生成（未显式 @ 源图）
        const referenceImagesNone: any[] = [];
        const isExistingImageNode = sourceImageNode.type === CanvasNodeType.Image && Boolean(sourceImageNode.metadata?.content);
        const reuseSourceNode = false;

        const connectsSelfNoMention = !isExistingImageNode || referenceImagesNone.some((img) => img.id === sourceImageNode.id);
        expect(connectsSelfNoMention).toBe(false);

        const batchConnectionsNoMention = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(sourceImageNode.id, rootId, workingNodes, workingConnections, () => "c1")),
            ...(reuseSourceNode || !connectsSelfNoMention ? [] : [{ id: "c-self", fromNodeId: sourceImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：不应存在从 img-1 到 img-2 的连接
        expect(batchConnectionsNoMention.some((c) => c.fromNodeId === sourceImageNode.id && c.toNodeId === rootId)).toBe(false);
        expect(batchConnectionsNoMention.length).toBe(0);

        // Case 2: 用户在提示词中显式 @图片1 进行图生图
        const referenceImagesMention = [{ id: sourceImageNode.id, dataUrl: "mock" }];
        const connectsSelfWithMention = !isExistingImageNode || referenceImagesMention.some((img) => img.id === sourceImageNode.id);
        expect(connectsSelfWithMention).toBe(true);

        const batchConnectionsWithMention = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(sourceImageNode.id, rootId, workingNodes, workingConnections, () => "c1")),
            ...(reuseSourceNode || !connectsSelfWithMention ? [] : [{ id: "c-self", fromNodeId: sourceImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：显式引用时正确建立从 img-1 到 img-2 的连线
        expect(batchConnectionsWithMention.some((c) => c.fromNodeId === sourceImageNode.id && c.toNodeId === rootId)).toBe(true);
    });

    test("若源图本身带有上游参考素材，新图片节点正确继承上游素材连线而不连接源图自身", () => {
        const upstreamRefNode: CanvasNodeData = {
            id: "ref-source",
            type: CanvasNodeType.Image,
            title: "原始参考图",
            position: { x: 0, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,ref",
                storageKey: "user:ref-source:file",
            },
        };

        const intermediateImageNode: CanvasNodeData = {
            id: "img-intermediate",
            type: CanvasNodeType.Image,
            title: "中间生成图",
            position: { x: 400, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,mid",
                storageKey: "user:img-intermediate:file",
            },
        };

        const existingConnection: CanvasConnection = {
            id: "c-upstream",
            fromNodeId: upstreamRefNode.id,
            toNodeId: intermediateImageNode.id,
        };

        const rootId = "img-new";
        const workingNodes = [upstreamRefNode, intermediateImageNode];
        const workingConnections = [existingConnection];

        const isExistingImageNode = true;
        const reuseSourceNode = false;
        const referenceImagesNone: any[] = [];
        const connectsSelf = !isExistingImageNode || referenceImagesNone.some((img) => img.id === intermediateImageNode.id);

        const batchConnections = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(intermediateImageNode.id, rootId, workingNodes, workingConnections, () => "c-inherited")),
            ...(reuseSourceNode || !connectsSelf ? [] : [{ id: "c-self", fromNodeId: intermediateImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：新节点继承了 upstreamRefNode 的连线，但绝不连接 intermediateImageNode 自身
        expect(batchConnections).toHaveLength(1);
        expect(batchConnections[0].fromNodeId).toBe(upstreamRefNode.id);
        expect(batchConnections[0].toNodeId).toBe(rootId);
    });

    test("重试失败的批次子图时，通过 batchRootId 正确解析上游参考图，避免报错提示缺少画布资源", () => {
        const uploadRefNode: CanvasNodeData = {
            id: "upload-1",
            type: CanvasNodeType.Image,
            title: "参考图素材",
            position: { x: 0, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,upload",
                storageKey: "user:upload-1:file",
                status: "success",
            },
        };

        const batchRootNode: CanvasNodeData = {
            id: "batch-root",
            type: CanvasNodeType.Image,
            title: "批次根节点",
            position: { x: 400, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                composerContent: "参考 @图片1 风格，生成水面倒影",
                prompt: "参考 @图片1 风格，生成水面倒影",
                status: "error",
                isBatchRoot: true,
                batchChildIds: ["child-1", "child-2"],
            },
        };

        const batchChildNode: CanvasNodeData = {
            id: "child-1",
            type: CanvasNodeType.Image,
            title: "批次子图 1",
            position: { x: 800, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                composerContent: "参考 @图片1 风格，生成水面倒影",
                prompt: "参考 @图片1 风格，生成水面倒影",
                status: "error",
                batchRootId: "batch-root",
            },
        };

        const connections: CanvasConnection[] = [
            { id: "c-ref", fromNodeId: "upload-1", toNodeId: "batch-root" },
            { id: "c-batch-1", fromNodeId: "batch-root", toNodeId: "child-1" },
        ];

        const nodes = [uploadRefNode, batchRootNode, batchChildNode];

        // 模拟重试子图定位上下文源节点逻辑
        const batchRoot = batchChildNode.metadata?.batchRootId ? nodes.find((item) => item.id === batchChildNode.metadata?.batchRootId) : null;
        const retryContextNode = batchRoot || batchChildNode;
        expect(retryContextNode.id).toBe("batch-root");

        // 验证从 retryContextNode 能够正确获取上游参考素材
        const prompt = batchChildNode.metadata.composerContent;
        const { buildNodeGenerationContext } = require("../src/components/canvas/canvas-node-generation");
        const context = buildNodeGenerationContext(retryContextNode.id, nodes, connections, prompt, []);

        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceImages[0].id).toBe("upload-1");
        expect(context.prompt).toContain("@图片1");
    });
});
