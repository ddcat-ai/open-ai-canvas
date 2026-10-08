import { describe, expect, test } from "bun:test";
import { Euler, Quaternion } from "three";

import { resolvePrevisBoneRotation } from "../src/lib/canvas/previs/previs-animation-semantics";
import type { PrevisBoneKeyframe, PrevisQuat } from "../src/types/previs";

function quat(x: number, y: number, z: number): PrevisQuat {
    return new Quaternion().setFromEuler(new Euler(x, y, z)).toArray() as PrevisQuat;
}

function boneKey(id: string, time: number, rotation: PrevisQuat): PrevisBoneKeyframe {
    return { id, time, rotation };
}

function expectQuat(actual: PrevisQuat | null, expected: PrevisQuat) {
    expect(actual).not.toBeNull();
    actual!.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
}

describe("骨骼求值优先级：静置/姿势或动作 -> 静态覆盖 -> 骨骼关键帧", () => {
    test("只有静置与姿势时不写回旋转，由调用方保留 mixer/静置结果", () => {
        expect(resolvePrevisBoneRotation({ rest: quat(0, 0.2, 0), poseDelta: quat(0, 0.1, 0), time: 0 })).toBeNull();
    });

    test("静态覆盖优先于静置与姿势", () => {
        const override = quat(0, 0.7, 0);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0, 0.2, 0), poseDelta: quat(0, 0.1, 0), override, time: 0 }), override);
    });

    test("骨骼关键帧优先于静态覆盖", () => {
        const keyed = quat(0, 1.2, 0);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0, 0.2, 0), override: quat(0, 0.7, 0), keyframes: [boneKey("k0", 0, keyed)], time: 0 }), keyed);
    });

    test("关键帧之间插值，端点精确命中", () => {
        const start = quat(0, 0, 0);
        const end = quat(0, Math.PI / 2, 0);
        const keyframes = [boneKey("k0", 0, start), boneKey("k1", 2, end)];
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 0 }), start);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 2 }), end);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 1 }), quat(0, Math.PI / 4, 0));
    });

    test("动作片段作为最低层输入，覆盖仍然生效", () => {
        const motion = quat(0, 0.9, 0);
        const override = quat(0, 0.4, 0);
        expectQuat(resolvePrevisBoneRotation({ motion, override, time: 0 }), override);
        expect(resolvePrevisBoneRotation({ motion, time: 0 })).toBeNull();
    });

    test("有动作片段时姿势增量不参与，关键帧依然最高优先", () => {
        const keyed = quat(0, 1.1, 0);
        expectQuat(resolvePrevisBoneRotation({ motion: quat(0, 0.9, 0), poseDelta: null, rest: null, keyframes: [boneKey("k0", 0, keyed)], time: 0 }), keyed);
    });
});

describe("手指骨骼使用同一套规则", () => {
    test("手指覆盖优先于静置", () => {
        const override = quat(0.5, 0, 0);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0.1, 0, 0), override, time: 0 }), override);
    });

    test("手指关键帧优先于手指覆盖", () => {
        const keyed = quat(0.9, 0, 0);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0.1, 0, 0), override: quat(0.5, 0, 0), keyframes: [boneKey("f0", 0, keyed)], time: 0 }), keyed);
    });

    test("空轨道退回覆盖值，不产生非法旋转", () => {
        const override = quat(0.2, 0, 0);
        expectQuat(resolvePrevisBoneRotation({ rest: quat(0.1, 0, 0), override, keyframes: [], time: 0 }), override);
    });
});
