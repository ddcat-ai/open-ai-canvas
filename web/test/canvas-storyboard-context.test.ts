import { describe, expect, it } from "bun:test";

import { resolveStoryboardGenerationContext } from "@/lib/canvas/canvas-storyboard-context";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
});

const styleNode = node("style", CanvasNodeType.Text, {
    workflowKind: "styleboard",
    stylePresetId: "style-v1",
    content: "统一的项目画风",
});

describe("storyboard generation context", () => {
    it("ignores standalone character-design workflows without a linked asset", () => {
        const context = resolveStoryboardGenerationContext([
            styleNode,
            node("character-turnaround", CanvasNodeType.Image, {
                workflowKind: "character",
                composerContent: "生成角色三视图",
            }),
        ]);

        expect(context.characters).toEqual([]);
    });

    it("keeps the version check for linked character cards", () => {
        expect(() => resolveStoryboardGenerationContext([
            styleNode,
            node("character-card", CanvasNodeType.Text, {
                workflowKind: "character",
                characterAssetId: "asset-1",
                characterName: "李当歌",
            }),
        ])).toThrow("角色卡“李当歌”版本未同步");
    });

    it("passes linked character cards with a current version", () => {
        const context = resolveStoryboardGenerationContext([
            styleNode,
            node("character-card", CanvasNodeType.Text, {
                workflowKind: "character",
                characterAssetId: "asset-1",
                characterVersionId: "version-1",
                characterName: "李当歌",
                characterDefinition: { role: "镇国公世子" },
            }),
        ]);

        expect(context.characters).toEqual([{
            assetId: "asset-1",
            versionId: "version-1",
            name: "李当歌",
            definition: { role: "镇国公世子" },
        }]);
    });
});
