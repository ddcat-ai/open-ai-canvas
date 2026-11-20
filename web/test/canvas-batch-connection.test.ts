import { describe, expect, it } from "bun:test";

import { batchCellSourcesError, batchConnectionRejectReason, buildBatchConnectionCreateRequest, expandBatchSourceNodeIds, hasBatchConnectionCandidate, planBatchConnections } from "@/lib/canvas/canvas-batch-connection";
import { batchCellConnectionError, batchCellHandle } from "@/lib/canvas/canvas-batch-references";
import { createBatchRow } from "@/lib/canvas/canvas-batch-table";
import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { canvasConnectionPath } from "@/components/canvas/canvas-connections";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const nodes: CanvasNodeData[] = [
    { id: "text-a", type: CanvasNodeType.Text, title: "文本 A", position: { x: 0, y: 0 }, width: 320, height: 180 },
    { id: "text-b", type: CanvasNodeType.Text, title: "文本 B", position: { x: 0, y: 220 }, width: 320, height: 180 },
    { id: "image-a", type: CanvasNodeType.Image, title: "图片 A", position: { x: 0, y: 440 }, width: 320, height: 180 },
    { id: "image-b", type: CanvasNodeType.Image, title: "图片 B", position: { x: 0, y: 660 }, width: 320, height: 180 },
    {
        id: "script",
        type: CanvasNodeType.Script,
        title: "分镜脚本",
        position: { x: 520, y: 0 },
        width: 640,
        height: 520,
        metadata: {
            storyboard: {
                rows: [
                    {
                        id: "row-1",
                        shotNumber: 1,
                        durationSeconds: 6,
                        plotDescription: "",
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
                        assetBindings: [],
                        status: "idle",
                    },
                ],
            },
        },
    },
    { id: "config", type: CanvasNodeType.Config, title: "图片配置", position: { x: 520, y: 560 }, width: 360, height: 420, metadata: { generationMode: "image" } },
    { id: "frame", type: CanvasNodeType.Frame, title: "背板", position: { x: 0, y: 680 }, width: 500, height: 500 },
    { id: "batch-table", type: CanvasNodeType.BatchTable, title: "批量创作表", position: { x: 1000, y: 0 }, width: 900, height: 520 },
];

const baseConfig = { ...defaultConfig };

describe("planBatchConnections", () => {
    it("only accepts image inputs for the batch creation table", () => {
        expect(canvasConnectionError(baseConfig, nodes, [], { fromNodeId: "image-a", toNodeId: "batch-table" })).toBe("");
        expect(canvasConnectionError(baseConfig, nodes, [], { fromNodeId: "text-a", toNodeId: "batch-table" })).toContain("批量创作表节点只接受图片输入");
    });

    it("plans all legal source nodes and preserves the target handle", () => {
        const result = planBatchConnections({
            sourceNodeIds: ["text-a", "text-b"],
            targetNodeId: "script",
            targetHandleId: "row:row-1",
            targetAnchorRatio: 0.4,
            nodes,
            connections: [],
            config: baseConfig,
        });

        expect(result.connected).toEqual(["text-a", "text-b"]);
        expect(result.connections).toHaveLength(2);
        expect(result.connections.every((connection) => connection.toNodeId === "script" && connection.toHandleId === "row:row-1")).toBe(true);
        expect(result.skipped).toEqual([]);
    });

    it("skips duplicate connections without creating another edge", () => {
        const existing: CanvasConnection[] = [{ id: "existing", fromNodeId: "text-a", toNodeId: "config" }];
        const result = planBatchConnections({
            sourceNodeIds: ["text-a", "text-b"],
            targetNodeId: "config",
            nodes,
            connections: existing,
            config: baseConfig,
        });

        expect(result.connected).toEqual(["text-b"]);
        expect(result.duplicates).toEqual(["text-a"]);
        expect(result.connections).toHaveLength(1);
    });

    it("reports sources that cannot be used by the aggregate connector", () => {
        const result = planBatchConnections({
            sourceNodeIds: ["frame", "text-a"],
            targetNodeId: "config",
            nodes,
            connections: [],
            config: baseConfig,
        });

        expect(result.connected).toEqual(["text-a"]);
        expect(result.skipped).toEqual([{ nodeId: "frame", reason: "背板不能作为连接源" }]);
    });

    it("keeps every legal graph edge when a newly created node exceeds provider reference capacity", () => {
        const constrainedConfig = {
            ...baseConfig,
            channels: [
                {
                    id: "grok",
                    name: "Grok",
                    baseUrl: "https://example.com",
                    apiKey: "test-key",
                    apiFormat: "openai" as const,
                    models: ["grok-imagine-image"],
                    modelCosts: [{ model: "grok-imagine-image", capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1, protocol: "grok-image" as const }],
                },
            ],
            models: ["grok::grok-imagine-image"],
            imageModels: ["grok::grok-imagine-image"],
            imageModel: "grok::grok-imagine-image",
            model: "grok::grok-imagine-image",
        };
        const result = planBatchConnections({
            sourceNodeIds: ["image-a", "image-b"],
            targetNodeId: "new-image",
            nodes: [...nodes, { id: "new-image", type: CanvasNodeType.Image, title: "新图片", position: { x: 1200, y: 0 }, width: 320, height: 180 }],
            connections: [],
            config: constrainedConfig,
            allowCapacityOverflow: true,
        });
        expect(result.connected).toEqual(["image-a", "image-b"]);
        expect(result.connections).toHaveLength(2);
    });

    it("connects every selected image to a newly created batch table", () => {
        const result = planBatchConnections({
            sourceNodeIds: ["image-a", "image-b"],
            targetNodeId: "batch-table",
            nodes,
            connections: [],
            config: baseConfig,
            allowCapacityOverflow: true,
        });

        expect(result.connected).toEqual(["image-a", "image-b"]);
        expect(result.connections.every((connection) => connection.toNodeId === "batch-table")).toBe(true);
        expect(result.skipped).toEqual([]);
    });

    it("preserves a batch table reference-column target handle", () => {
        const result = planBatchConnections({
            sourceNodeIds: ["image-a"],
            targetNodeId: "batch-table",
            targetHandleId: "batch-reference:reference-2",
            nodes,
            connections: [],
            config: baseConfig,
            allowCapacityOverflow: true,
        });

        expect(result.connections[0]?.toHandleId).toBe("batch-reference:reference-2");
    });
});

describe("canvas connection anchors", () => {
    it("keeps ordinary node edges centered even when legacy ratios exist", () => {
        const connection: CanvasConnection = {
            id: "ratio-test",
            fromNodeId: "text-a",
            toNodeId: "text-b",
            fromAnchorRatio: 0.2,
            toAnchorRatio: 0.8,
        };
        const result = canvasConnectionPath(connection, nodes[0], nodes[1]);

        expect(result.startY).toBe(90);
        expect(result.endY).toBe(310);
    });

    it("keeps storyboard row handles positioned independently from the node center", () => {
        const connection: CanvasConnection = {
            id: "storyboard-row-test",
            fromNodeId: "text-a",
            toNodeId: "script",
            toHandleId: "row:row-1",
        };
        const result = canvasConnectionPath(connection, nodes[0], nodes[4]);

        expect(result.startY).toBe(90);
        expect(result.endY).toBeGreaterThan(90);
    });
});

describe("buildBatchConnectionCreateRequest", () => {
    it("keeps unique eligible sources and uses the first one for the pending connection", () => {
        const request = buildBatchConnectionCreateRequest(["frame", "text-a", "text-a", "text-b"], nodes, { x: 900, y: 240 });

        expect(request).toEqual({
            batchSourceNodeIds: ["text-a", "text-b"],
            connection: { nodeId: "text-a", handleType: "source" },
            position: { x: 900, y: 240 },
        });
    });

    it("returns null when no selected node can be used as a batch source", () => {
        expect(buildBatchConnectionCreateRequest(["frame", "script", "config"], nodes, { x: 0, y: 0 })).toBeNull();
    });
});

describe("hasBatchConnectionCandidate", () => {
    it("accepts a target when another selected source is legal even if the target itself is selected first", () => {
        expect(hasBatchConnectionCandidate(["config", "text-a"], "config", nodes)).toBe(true);
    });
});

// 批量连接连不上时的原因文案。
const cellTable: CanvasNodeData = {
    id: "cell-table",
    type: CanvasNodeType.BatchTable,
    title: "批量创作表",
    position: { x: 2000, y: 0 },
    width: 1280,
    height: 560,
    metadata: { batchTable: { operation: "try_on", concurrency: 10, rows: [{ ...createBatchRow("try_on"), id: "row-1" }] } },
};
const lockedTable: CanvasNodeData = { ...cellTable, id: "locked-table", metadata: { ...cellTable.metadata, locked: true } };
const filledImage: CanvasNodeData = { id: "filled-image", type: CanvasNodeType.Image, title: "有图", position: { x: 0, y: 900 }, width: 320, height: 180, metadata: { content: "data:image/png;base64,AAAA" } };
const cellNodes = [...nodes, cellTable, lockedTable, filledImage];
const cellHandle = batchCellHandle("row-1", "reference-1");
const rejectReason = (sourceNodeIds: string[], target: { handleId?: string; rejectedNodeId?: string }) => batchConnectionRejectReason({ sourceNodeIds, target, nodes: cellNodes, connections: [], config: baseConfig });

describe("batchCellSourcesError", () => {
    it("matches the inline reference-cell rule for one and several sources", () => {
        for (const sources of [["filled-image"], ["image-a"], ["text-a"], ["filled-image", "image-a"], []]) {
            const inline = sources.length !== 1 ? "每个参考格只能连接一张图片" : batchCellConnectionError(cellNodes, sources[0], cellTable.id, cellHandle);
            expect(batchCellSourcesError(cellNodes, sources, cellTable.id, cellHandle)).toBe(inline);
        }
        expect(batchCellSourcesError(cellNodes, ["filled-image"], cellTable.id, cellHandle)).toBe("");
    });
});

describe("batchConnectionRejectReason", () => {
    it("explains why a reference cell refuses the drop", () => {
        expect(rejectReason(["filled-image", "image-a"], { handleId: cellHandle, rejectedNodeId: cellTable.id })).toBe("每个参考格只能连接一张图片");
        expect(rejectReason(["filled-image"], { handleId: batchCellHandle("missing-row", "reference-1"), rejectedNodeId: cellTable.id })).toBe("找不到目标参考格");
        expect(rejectReason(["filled-image"], { handleId: cellHandle, rejectedNodeId: lockedTable.id })).toBe("批量创作表已锁定");
        expect(rejectReason(["text-a"], { handleId: cellHandle, rejectedNodeId: cellTable.id })).toBe("批量创作表节点只接受图片输入");
        expect(rejectReason(["image-a"], { handleId: cellHandle, rejectedNodeId: cellTable.id })).toBe("请先为图片节点添加图片");
    });

    it("asks to aim at a storyboard row or a reference-column port", () => {
        expect(rejectReason(["text-a", "text-b"], { rejectedNodeId: "script" })).toBe("请对准分镜脚本的某一行");
        expect(rejectReason(["image-a", "image-b"], { rejectedNodeId: "batch-table" })).toBe("请对准批量创作表左侧的参考图连接点");
    });

    it("falls back to the plan's skip reason, then to the generic text", () => {
        expect(rejectReason(["text-a"], { rejectedNodeId: "text-a" })).toBe("目标节点不能连接到自身");
        expect(rejectReason(["text-a"], {})).toBe("没有可建立的连接");
    });

    it("always names a reason when a node refused the batch (fixed seeds 1–200)", () => {
        const sourcePool = ["text-a", "text-b", "image-a", "filled-image", "frame"];
        const targets = [
            { rejectedNodeId: "script" },
            { rejectedNodeId: "batch-table" },
            { rejectedNodeId: cellTable.id, handleId: cellHandle },
            { rejectedNodeId: lockedTable.id, handleId: cellHandle },
            { rejectedNodeId: "text-a" },
            { rejectedNodeId: "config" },
        ];
        for (let seed = 1; seed <= 200; seed += 1) {
            let state = seed;
            const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
            const sources = sourcePool.filter(() => next() < 0.5);
            const target = targets[Math.floor(next() * targets.length)];
            const result = rejectReason(sources, target);
            const plan = planBatchConnections({ sourceNodeIds: sources, targetNodeId: target.rejectedNodeId, targetHandleId: target.handleId, nodes: cellNodes, connections: [], config: baseConfig });
            const expected = target.handleId
                ? batchCellSourcesError(cellNodes, sources, target.rejectedNodeId, target.handleId) || "没有可建立的连接"
                : target.rejectedNodeId === "script"
                  ? "请对准分镜脚本的某一行"
                  : target.rejectedNodeId === "batch-table"
                    ? "请对准批量创作表左侧的参考图连接点"
                    : plan.skipped[0]?.reason || "没有可建立的连接";
            expect(result, `seed ${seed} ${JSON.stringify({ sources, target })}`).toBe(expected);
            expect(result.length, `seed ${seed}`).toBeGreaterThan(0);
        }
    });
});

describe("expandBatchSourceNodeIds", () => {
    const framed: CanvasNodeData[] = [
        { id: "board", type: CanvasNodeType.Frame, title: "背板", position: { x: 0, y: 0 }, width: 800, height: 600 },
        { id: "in-a", type: CanvasNodeType.Image, title: "A", position: { x: 20, y: 60 }, width: 200, height: 200, parentId: "board" },
        { id: "in-b", type: CanvasNodeType.Image, title: "B", position: { x: 260, y: 60 }, width: 200, height: 200, parentId: "board" },
        { id: "outside", type: CanvasNodeType.Text, title: "外部", position: { x: 900, y: 0 }, width: 200, height: 120 },
    ];

    it("uses a selected backdrop's child assets as connection sources", () => {
        expect(expandBatchSourceNodeIds(["board"], framed)).toEqual(["in-a", "in-b"]);
    });

    it("keeps selection order and removes duplicates when children are also selected", () => {
        expect(expandBatchSourceNodeIds(["outside", "in-b", "board"], framed)).toEqual(["outside", "in-b", "in-a"]);
    });

    it("returns nothing for an empty backdrop", () => {
        expect(expandBatchSourceNodeIds(["frame"], nodes)).toEqual([]);
    });
});
