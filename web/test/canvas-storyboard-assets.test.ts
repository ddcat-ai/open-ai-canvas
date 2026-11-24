import { describe, expect, it } from "bun:test";

import { buildStoryboardAssetCatalog } from "@/lib/canvas/canvas-storyboard-assets";
import { reconcileStoryboardTargetConnections, replaceStoryboardRowAssets, storyboardComposerContent, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { buildNodeMentionReferences, normalizeCanvasNodeMentionTokens } from "@/lib/canvas/canvas-resource-references";

const node = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
});

const row: StoryboardRow = {
    id: "row-1",
    shotNumber: 1,
    durationSeconds: 6,
    plotDescription: "雨夜追逐",
    dialogue: "快走",
    characters: [{ characterName: "林岚", characterAssetId: "character-asset" }],
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
    videoMotionPrompt: "快速跟拍",
    mustHave: [],
    optionalDetails: [],
    continuityOut: "",
    negativePrompt: "",
    assetBindings: [{ nodeId: "prop", role: "prop", priority: 80 }],
    imageNodeId: "first-frame",
    status: "idle",
};

describe("storyboard asset catalog", () => {
    it("sends reusable image, video, audio and character assets but excludes generated shots", () => {
        const assets = buildStoryboardAssetCatalog([
            node("image", CanvasNodeType.Image, { content: "data:image/png;base64,x", assetCategory: "environment" }),
            node("video", CanvasNodeType.Video, { storageKey: "resource:video" }),
            node("audio", CanvasNodeType.Audio, { content: "data:audio/wav;base64,x" }),
            node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "v1" }),
            node("shot", CanvasNodeType.Image, { content: "data:image/png;base64,x", workflowKind: "shot" }),
            node("text", CanvasNodeType.Text, { content: "story" }),
        ]);

        expect(assets.map((asset) => [asset.id, asset.type])).toEqual([
            ["image", "image"],
            ["video", "video"],
            ["audio", "audio"],
            ["character", "character"],
        ]);
    });
});

describe("storyboard target materializer", () => {
    const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row], visibleColumns: [], referenceNodeIds: ["project-style"] } });
    const nodes = [
        script,
        node("project-style", CanvasNodeType.Image, { content: "style" }),
        node("prop", CanvasNodeType.Image, { content: "prop" }),
        node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset" }),
        node("manual", CanvasNodeType.Video, { content: "video" }),
        node("direct-manual", CanvasNodeType.Audio, { content: "audio" }),
        node("first-frame", CanvasNodeType.Image, { content: "frame", workflowKind: "shot" }),
        node("target", CanvasNodeType.Video),
    ];
    const connections: CanvasConnection[] = [{ id: "manual-row-input", fromNodeId: "manual", toNodeId: "script", toHandleId: "row:row-1" }];

    it("combines stable bindings and preserves asset identity until generation", () => {
        const references = storyboardRowReferenceNodeIds(script, row, nodes, connections, true);
        expect(references).toEqual(["project-style", "prop", "character", "manual", "first-frame"]);
        expect(storyboardComposerContent("快速跟拍", references, nodes)).toBe("参考资产：@[node:project-style] @[node:prop] @[node:character] @[node:manual] @[node:first-frame]\n快速跟拍");

        const withDirectManualInput = storyboardRowReferenceNodeIds(script, row, nodes, [...connections, { id: "direct", fromNodeId: "direct-manual", toNodeId: "target" }], false, "target");
        expect(withDirectManualInput).toContain("direct-manual");
    });

    it("reconciles managed edges without deleting manual connections", () => {
        const manualTargetEdge: CanvasConnection = { id: "manual-target", fromNodeId: "manual", toNodeId: "target" };
        const created = reconcileStoryboardTargetConnections([manualTargetEdge], script, row, "target", ["prop", "character"]);
        expect(created.filter((edge) => edge.relation === "storyboard-output")).toHaveLength(1);
        expect(
            created
                .filter((edge) => edge.relation === "storyboard-asset-reference")
                .map((edge) => edge.fromNodeId)
                .sort(),
        ).toEqual(["character", "prop"]);

        const reconciled = reconcileStoryboardTargetConnections(created, script, row, "target", ["character"]);
        expect(reconciled.some((edge) => edge.id === "manual-target")).toBe(true);
        expect(reconciled.some((edge) => edge.relation === "storyboard-asset-reference" && edge.fromNodeId === "prop")).toBe(false);
    });

    it("replaces a row selection and removes stale row and generated references without touching other rows", () => {
        const previousRow = {
            ...row,
            videoNodeId: "target",
            assetBindings: [
                { nodeId: "prop", role: "prop" as const, priority: 80 },
                { nodeId: "character", role: "character" as const, priority: 100 },
            ],
        };
        const previousScript = { ...script, metadata: { ...script.metadata, storyboard: { ...script.metadata!.storyboard!, rows: [previousRow, { ...row, id: "other-row" }] } } };
        const previousNodes = nodes.map((item) => (item.id === script.id ? previousScript : item));
        const otherEdge: CanvasConnection = { id: "other", fromNodeId: "prop", toNodeId: "script", toHandleId: "row:other-row" };
        const edges = reconcileStoryboardTargetConnections([...connections, otherEdge], previousScript, previousRow, "target", ["prop", "character"]);
        const result = replaceStoryboardRowAssets(previousNodes, edges, "script", "row-1", [{ nodeId: "manual", role: "motion", priority: 70 }]);
        const nextScript = result.nodes.find((item) => item.id === "script")!;
        const nextRow = nextScript.metadata!.storyboard!.rows[0];
        expect(nextRow.assetBindings).toEqual([{ nodeId: "manual", role: "motion", priority: 70 }]);
        expect(nextRow.characters).toEqual([{ characterName: "林岚" }]);
        expect(nextScript.metadata!.storyboard!.rows[1]).toEqual(previousScript.metadata!.storyboard!.rows[1]);
        expect(result.connections).toContainEqual(otherEdge);
        expect(storyboardRowReferenceNodeIds(nextScript, nextRow, result.nodes, result.connections, false, "target")).toEqual(["project-style", "manual"]);
    });

    it("allows clearing all assets while preserving shared references and existing output media", () => {
        const result = replaceStoryboardRowAssets(nodes, connections, "script", "row-1", []);
        const nextScript = result.nodes.find((item) => item.id === "script")!;
        const nextRow = nextScript.metadata!.storyboard!.rows[0];
        expect(nextRow.assetBindings).toEqual([]);
        expect(storyboardRowReferenceNodeIds(nextScript, nextRow, result.nodes, result.connections, false)).toEqual(["project-style"]);
        expect(result.nodes.find((item) => item.id === "first-frame")?.metadata?.content).toBe("frame");
    });

    it("rejects missing rows, locked storyboards and stale asset selections", () => {
        expect(() => replaceStoryboardRowAssets(nodes, [], "script", "missing", [])).toThrow();
        expect(() => replaceStoryboardRowAssets(nodes, [], "script", row.id, [{ nodeId: "missing", role: "prop", priority: 80 }])).toThrow();
        const locked = nodes.map((item) => (item.id === "script" ? { ...item, metadata: { ...item.metadata, locked: true } } : item));
        expect(() => replaceStoryboardRowAssets(locked, [], "script", row.id, [])).toThrow();
    });
    it("keeps only the explicitly selected node when the same character has multiple canvas versions", () => {
        const a = node("character-a", CanvasNodeType.Text, { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "a" });
        const b = node("character-b", CanvasNodeType.Text, { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "b" });
        const result = replaceStoryboardRowAssets([script, a, b], [], script.id, row.id, [{ nodeId: a.id, role: "character", priority: 100 }]);
        const nextScript = result.nodes[0];
        expect(storyboardRowReferenceNodeIds(nextScript, nextScript.metadata!.storyboard!.rows[0], result.nodes, [], false)).toEqual([a.id]);
    });
    it("updates output draft mentions after removal and addition while preserving the generated result", () => {
        const shot = { ...row, characters: [], imageNodeId: "output", videoNodeId: undefined };
        const owner = node("owner", CanvasNodeType.Script, { storyboard: { rows: [shot], visibleColumns: [], referenceNodeIds: [] } });
        const prop = node("prop", CanvasNodeType.Image, { content: "prop" });
        const added = node("new", CanvasNodeType.Image, { content: "new" });
        const output = node("output", CanvasNodeType.Image, {
            content: "completed-image",
            prompt: "已提交原文",
            composerContent: "参考资产：@图片1\n用户修改后的正文，参考@图片1。",
            promptTemplateOperation: "storyboard_image",
            promptTemplateVariables: { prompt: "模板正文" },
        });
        const initial = [owner, prop, added, output];
        const edges = reconcileStoryboardTargetConnections([], owner, shot, output.id, [prop.id]);
        const result = replaceStoryboardRowAssets(initial, edges, owner.id, shot.id, [{ nodeId: added.id, role: "style", priority: 60 }]);
        const changed = result.nodes.find((item) => item.id === output.id)!;
        expect(changed.metadata?.composerContent).toBe("参考资产：@[node:new]\n用户修改后的正文，参考。");
        expect(changed.metadata?.prompt).toBe("已提交原文");
        expect(changed.metadata?.content).toBe("completed-image");
        expect(changed.metadata?.promptTemplateOperation).toBe("storyboard_image");
        expect(changed.metadata?.promptTemplateVariables).toEqual({ prompt: "模板正文" });
        expect(result.connections.some((edge) => edge.fromNodeId === added.id && edge.toNodeId === output.id)).toBe(true);
    });

    it("compiles same-name assets against actual retained edge order, including mixed character images", () => {
        const character = node("hero", CanvasNodeType.Text, { workflowKind: "character", characterAssetId: "hero-asset" });
        const scene = node("scene", CanvasNodeType.Image, { storageKey: "resource:scene", content: "scene" });
        const prop = node("prop-image", CanvasNodeType.Image, { storageKey: "resource:prop", content: "prop" });
        character.title = scene.title = prop.title = "同名.png";
        const output = node("video-output", CanvasNodeType.Video);
        const all = [script, character, scene, prop, output];
        const desired = [character.id, scene.id, prop.id];
        const edges = reconcileStoryboardTargetConnections([{ id: "existing", fromNodeId: scene.id, toNodeId: output.id }], script, row, output.id, desired);
        const prompt = storyboardComposerContent("角色@[node:hero]站在@[node:scene]中，拿着@[node:prop-image]。", desired, all);
        const displayed = normalizeCanvasNodeMentionTokens(prompt, buildNodeMentionReferences(output, all, edges));
        expect(displayed).toContain("参考资产：@角色2 @图片1 @图片3");
        const context = buildNodeGenerationContext(output.id, all, edges, prompt, [], true);
        expect(context.referenceImageSlots.map((slot) => slot.nodeId)).toEqual([scene.id, character.id, prop.id]);
        expect(context.prompt).toContain("参考资产：@图片2 @图片1 @图片3");
        expect(context.prompt).toContain("角色@图片2站在@图片1中，拿着@图片3。");
        expect(context.referenceImages.map((image) => image.storageKey)).toEqual(["resource:scene", "resource:prop"]);
        expect(context.characterReferences[0].nodeId).toBe(character.id);
    });
});
