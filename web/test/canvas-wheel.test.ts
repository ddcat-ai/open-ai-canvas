import { expect, test } from "bun:test";
import { isDiscreteCanvasWheel } from "@/lib/canvas/canvas-wheel";
import { CANVAS_WHEEL_GESTURE_IDLE_MS, CANVAS_WHEEL_HOVER_MS, createCanvasWheelIntent } from "@/lib/canvas/canvas-wheel-intent";
test("recognizes ordinary wheel events under native Windows scaling and line mode", () => {
    for (const delta of [100, -100, 120, -120, 124.999998, 125, 250, -250, 300]) expect(isDiscreteCanvasWheel(delta, 0)).toBe(true);
    expect(isDiscreteCanvasWheel(3, 1)).toBe(true);
});
test("preserves fine touchpad movement and ignores invalid deltas", () => {
    for (const delta of [0, 0.5, 4, 12, 37, 67, 83, 98, 131, NaN, Infinity]) expect(isDiscreteCanvasWheel(delta, 0)).toBe(false);
});
test("requires a settled hover and an idle boundary before handing a new wheel gesture to text", () => {
    const target = {};
    const intent = createCanvasWheelIntent<object>();
    const point = { clientX: 20, clientY: 30 };

    intent.move(target, point, 0);
    expect(intent.resolve(target, point, 0)).toBe("canvas");
    expect(intent.resolve(target, point, CANVAS_WHEEL_HOVER_MS)).toBe("canvas");
    expect(intent.resolve(target, point, CANVAS_WHEEL_HOVER_MS + CANVAS_WHEEL_GESTURE_IDLE_MS)).toBe("scroll");
    expect(intent.resolve(target, point, CANVAS_WHEEL_HOVER_MS + CANVAS_WHEEL_GESTURE_IDLE_MS + 20)).toBe("scroll");
});

test("keeps a fast canvas gesture while crossing a text target", () => {
    const target = {};
    const intent = createCanvasWheelIntent<object>();
    const canvasPoint = { clientX: 0, clientY: 0 };
    const textPoint = { clientX: 40, clientY: 40 };

    expect(intent.resolve(null, canvasPoint, 0)).toBe("canvas");
    intent.move(target, textPoint, 20);
    expect(intent.resolve(target, textPoint, 80)).toBe("canvas");
    expect(intent.resolve(target, textPoint, 150)).toBe("canvas");
});

test("modifier wheel can reclaim a text target without changing its scroll owner", () => {
    const target = {};
    const intent = createCanvasWheelIntent<object>();
    const point = { clientX: 20, clientY: 30 };

    intent.move(target, point, 0);
    expect(intent.resolve(target, point, 200)).toBe("scroll");
    expect(intent.resolve(target, point, 220, true)).toBe("canvas");
    expect(intent.resolve(target, point, 260)).toBe("canvas");
});
