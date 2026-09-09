import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const selectionControllerSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-selection-controller.ts"), "utf8");

describe("canvas node drag overlays", () => {
    test("hides floating editors and selection controls for the whole drag preview", () => {
        expect(projectSource).toContain("const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);");
        expect(projectSource).toContain("dialogNode.type !== CanvasNodeType.Drawing && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("angleNode?.metadata?.content ? (");
        expect(projectSource).toContain("emotionNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("selectedNodeBounds && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("node={isCanvasNodeMoving || nodeImageSettingsOpen || emotionNodeId ? null : toolbarNode}");
        expect(projectSource).toContain("onNodeDragEnd: handleNodeDragEnd");
        const dragEndSource = projectSource.slice(projectSource.indexOf("const handleNodeDragEnd"), projectSource.indexOf("const handleCanvasDeselect"));
        expect(dragEndSource).toContain("setDialogNodeId(null);");
        expect(dragEndSource).not.toContain("setDialogNodeId(node.id);");
        expect(selectionControllerSource).toContain("if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);");
    });

    test("opens the node toolbar from the click path instead of hover or drag", () => {
        const clickSource = projectSource.slice(projectSource.indexOf("const handleSelectedNodeClick"), projectSource.indexOf("const handleNodeBringToFront"));
        const hoverSource = projectSource.slice(projectSource.indexOf("const handleCanvasNodeHoverStart"), projectSource.indexOf("const retryCanvasNode"));
        const dragEndSource = projectSource.slice(projectSource.indexOf("const handleNodeDragEnd"), projectSource.indexOf("const handleCanvasDeselect"));

        expect(clickSource).toContain("setToolbarNodeId(node.id);");
        expect(hoverSource).not.toContain("keepNodeToolbar(nodeId);");
        expect(dragEndSource).toContain("setToolbarNodeId(null);");
        expect(projectSource).toContain("const toolbarCandidate = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;");
        expect(projectSource).toContain("dismissOnPointerLeave={false}");
    });
});
