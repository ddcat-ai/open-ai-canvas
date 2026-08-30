import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const selectionControllerSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-selection-controller.ts"), "utf8");

describe("canvas node drag overlays", () => {
    test("hides floating editors and selection controls for the whole drag preview", () => {
        expect(projectSource).toContain("const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);");
        expect(projectSource).toContain("dialogNode.type !== CanvasNodeType.Drawing && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("angleNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("emotionNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("selectedNodeBounds && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("node={isCanvasNodeMoving || nodeImageSettingsOpen || emotionNodeId ? null : toolbarNode}");
        expect(projectSource).toContain("onNodeDragEnd: handleNodeDragEnd");
        expect(projectSource).toContain("setDialogNodeId(node.id);");
        expect(selectionControllerSource).toContain("if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);");
    });
});
