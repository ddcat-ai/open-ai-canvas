import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { canvasAppearanceForTheme } from "../src/lib/canvas/canvas-appearance";
import { applyCanvasLiveViewport, CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, CANVAS_VIEWPORT_PREVIEW_EVENT } from "../src/lib/canvas/canvas-live-viewport";
import type { CanvasBackgroundMode } from "../src/lib/canvas-theme";
import type { ViewportTransform } from "../src/types/canvas";

const viewports: ViewportTransform[] = [
    { x: 0, y: 0, k: 1 },
    { x: 389.5, y: -207.25, k: 0.05 },
    { x: -17.125, y: 20.875, k: 0.119 },
    { x: -17.125, y: 20.875, k: 0.12 },
    { x: 150.2, y: -40.1, k: 0.666 },
    { x: 150.2, y: -40.1, k: 0.667 },
    { x: -1800.5, y: 3100.75, k: 2 },
];

function renderGrid(mode: CanvasBackgroundMode, viewport: ViewportTransform, theme: "light" | "dark" = "dark") {
    const markup = renderToStaticMarkup(
        <InfiniteCanvas containerRef={createRef<HTMLDivElement>()} viewport={viewport} onViewportChange={() => {}} backgroundMode={mode} appearance={canvasAppearanceForTheme(theme)}>
            <div data-test-node />
        </InfiniteCanvas>,
    );
    return markup.match(/<div data-canvas-grid-layer[^>]*>/)?.[0] ?? null;
}

describe("canvas screen-space background", () => {
    for (const mode of ["lines", "dots"] as const) {
        test(`${mode} keeps fixed geometry across zoom, pan and committed renders`, () => {
            for (const theme of ["light", "dark"] as const) {
                const initial = renderGrid(mode, viewports[0], theme);
                expect(initial).not.toBeNull();
                expect(initial).toContain("background-size:48px 48px");
                expect(initial).toContain("inset:0");
                expect(initial).not.toContain("transform:");
                expect(initial).not.toContain("var(--canvas-");
                if (mode === "dots") expect(initial).toContain("0.8px, transparent 1px");
                for (const viewport of viewports) expect(renderGrid(mode, viewport, theme)).toBe(initial);
            }
        });
    }

    test("blank mode renders no grid at any viewport", () => {
        for (const viewport of viewports) expect(renderGrid("blank", viewport)).toBeNull();
    });

    test("live updates transform the world and emit events without mutating the background", () => {
        const properties = new Map<string, string>([["--canvas-committed-scale", "0.5"]]);
        const gridWrites: string[] = [];
        const world = { style: { transform: "", transformOrigin: "", willChange: "" } };
        const grid = { style: { setProperty: (name: string) => gridWrites.push(name) } };
        const container = Object.assign(new EventTarget(), {
            style: {
                getPropertyValue: (name: string) => properties.get(name) ?? "",
                setProperty: (name: string, value: string) => properties.set(name, value),
            },
            dataset: { canvasViewportInteracting: "true" },
            querySelector: (selector: string) => (selector === "[data-canvas-world-layer]" ? world : grid),
        });
        const graphics: ViewportTransform[] = [];
        const previews: ViewportTransform[] = [];
        let scrolls = 0;
        container.addEventListener(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, (event) => graphics.push((event as CustomEvent<ViewportTransform>).detail));
        container.addEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, (event) => previews.push((event as CustomEvent<ViewportTransform>).detail));
        container.addEventListener("scroll", () => scrolls++);

        for (const viewport of viewports) {
            applyCanvasLiveViewport(container as unknown as HTMLDivElement, viewport, false);
            expect(world.style.transform).toBe(`translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k / 0.5})`);
            expect(properties.get("--canvas-live-scale")).toBe(String(viewport.k));
            expect(properties.get("--canvas-live-inverse-scale")).toBe(String(1 / viewport.k));
            expect(gridWrites).toEqual([]);
        }
        expect(graphics).toEqual(viewports);
        expect(previews).toEqual([]);
        expect(scrolls).toBe(0);
        expect(world.style.willChange).toBe("transform");

        container.dataset.canvasViewportInteracting = "false";
        applyCanvasLiveViewport(container as unknown as HTMLDivElement, viewports[0]);
        expect(world.style.willChange).toBe("");
        expect(previews).toEqual([viewports[0]]);
        expect(scrolls).toBe(1);
        expect(gridWrites).toEqual([]);
    });
});
