import { describe, expect, it } from "bun:test";

import { buildCanvasWorkflowOps, looksLikeWorkflowRequest } from "@/lib/canvas/canvas-agent-workflow";
import { applyCanvasAgentOps, canvasAgentPostconditionMessage, verifyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { extractCanvasAgentQuickActions } from "@/components/canvas/canvas-agent-chat-ui";
import { CanvasNodeType } from "@/types/canvas";

const config = { imageModel: "image-model", videoModel: "video-model", audioModel: "audio-model" } as never;
const snapshot: CanvasAgentSnapshot = { projectId: "p", title: "空画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

describe("canvas agent workflow builder", () => {
    it("creates semantic media nodes, non-overlapping layout and real edges", () => {
        const ops = buildCanvasWorkflowOps({
            title: "搞笑修仙小说流水线",
            nodes: [
                { ref: "characters", kind: "character_cards", title: "角色拆分图片卡片", prompt: "拆分搞笑修仙小说中的主要角色，并生成角色图片卡片" },
                { ref: "views", kind: "character_three_view", title: "角色三视图", prompt: "基于角色卡片生成正面、侧面、背面三视图", referenceRefs: ["characters"] },
                { ref: "video", kind: "storyboard_video", title: "分镜剧情视频", prompt: "基于角色三视图制作分镜剧情视频", referenceRefs: ["views"] },
            ],
        }, snapshot, config);
        const after = applyCanvasAgentOps(snapshot, ops);
        const added = after.nodes.filter((node) => node.id.startsWith("agent-workflow-"));
        expect(added.map((node) => node.type)).toEqual([CanvasNodeType.Image, CanvasNodeType.Image, CanvasNodeType.Video]);
        expect(after.connections).toHaveLength(2);
        expect(added[1].position.x).toBeGreaterThan(added[0].position.x + added[0].width);
        expect(added[2].position.x).toBeGreaterThan(added[1].position.x + added[1].width);
        const result = verifyCanvasAgentOps(snapshot, after, ops);
        expect(result.ok).toBe(true);
        expect(result.connectionCount).toBe(2);
        expect(result.expectedConnectionCount).toBe(2);
        expect(result.overlapWarnings).toEqual([]);
        expect(canvasAgentPostconditionMessage(result)).toContain("实际新增 2 条");
    });

    it("turns numbered assistant choices into clickable prompts", () => {
        expect(extractCanvasAgentQuickActions("请选择下一步：\n1. 继续细化角色\n2、增加故事元素\n3) 调整布局")).toEqual([
            { label: "继续细化角色", prompt: "继续细化角色" },
            { label: "增加故事元素", prompt: "增加故事元素" },
            { label: "调整布局", prompt: "调整布局" },
        ]);
        expect(extractCanvasAgentQuickActions("```json\n1. not an action\n```")).toEqual([]);
    });

    it("rejects workflow-shaped text batches", () => {
        expect(looksLikeWorkflowRequest("创建一个工作流并连线")).toBe(true);
        expect(looksLikeWorkflowRequest("写一段角色介绍")).toBe(false);
    });

    it("infers useful prompts for semantic media stages when the model omits them", () => {
        const ops = buildCanvasWorkflowOps({
            title: "搞笑修仙小说流水线",
            nodes: [{ ref: "cards", kind: "character_cards", title: "角色拆分图片卡片" }],
        }, snapshot, config);
        const node = ops.find((op) => op.type === "add_node");
        expect(node?.metadata?.prompt).toContain("拆分主要角色");
    });

    it("supports per-node generation without running every media node", () => {
        const ops = buildCanvasWorkflowOps({
            nodes: [
                { ref: "cards", kind: "character_cards", title: "角色卡片", prompt: "生成角色卡片" },
                { ref: "views", kind: "character_three_view", title: "角色三视图", prompt: "生成三视图", runGeneration: true },
                { ref: "video", kind: "storyboard_video", title: "分镜视频", prompt: "生成分镜视频" },
            ],
        }, snapshot, config);
        expect(ops.filter((op) => op.type === "run_generation")).toHaveLength(1);
        expect(ops.find((op) => op.type === "run_generation")?.nodeId).toBe(ops[1].id);
    });

    it("can connect a new workflow node to an existing canvas resource", () => {
        const existing: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ id: "asset-1", type: CanvasNodeType.Image, title: "角色原画", position: { x: 0, y: 0 }, width: 560, height: 380, metadata: { status: "success", storageKey: "resource:character-1" } }],
        };
        const ops = buildCanvasWorkflowOps({
            nodes: [{ ref: "views", kind: "character_three_view", title: "角色三视图", prompt: "基于已有角色原画生成正面、侧面、背面三视图", referenceNodeIds: ["asset-1"] }],
        }, existing, config);
        const after = applyCanvasAgentOps(existing, ops);
        expect(after.connections).toHaveLength(1);
        expect(after.connections[0]).toMatchObject({ fromNodeId: "asset-1", toNodeId: ops[0].id });
        expect(after.nodes[1]?.metadata?.referenceNodeIds).toEqual(["asset-1"]);
    });
});
