import { describe, expect, it } from "bun:test";

import { buildBatchConnectionCreateRequest, hasBatchConnectionCandidate, planBatchConnections } from "@/lib/canvas/canvas-batch-connection";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const nodes: CanvasNodeData[] = [
    { id: "text-a", type: CanvasNodeType.Text, title: "文本 A", position: { x: 0, y: 0 }, width: 320, height: 180 },
    { id: "text-b", type: CanvasNodeType.Text, title: "文本 B", position: { x: 0, y: 220 }, width: 320, height: 180 },
    { id: "image-a", type: CanvasNodeType.Image, title: "图片 A", position: { x: 0, y: 440 }, width: 320, height: 180 },
    { id: "image-b", type: CanvasNodeType.Image, title: "图片 B", position: { x: 0, y: 660 }, width: 320, height: 180 },
    { id: "script", type: CanvasNodeType.Script, title: "分镜脚本", position: { x: 520, y: 0 }, width: 640, height: 520, metadata: { storyboard: { rows: [{ id: "row-1", shotNumber: 1, durationSeconds: 6, plotDescription: "", dialogue: "", characters: [], narrativeIntent: "", viewerPOV: "", performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "", mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", assetBindings: [], status: "idle" }] } } },
    { id: "config", type: CanvasNodeType.Config, title: "图片配置", position: { x: 520, y: 560 }, width: 360, height: 420, metadata: { generationMode: "image" } },
    { id: "frame", type: CanvasNodeType.Frame, title: "背板", position: { x: 0, y: 680 }, width: 500, height: 500 },
];

const baseConfig = { ...defaultConfig };

describe("planBatchConnections", () => {
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
            channels: [{
                id: "grok",
                name: "Grok",
                baseUrl: "https://example.com",
                apiKey: "test-key",
                apiFormat: "openai" as const,
                models: ["grok-imagine-image"],
                modelCosts: [{ model: "grok-imagine-image", capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1, protocol: "grok-image" as const }],
            }],
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
