import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moduleGroupSource } from "./helpers/module-group-source";

const projectSource = moduleGroupSource("pages/canvas/project.tsx");
const readSource = (path: string) => readFileSync(resolve(import.meta.dir, `../src/${path}`), "utf8");
const selectionControllerSource = readSource("pages/canvas/use-canvas-selection-controller.ts");
const workspaceOverlaysSource = readSource("components/canvas/canvas-workspace-overlays.tsx");
const toolbarSource = readSource("components/canvas/canvas-node-toolbar.tsx");
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("canvas node drag overlays", () => {
    test("hides both controls during drag and anchors them to the node otherwise", () => {
        const source = flat(projectSource);
        expect(source).not.toMatch(/CanvasViewportNodeEditor|viewportDock=/);
        const editor = source.match(/\{dialogNode &&.*?<\/CanvasNodePanelOverlay>/)?.[0] ?? "";
        expect(editor).toContain("!selectionBox && !isCanvasNodeMoving ? (");
        expect(editor).toContain("node={dialogNode} viewport={viewport}");
        expect(editor).toContain("anchorBelow={dialogNode.type === CanvasNodeType.Text}");
        const toolbar = source.match(/<CanvasNodeToolbar\b.*?viewport=\{viewport\}/)?.[0] ?? "";
        expect(toolbar).toContain("node={isCanvasNodeMoving || selectionBox || nodeImageSettingsOpen || emotionNodeId || angleNodeId ? null : toolbarNode}");
        expect(toolbarSource).toContain("const above = nodeTop - 30;");
        expect(toolbar).toContain("followNodeOutsideViewport");
        expect(flat(toolbarSource)).toContain("followNodeOutsideViewport ? { left: preferredLeft, top: above }");
        for (const overlay of [workspaceOverlaysSource, toolbarSource]) {
            expect(overlay).toContain("subscribeCanvasGraphicsViewportPreview(container,");
            expect(overlay).toContain("subscribeCanvasNodeDragPreview(container,");
        }
    });

    test("retains drag behavior for other world overlays and selection finalization", () => {
        expect(projectSource).toContain("const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);");
        expect(projectSource).not.toContain("angleNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("emotionNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("selectedNodeBounds && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("onNodeDragEnd: handleNodeDragEnd");
        expect(projectSource).toContain("setDialogNodeId(node.id);");
        expect(selectionControllerSource).toContain("if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);");
    });
});
