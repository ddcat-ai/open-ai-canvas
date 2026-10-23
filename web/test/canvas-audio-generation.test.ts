import { describe, expect, test } from "bun:test";
import { canGenerateMediaInPlace } from "@/lib/canvas/canvas-generation-layout";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("Audio generation layout and in-place reuse", () => {
    test("Audio node marked with replace-node or variant/copy can generate in place", () => {
        const audioNodeWithContent: CanvasNodeData = {
            id: "audio-1",
            type: CanvasNodeType.Audio,
            title: "音频1",
            position: { x: 100, y: 100 },
            width: 320,
            height: 90,
            metadata: {
                content: "/api/resources/audio-1/file",
                storageKey: "resource:audio-1",
            },
        };
        // 初始已有内容的音频节点默认不原地覆盖
        expect(canGenerateMediaInPlace(audioNodeWithContent, CanvasNodeType.Audio)).toBe(false);

        // 创建变体或副本后的音频节点，带有 generationResultPlacement: 'replace-node'
        const variantNode: CanvasNodeData = {
            ...audioNodeWithContent,
            id: "audio-2",
            metadata: {
                ...audioNodeWithContent.metadata,
                generationResultPlacement: "replace-node",
                copiedFromNodeId: "audio-1",
                versionOfNodeId: "audio-1",
            },
        };
        // 应该允许原地生成，替换节点自身而不是多生成一个游离节点
        expect(canGenerateMediaInPlace(variantNode, CanvasNodeType.Audio)).toBe(true);

        // 空音频节点（未生成或无内容）应允许原地生成
        const emptyAudioNode: CanvasNodeData = {
            ...audioNodeWithContent,
            id: "audio-3",
            metadata: {},
        };
        expect(canGenerateMediaInPlace(emptyAudioNode, CanvasNodeType.Audio)).toBe(true);
    });
});
