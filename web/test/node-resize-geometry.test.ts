import { describe, expect, test } from "bun:test";
import { solveNodeResize, type NodeResizeCorner, type NodeResizeSnapshot } from "../src/lib/canvas/node-resize-geometry";

const initial: NodeResizeSnapshot = {
    position: { x: -30, y: 70 },
    width: 400,
    height: 200,
    minimumWidth: 100,
    minimumHeight: 80,
    corner: "bottom-right",
};
const corners: NodeResizeCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

function opposite(box: { position: { x: number; y: number }; width: number; height: number }, corner: NodeResizeCorner) {
    return {
        x: box.position.x + (corner.endsWith("left") ? box.width : 0),
        y: box.position.y + (corner.startsWith("top") ? box.height : 0),
    };
}

describe("node resize geometry", () => {
    test("all corners retain the opposite anchor at minimum sizes and across the anchor", () => {
        for (const corner of corners)
            for (const x of [-2000, -50, 0, 75, 2000])
                for (const y of [-2000, -50, 0, 75, 2000]) {
                    const start = { ...initial, corner };
                    const next = solveNodeResize(start, { x, y });
                    expect(opposite(next, corner)).toEqual(opposite(start, corner));
                    expect(next.width).toBeGreaterThanOrEqual(100);
                    expect(next.height).toBeGreaterThanOrEqual(80);
                }
    });

    test("free resize grows the dragged corner in world coordinates", () => {
        expect(solveNodeResize({ ...initial, corner: "top-left" }, { x: -60, y: -30 })).toEqual({
            position: { x: -90, y: 40 },
            width: 460,
            height: 230,
        });
        expect(solveNodeResize(initial, { x: 60, y: 30 })).toEqual({
            position: initial.position,
            width: 460,
            height: 230,
        });
    });

    test("media preserves ratio, both minimums and the fixed anchor", () => {
        for (const ratio of [0.1, 0.5, 1, 2, 10])
            for (const corner of corners)
                for (const delta of [
                    { x: -5000, y: 3000 },
                    { x: 50, y: -60 },
                    { x: 3000, y: -5000 },
                ]) {
                    const start = { ...initial, corner, ratio };
                    const next = solveNodeResize(start, delta);
                    expect(next.width / next.height).toBeCloseTo(ratio, 10);
                    expect(next.width).toBeGreaterThanOrEqual(100);
                    expect(next.height).toBeGreaterThanOrEqual(80);
                    expect(opposite(next, corner).x).toBeCloseTo(opposite(start, corner).x, 8);
                    expect(opposite(next, corner).y).toBeCloseTo(opposite(start, corner).y, 8);
                }
    });

    test("dominant pointer axis and horizontal ties preserve the existing gesture", () => {
        const start = { ...initial, ratio: 2 };
        expect(solveNodeResize(start, { x: 80, y: 20 })).toMatchObject({ width: 480, height: 240 });
        expect(solveNodeResize(start, { x: 20, y: 80 })).toMatchObject({ width: 560, height: 280 });
        expect(solveNodeResize(start, { x: 80, y: -80 })).toMatchObject({ width: 480, height: 240 });
    });

    test("storyboard content can override the registry minimum height", () => {
        expect(solveNodeResize({ ...initial, minimumHeight: 360 }, { x: -1000, y: -1000 })).toMatchObject({ width: 100, height: 360 });
    });

    test("invalid aspect metadata falls back to finite independent dimensions", () => {
        for (const ratio of [NaN, Infinity, 0, -2]) {
            expect(solveNodeResize({ ...initial, ratio }, { x: 40, y: 10 })).toMatchObject({ width: 440, height: 210 });
        }
    });
});
