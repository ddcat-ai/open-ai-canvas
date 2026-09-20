import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const selectionControllerSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-selection-controller.ts"), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("canvas node drag overlays", () => {
    test("hides floating editors and selection controls for the whole drag preview", () => {
        expect(projectSource).toContain("const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);");
        // 面板浮层的守卫必须同时成立：类型排除、框选、拖拽预览。断言整段条件而不是某一行的
        // 字面量，避免上游拆行或新增类型排除（Panorama 等）后把排版变化报成契约失效。
        const flatSource = flat(projectSource);
        const overlayStart = flatSource.indexOf("{dialogNode &&");
        const overlayCondition = flatSource.slice(overlayStart, flatSource.indexOf("<CanvasNodePanelOverlay", overlayStart));
        expect(overlayCondition).toContain("dialogNode.type !== CanvasNodeType.Drawing");
        expect(overlayCondition).toContain("!selectionBox");
        expect(overlayCondition).toContain("!isCanvasNodeMoving");
        expect(projectSource).not.toContain("angleNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("emotionNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("selectedNodeBounds && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("node={isCanvasNodeMoving || nodeImageSettingsOpen || emotionNodeId || angleNodeId ? null : toolbarNode}");
        expect(projectSource).toContain("onNodeDragEnd: handleNodeDragEnd");
        expect(projectSource).toContain("setDialogNodeId(node.id);");
        expect(selectionControllerSource).toContain("if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);");
    });
});
