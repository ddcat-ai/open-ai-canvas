import { describe, expect, test } from "bun:test";

import { applySubmissionExclusions, buildGenerationSubmissionSnapshot } from "../src/lib/canvas/canvas-generation-submission";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function actionBoardFixture() {
    const nodes: CanvasNodeData[] = [
        {
            id: "script-1",
            type: CanvasNodeType.Script,
            title: "脚本",
            position: { x: 0, y: 0 },
            width: 800,
            height: 400,
            metadata: {
                storyboard: {
                    rows: [
{
                            id: "shot-1",
                            shotNumber: 1,
                            durationSeconds: 3,
                            plotDescription: "林时按下启动键",
                            dialogue: "去看看",
                            characters: [{ characterName: "林时", characterAssetId: "asset-lin" }],
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
                        },
                    ],
                    visibleColumns: ["shotNumber"],
                    referenceNodeIds: [],
                },
            },
        },
        {
            id: "char-lin",
            type: CanvasNodeType.Text,
            title: "林时",
            position: { x: 0, y: 500 },
            width: 280,
            height: 200,
            metadata: {
                workflowKind: "character",
                characterAssetId: "asset-lin",
                characterName: "林时",
                characterCoverUrl: "/api/resources/res-lin/file",
                characterPrompt: "【角色卡：林时】青年男性",
            },
        },
        {
            id: "style-1",
            type: CanvasNodeType.Text,
            title: "画风",
            position: { x: 0, y: 800 },
            width: 280,
            height: 200,
            metadata: {
                workflowKind: "styleboard",
                content: "电影感写实，冷色调",
            },
        },
        {
            id: "board-1",
            type: CanvasNodeType.Image,
            title: "镜头 1 · 动作板",
            position: { x: 900, y: 0 },
            width: 420,
            height: 300,
            metadata: {
                workflowKind: "action_board",
                shotIndex: 1,
                prompt: "生成一张电影动作拆分 12 宫格参考图\n镜头 1：林时按下启动键",
                composerContent: "生成一张电影动作拆分 12 宫格参考图\n镜头 1：林时按下启动键",
                status: "idle",
            },
        },
    ];
    const connections: CanvasConnection[] = [
        { id: "c1", fromNodeId: "script-1", toNodeId: "board-1", fromHandleId: "row:shot-1" },
        { id: "c2", fromNodeId: "char-lin", toNodeId: "board-1" },
        { id: "c3", fromNodeId: "style-1", toNodeId: "board-1" },
    ];
    return { nodes, connections };
}

describe("buildGenerationSubmissionSnapshot action board", () => {
    test("有 composerContent 的动作板仍自动带入角色，且角色不重复", () => {
        const { nodes, connections } = actionBoardFixture();
        const prompt = nodes.find((node) => node.id === "board-1")!.metadata!.composerContent!;
        const snapshot = buildGenerationSubmissionSnapshot({
            nodeId: "board-1",
            mode: "image",
            userPrompt: prompt,
            nodes,
            connections,
        });

        const characters = snapshot.references.filter((item) => item.kind === "character");
        const imagesForChar = snapshot.references.filter((item) => item.kind === "image" && item.nodeId === "char-lin");
        const charRef = characters.find((item) => item.nodeId === "char-lin");

        expect(characters).toHaveLength(1);
        expect(imagesForChar).toHaveLength(0);
        expect(charRef?.included).toBe(true);
        expect(charRef?.reason).toContain("角色卡");
        expect(charRef?.previewUrl).toContain("/resources/res-lin/file");
        expect(snapshot.path).toBe("i2i");
        expect(snapshot.warnings.some((item) => item.includes("显式 @ 模式"))).toBe(false);
    });

    test("applySubmissionExclusions 不会因动作板 composer 误排除角色图", () => {
        const { nodes, connections } = actionBoardFixture();
        const prompt = nodes.find((node) => node.id === "board-1")!.metadata!.composerContent!;
        const context = buildNodeGenerationContext("board-1", nodes, connections, prompt);
        const snapshot = buildGenerationSubmissionSnapshot({
            nodeId: "board-1",
            mode: "image",
            userPrompt: prompt,
            nodes,
            connections,
            effectivePrompt: context.prompt,
        });
        const filtered = applySubmissionExclusions(context, snapshot);
        expect(filtered.characterReferences.map((item) => item.nodeId)).toEqual(["char-lin"]);
        expect(filtered.referenceImages.some((image) => image.id === "char-lin")).toBe(true);
        expect(filtered.prompt).toContain("电影感写实");
    });

    test("Config composer 仍要求显式 @ 才带媒体", () => {
        const nodes: CanvasNodeData[] = [
            {
                id: "cfg",
                type: CanvasNodeType.Config,
                title: "生成器",
                position: { x: 0, y: 0 },
                width: 360,
                height: 240,
                metadata: { composerContent: "画一张图", prompt: "画一张图" },
            },
            {
                id: "img",
                type: CanvasNodeType.Image,
                title: "参考图",
                position: { x: 400, y: 0 },
                width: 340,
                height: 240,
                metadata: { content: "https://example.com/a.png", storageKey: "resource:a" },
            },
        ];
        const connections: CanvasConnection[] = [{ id: "c", fromNodeId: "img", toNodeId: "cfg" }];
        const snapshot = buildGenerationSubmissionSnapshot({
            nodeId: "cfg",
            mode: "image",
            userPrompt: "画一张图",
            nodes,
            connections,
        });
        const ref = snapshot.references.find((item) => item.nodeId === "img");
        expect(ref?.included).toBe(false);
        expect(ref?.reason).toContain("显式 @");
    });
});
