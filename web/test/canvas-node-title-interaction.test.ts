import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const canvasStylesSource = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
const liveViewportSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-live-viewport.ts"), "utf8");

describe("canvas node title interaction", () => {
    test("disables iframe hit testing only during node dragging", () => {
        expect(canvasStylesSource).toMatch(/\[data-canvas-node-dragging="true"\] \.node-element iframe\s*\{\s*pointer-events: none;/);
        expect(liveViewportSource).toContain('if (preview) container.dataset.canvasNodeDragging = "true"');
        expect(liveViewportSource).toContain('else delete container.dataset.canvasNodeDragging');
    });
    test("exposes a drag handle without bypassing read-only or locked nodes", () => {
        expect(nodeSource).toContain('onDragStart={readOnly ? undefined : (event) => onMouseDown(event, data.id)}');
        expect(nodeSource).toContain('disabled={!onDragStart || Boolean(node.metadata?.locked)}');
        expect(nodeSource).toContain('onDragStart?.(event)');
        expect(nodeSource).toContain('event.currentTarget.setPointerCapture(event.pointerId)');
        expect(nodeSource).toContain('拖动此处移动节点；点击名称可重命名');
        expect(nodeSource).toContain('onClick={onEdit}');
    });
    test("keeps the toolbar hover bridge from intercepting the external title", () => {
        const hoverBridge = canvasStylesSource.match(/\.canvas-node-toolbar::after\s*\{([\s\S]*?)\}/)?.[1] || "";

        expect(hoverBridge).toContain("pointer-events: none;");
    });
});
