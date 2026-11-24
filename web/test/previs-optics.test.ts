import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PREVIS_ASPECT_RATIOS, previsHorizontalFov, previsVerticalFov, resolvePrevisDepthRange, resolvePrevisOutputSize, resolvePrevisSafeFrame, resolvePrevisShotFov } from "../src/lib/canvas/previs/previs-optics";

describe("镜头光学与输出边界", () => {
    test("36mm 传感器、画幅和焦段共同决定取景，忽略陈旧 fov", () => {
        expect(previsHorizontalFov(18)).toBeCloseTo(90);
        expect(previsVerticalFov(18, 1)).toBeCloseTo(90);
        expect(resolvePrevisShotFov({ focalLength: 18, fov: 10 }, { aspectRatio: "16:9" })).toBeCloseTo(58.715507);
    });
    test("横竖画幅输出偶数尺寸，拒绝不可用的纹理尺寸", () => {
        expect(resolvePrevisOutputSize(9 / 16)).toEqual({ width: 720, height: 1280 });
        expect(resolvePrevisOutputSize(2.39)).toEqual({ width: 1280, height: 536 });
        for (const value of [NaN, Infinity, 0, -1, 8193]) expect(() => resolvePrevisOutputSize(1, value)).toThrow();
    });
    test("宽与窄容器均以内接框表达镜头画幅", () => {
        expect(resolvePrevisSafeFrame({ width: 1000, height: 800 }, 9 / 16)).toEqual({ width: 450, height: 800, left: 275, top: 0 });
        const frame = resolvePrevisSafeFrame({ width: 300, height: 800 }, 16 / 9);
        expect(frame.width).toBe(300);
        expect(frame.height).toBeCloseTo(168.75);
        expect(frame.top).toBeCloseTo((800 - 168.75) / 2);
    });
    test("整段镜头共用范围，并给场景距离留余量", () => {
        expect(
            resolvePrevisDepthRange({
                cameraPositions: [
                    [0, 0, 0],
                    [0, 0, 2],
                ],
                objectPositions: [[0, 0, 10]],
            }),
        ).toEqual({ near: 6.5, far: 13 });
    });
    test("超过远端上限的对象不会反转 near/far", () => {
        expect(resolvePrevisDepthRange({ cameraPositions: [[0, 0, 0]], objectPositions: [[1000, 0, 0]], maxFar: 80 })).toEqual({ near: 78, far: 80 });
        expect(resolvePrevisDepthRange({ cameraPositions: [], objectPositions: [], maxFar: 10 })).toEqual({ near: 0, far: 10 });
        expect(() => resolvePrevisDepthRange({ cameraPositions: [], objectPositions: [], maxFar: NaN })).toThrow();
    });
});

describe("画幅与后端一致", () => {
    test("Agent 可写的画幅与前端画幅选项同序", () => {
        const source = readFileSync(join(import.meta.dir, "../../backend/internal/app/cloud_agent_previs_mutation.go"), "utf8");
        const backend = /var cloudAgentPrevisAspectRatios = \[\]string\{([^}]*)\}/
            .exec(source)?.[1]
            .match(/"([^"]+)"/g)
            ?.map((item) => item.slice(1, -1));
        expect(backend).toEqual(PREVIS_ASPECT_RATIOS.map((item) => item.value));
    });
});
