import { expect, test } from "bun:test";
import { isDiscreteCanvasWheel } from "@/lib/canvas/canvas-wheel";
test("recognizes ordinary wheel events under native Windows scaling and line mode", () => {
    for (const delta of [100, -100, 120, -120, 124.999998, 125, 250, -250, 300]) expect(isDiscreteCanvasWheel(delta, 0)).toBe(true);
    expect(isDiscreteCanvasWheel(3, 1)).toBe(true);
});
test("preserves fine touchpad movement and ignores invalid deltas", () => {
    for (const delta of [0, 0.5, 4, 12, 37, 67, 83, 98, 131, NaN, Infinity]) expect(isDiscreteCanvasWheel(delta, 0)).toBe(false);
});
