import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { bringCanvasNodeToFront, sortCanvasNodesByStackOrder } from "../src/lib/canvas/canvas-node-stack-order";

const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const worldLayersSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-project-world-layers.tsx"), "utf8");
const selectionControllerSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-selection-controller.ts"), "utf8");

describe("canvas node stack order", () => {
    test("moves the interacted node to the paint-order end", () => {
        expect(bringCanvasNodeToFront(["a", "b"], "a")).toEqual(["b", "a"]);
        expect(bringCanvasNodeToFront(["a", "b"], "c")).toEqual(["a", "b", "c"]);
        const alreadyFront = ["a", "b"];
        expect(bringCanvasNodeToFront(alreadyFront, "b")).toBe(alreadyFront);
    });

    test("keeps untouched nodes stable while the latest node remains on top after deselection", () => {
        const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
        expect(sortCanvasNodesByStackOrder(nodes, ["b", "a"])).toEqual([{ id: "c" }, { id: "b" }, { id: "a" }]);
    });

    test("keeps stack state separate from transient canvas selection", () => {
        expect(projectSource).toContain("const [nodeStackOrder, setNodeStackOrder]");
        expect(projectSource).toContain("bringNodeToFront(node.id)");
        expect(projectSource).toContain("onNodeBringToFront: handleNodeBringToFront");
        expect(projectSource).toContain("const handleNodeBringToFront = useCallback");
        expect(selectionControllerSource).toContain("onNodeBringToFront?.(nodeId)");
        expect(selectionControllerSource).toContain("so dragging also survives deselection");
        expect(projectSource).toContain("onDeselect: handleCanvasDeselect");
        expect(worldLayersSource).toContain("sortCanvasNodesByStackOrder");
        expect(worldLayersSource).toContain("props.nodeStackOrder");
    });
});
