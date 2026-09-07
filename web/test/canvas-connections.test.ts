import { describe, expect, test } from "bun:test";

import { activeConnectionPath, canvasConnectionPath } from "../src/components/canvas/canvas-connections";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, x: number, y = 0): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x, y },
        width: 160,
        height: 100,
        metadata: {},
    } as CanvasNodeData;
}

function controlPoints(path: string) {
    const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    return { control1X: values[2], control2X: values[4] };
}

describe("canvas connection paths", () => {
    test("keeps a minimum tangent when the target is close to the source", () => {
        const path = canvasConnectionPath(
            { id: "connection", fromNodeId: "from", toNodeId: "to" },
            node("from", 0),
            node("to", 208),
        ).pathD;

        expect(path).toBe("M 160 50 C 208 50, 160 50, 208 50");
    });

    test("keeps endpoint directions when dragging behind the source", () => {
        const path = activeConnectionPath(node("from", 0), { nodeId: "from", handleType: "source" }, { x: 80, y: 180 });
        const { control1X, control2X } = controlPoints(path);

        expect(control1X).toBeGreaterThan(160);
        expect(control2X).toBeLessThan(80);
    });

    test("uses the same smooth curve for a snapped target", () => {
        const path = activeConnectionPath(
            node("from", 0),
            { nodeId: "from", handleType: "source" },
            { x: 320, y: 140 },
            node("to", 320, 120),
        );

        expect(path).toBe("M 160 50 C 240 50, 240 170, 320 170");
    });
});
