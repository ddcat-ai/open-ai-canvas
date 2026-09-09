import { describe, expect, test } from "bun:test";

import { buildCanvasAssistantResults } from "../src/components/canvas/canvas-agent-results-view";
import { panelWidthBoundsForViewport } from "../src/pages/canvas/canvas-assistant-panel-column";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { GenerationTask } from "../src/services/api/task-center";

function generatedNode(id: string, status?: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { prompt: id, status },
    } as CanvasNodeData;
}

describe("canvas Agent results", () => {
    test("orders processing, pending, completed, then failed results", () => {
        const nodes = [
            generatedNode("failed"),
            generatedNode("completed", "success"),
            generatedNode("pending"),
            generatedNode("processing"),
        ];
        const tasks = [
            { id: "task-failed", status: "failed", clientContext: { nodeId: "failed" } },
            { id: "task-processing", status: "running", clientContext: { nodeId: "processing" } },
        ] as GenerationTask[];

        expect(buildCanvasAssistantResults(nodes, tasks).map((item) => item.nodeId)).toEqual([
            "processing",
            "pending",
            "completed",
            "failed",
        ]);
    });
});

describe("canvas Agent responsive bounds", () => {
    test("uses the expected desktop and drawer width ranges", () => {
        expect(panelWidthBoundsForViewport(1882)).toEqual({ min: 360, max: 760 });
        expect(panelWidthBoundsForViewport(1280)).toEqual({ min: 320, max: 560 });
        expect(panelWidthBoundsForViewport(900)).toEqual({ min: 280, max: 440 });
        expect(panelWidthBoundsForViewport(600)).toEqual({ min: 260, max: 360 });
    });
});
