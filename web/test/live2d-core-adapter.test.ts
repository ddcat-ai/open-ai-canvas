import { describe, expect, test } from "bun:test";
import { adaptLive2DRenderOrders } from "../src/lib/canvas/live2d-core-adapter";

describe("Live2D Core render orders", () => {
    test("preserves the legacy Core interface", () => {
        const orders = new Int32Array([0]);
        const original = () => orders;
        const model = { getModel: () => ({ drawables: { count: 1, renderOrders: orders } }), getDrawableRenderOrders: original };
        adaptLive2DRenderOrders(model);
        expect(model.getDrawableRenderOrders).toBe(original);
    });
    test("reads current orders from the new Core on every frame", () => {
        let orders = new Int32Array([1, 0]);
        const model = { getModel: () => ({ drawables: { count: 2 }, offscreens: { count: 0 }, getRenderOrders: () => orders }), getDrawableRenderOrders: () => new Int32Array() };
        adaptLive2DRenderOrders(model);
        expect(model.getDrawableRenderOrders()).toBe(orders);
        orders = new Int32Array([0, 1]);
        expect(model.getDrawableRenderOrders()).toBe(orders);
    });
    test("rejects unsupported offscreens", () => {
        const model = { getModel: () => ({ drawables: { count: 1 }, offscreens: { count: 1 } }), getDrawableRenderOrders: () => new Int32Array() };
        expect(() => adaptLive2DRenderOrders(model)).toThrow("离屏渲染");
    });
    test("rejects missing or inconsistent orders", () => {
        expect(() => adaptLive2DRenderOrders({ getModel: () => ({ drawables: { count: 1 } }), getDrawableRenderOrders: () => new Int32Array() })).toThrow("缺少");
        expect(() => adaptLive2DRenderOrders({ getModel: () => ({ drawables: { count: 1 }, getRenderOrders: () => new Int32Array() }), getDrawableRenderOrders: () => new Int32Array() })).toThrow("不匹配");
    });
});
