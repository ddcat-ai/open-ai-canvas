import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canvasConnectionTilt, latchCanvasConnectionApproach } from "../src/lib/canvas/canvas-connection-tilt";

const node = { position: { x: 100, y: 200 }, width: 400, height: 200 };
test("connection approach determines tilt direction and pivot", () => {
    expect(canvasConnectionTilt(node, { x: 100, y: 300 })).toEqual({ rotateX: 0, rotateY: -5, origin: "0% 50%" });
    expect(canvasConnectionTilt(node, { x: 500, y: 300 })).toEqual({ rotateX: 0, rotateY: 5, origin: "100% 50%" });
    expect(canvasConnectionTilt(node, { x: 300, y: 200 })?.rotateX).toBe(5);
    expect(canvasConnectionTilt(node, { x: 300, y: 400 })?.rotateX).toBe(-5);
});
test("snap padding is clamped, absent or invalid approach stays flat", () => {
    expect(canvasConnectionTilt(node, { x: -100, y: 700 })).toEqual({ rotateX: -5, rotateY: -5, origin: "0% 100%" });
    expect(canvasConnectionTilt(node)).toBeUndefined();
    expect(canvasConnectionTilt(node, { x: NaN, y: 0 })).toBeUndefined();
    expect(canvasConnectionTilt({ ...node, width: 0 }, { x: 0, y: 0 })).toBeUndefined();
});
test("world-space approach is independent of viewport scaling", () => {
    const point = { x: 150, y: 250 };
    const result = canvasConnectionTilt(node, point);
    for (const scale of [0.25, 1, 4]) {
        const screen = { x: point.x * scale + 30, y: point.y * scale - 70 };
        expect(canvasConnectionTilt(node, { x: (screen.x - 30) / scale, y: (screen.y + 70) / scale })).toEqual(result);
    }
});
test("only connection targets receive approach data; memo tracks it and selection does not activate tilt", () => {
    const source = readFileSync(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url), "utf8");
    const layers = readFileSync(new URL("../src/pages/canvas/canvas-project-world-layers.tsx", import.meta.url), "utf8");
    expect(source).toContain("isConnectionTarget && !reduceMediaEffects && !dragOffset");
    expect(source).toContain("previous.connectionApproach?.x === next.connectionApproach?.x");
    expect(source).toContain('data-connection-tilt={connectionTilt ? "true" : undefined}');
    expect(layers).toContain("props.connectionApproach?.nodeId === node.id ? props.connectionApproach.point : undefined");
    expect(layers).not.toMatch(/connectionApproach=\{[^\n]*mouseWorld/);
});

test("600 pointer frames inside one target retain identical entry data", () => {
    const entry = latchCanvasConnectionApproach(null, "target", { x: 10, y: 20 });
    for (let frame = 0; frame < 600; frame++) {
        expect(latchCanvasConnectionApproach(entry, "target", { x: frame, y: frame })).toBe(entry);
    }
    expect(entry?.point).toEqual({ x: 10, y: 20 });
    const next = latchCanvasConnectionApproach(entry, "other", { x: 100, y: 200 });
    expect(next).not.toBe(entry);
    expect(next?.point).toEqual({ x: 100, y: 200 });
    expect(latchCanvasConnectionApproach(next, null, { x: 0, y: 0 })).toBeNull();
    expect(latchCanvasConnectionApproach(null, "target", { x: 30, y: 40 })?.point).toEqual({ x: 30, y: 40 });
});
