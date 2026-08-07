import { describe, expect, test } from "bun:test";

import {
    collectStoryboardInputSlots,
    migrateStoryboardContextConnections,
    nearestStoryboardSlotHandle,
    resolveStoryboardDownstreamRefs,
    STORYBOARD_SLOT_HANDLE,
    storyboardSlotHandleWorldY,
    suggestStoryboardInputSlot,
} from "../src/lib/canvas/storyboard-input-slots";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "../src/types/canvas";

function node(partial: Partial<CanvasNodeData> & { id: string; type: CanvasNodeType }): CanvasNodeData {
    return {
        title: partial.title || partial.id,
        position: { x: 0, y: 0 },
        width: 200,
        height: 120,
        ...partial,
        metadata: partial.metadata || {},
    };
}

function row(partial: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        id: "r1",
        shotNumber: 1,
        durationSeconds: 5,
        plotDescription: "测试",
        dialogue: "",
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        referenceNodeIds: [],
        ...partial,
    };
}

describe("storyboard input slots", () => {
    test("按 toHandleId 分五槽", () => {
        const script = node({ id: "script", type: CanvasNodeType.Script });
        const story = node({ id: "story", type: CanvasNodeType.Text, title: "章节" });
        const char = node({ id: "char", type: CanvasNodeType.Text, metadata: { workflowKind: "character", characterAssetId: "a1", characterVersionId: "v1", characterName: "林时" } });
        const style = node({ id: "style", type: CanvasNodeType.Text, metadata: { workflowKind: "styleboard", stylePresetId: "p1", content: "写实" } });
        const bg = node({ id: "bg", type: CanvasNodeType.Image, title: "雨夜公寓", metadata: { content: "data:image/png;base64,x", workflowKind: "scene" } });
        const prop = node({ id: "prop", type: CanvasNodeType.Image, title: "怀表", metadata: { content: "data:image/png;base64,y" } });
        const connections: CanvasConnection[] = [
            { id: "1", fromNodeId: "story", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.story },
            { id: "2", fromNodeId: "char", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.characters },
            { id: "3", fromNodeId: "style", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.style },
            { id: "4", fromNodeId: "bg", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.background },
            { id: "5", fromNodeId: "prop", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.props },
        ];
        const slots = collectStoryboardInputSlots("script", [script, story, char, style, bg, prop], connections);
        expect(slots.story.map((n) => n.id)).toEqual(["story"]);
        expect(slots.characters.map((n) => n.id)).toEqual(["char"]);
        expect(slots.style.map((n) => n.id)).toEqual(["style"]);
        expect(slots.background.map((n) => n.id)).toEqual(["bg"]);
        expect(slots.props.map((n) => n.id)).toEqual(["prop"]);
        expect(slots.legacyContext).toEqual([]);
    });

    test("旧 context 连接启发式迁移到槽", () => {
        const script = node({ id: "script", type: CanvasNodeType.Script });
        const char = node({ id: "char", type: CanvasNodeType.Text, metadata: { workflowKind: "character", characterAssetId: "a1" } });
        const style = node({ id: "style", type: CanvasNodeType.Text, metadata: { workflowKind: "styleboard" } });
        const chapter = node({ id: "chapter", type: CanvasNodeType.Text, title: "第1章", metadata: { content: "很长的正文" } });
        const connections: CanvasConnection[] = [
            { id: "1", fromNodeId: "char", toNodeId: "script", toHandleId: "storyboard:context" },
            { id: "2", fromNodeId: "style", toNodeId: "script" },
            { id: "3", fromNodeId: "chapter", toNodeId: "script", toHandleId: "context" },
        ];
        const slots = collectStoryboardInputSlots("script", [script, char, style, chapter], connections);
        expect(slots.characters.map((n) => n.id)).toEqual(["char"]);
        expect(slots.style.map((n) => n.id)).toEqual(["style"]);
        expect(slots.story.map((n) => n.id)).toEqual(["chapter"]);

        const migrated = migrateStoryboardContextConnections("script", [script, char, style, chapter], connections);
        expect(migrated.find((c) => c.fromNodeId === "char")?.toHandleId).toBe(STORYBOARD_SLOT_HANDLE.characters);
        expect(migrated.find((c) => c.fromNodeId === "style")?.toHandleId).toBe(STORYBOARD_SLOT_HANDLE.style);
        expect(migrated.find((c) => c.fromNodeId === "chapter")?.toHandleId).toBe(STORYBOARD_SLOT_HANDLE.story);
    });

    test("下游 ref：角色必送、正文不送、背景可关", () => {
        const script = node({
            id: "script",
            type: CanvasNodeType.Script,
            metadata: {
                storyboardInputPolicy: { backgroundToActionBoard: false, styleToActionBoard: true, propsToActionBoard: true },
            },
        });
        const story = node({ id: "story", type: CanvasNodeType.Text });
        const char = node({ id: "char", type: CanvasNodeType.Text, metadata: { workflowKind: "character", characterAssetId: "a1" } });
        const style = node({ id: "style", type: CanvasNodeType.Text, metadata: { workflowKind: "styleboard" } });
        const bg = node({ id: "bg", type: CanvasNodeType.Image, metadata: { content: "x" } });
        const prop = node({ id: "prop", type: CanvasNodeType.Image, metadata: { content: "y" } });
        const connections: CanvasConnection[] = [
            { id: "1", fromNodeId: "story", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.story },
            { id: "2", fromNodeId: "char", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.characters },
            { id: "3", fromNodeId: "style", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.style },
            { id: "4", fromNodeId: "bg", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.background },
            { id: "5", fromNodeId: "prop", toNodeId: "script", toHandleId: STORYBOARD_SLOT_HANDLE.props },
            { id: "6", fromNodeId: "extra", toNodeId: "script", toHandleId: "row:r1" },
        ];
        const extra = node({ id: "extra", type: CanvasNodeType.Image, metadata: { content: "z" } });
        const refs = resolveStoryboardDownstreamRefs({
            stage: "action_board",
            scriptNode: script,
            row: row({ id: "r1" }),
            nodes: [script, story, char, style, bg, prop, extra],
            connections,
        });
        expect(refs).toContain("char");
        expect(refs).toContain("style");
        expect(refs).toContain("prop");
        expect(refs).toContain("extra");
        expect(refs).not.toContain("story");
        expect(refs).not.toContain("bg"); // policy off
    });

    test("suggestStoryboardInputSlot 基础映射", () => {
        expect(suggestStoryboardInputSlot(node({ id: "c", type: CanvasNodeType.Text, metadata: { workflowKind: "character" } }))).toBe("characters");
        expect(suggestStoryboardInputSlot(node({ id: "s", type: CanvasNodeType.Text, metadata: { workflowKind: "styleboard" } }))).toBe("style");
        expect(suggestStoryboardInputSlot(node({ id: "t", type: CanvasNodeType.Text, metadata: { workflowKind: "story_input" } }))).toBe("story");
        expect(suggestStoryboardInputSlot(node({ id: "i", type: CanvasNodeType.Image, title: "道具刀", metadata: { content: "x" } }))).toBe("props");
    });

    test("nearestStoryboardSlotHandle 按 Y 吸附最近槽，不写死画风", () => {
        const script = node({
            id: "script",
            type: CanvasNodeType.Script,
            position: { x: 100, y: 100 },
            width: 400,
            height: 400,
            metadata: { storyboardComposerHeight: 160, storyboard: { rows: [], visibleColumns: [], referenceNodeIds: [] } },
        });
        const storyY = storyboardSlotHandleWorldY(script, "story");
        const charY = storyboardSlotHandleWorldY(script, "characters");
        const propsY = storyboardSlotHandleWorldY(script, "props");
        expect(nearestStoryboardSlotHandle(script, storyY)).toBe(STORYBOARD_SLOT_HANDLE.story);
        expect(nearestStoryboardSlotHandle(script, charY)).toBe(STORYBOARD_SLOT_HANDLE.characters);
        expect(nearestStoryboardSlotHandle(script, propsY)).toBe(STORYBOARD_SLOT_HANDLE.props);
        expect(nearestStoryboardSlotHandle(script, charY + 2)).toBe(STORYBOARD_SLOT_HANDLE.characters);
    });
});
