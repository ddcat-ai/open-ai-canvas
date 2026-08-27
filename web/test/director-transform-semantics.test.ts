import { describe, expect, test } from "bun:test";
import { Euler, Vector3 } from "three";

import {
    advanceDirectorPlayhead,
    applyDirectorTransformDelta,
    directorTransformDelta,
    resolveDirectorCameraAlignment,
    resolveDirectorCameraMoveKeyframes,
    resolveDirectorKeyframeRecord,
    resolveDirectorObjectTransformEdit,
    snapDirectorTime,
} from "../src/lib/canvas/director/director-animation-semantics";
import { createDirectorCamera, directorTransformPathLength, finiteDirectorTransformKeyframes, interpolateDirectorTransform } from "../src/lib/canvas/director/director-scene";
import type { DirectorKeyframe, DirectorTransform } from "../src/types/director";

function transform(position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): DirectorTransform {
    return { position, rotation, scale };
}

function keyframe(id: string, time: number, value: DirectorTransform): DirectorKeyframe {
    return { id, time, transform: value };
}

describe("snapDirectorTime", () => {
    test("按帧率吸附并夹到非负", () => {
        expect(snapDirectorTime(1.031, 24)).toBeCloseTo(1.0416666, 6);
        expect(snapDirectorTime(-0.4, 24)).toBe(0);
        expect(snapDirectorTime(1.031, 0)).toBeCloseTo(1.0416666, 6);
    });
});

describe("摄影机对齐当前视图", () => {
    test("无关键帧时更新基础 transform", () => {
        const camera = createDirectorCamera();
        const aligned = transform([9, 3, 2]);
        const next = resolveDirectorCameraAlignment(camera, aligned, 1);
        expect(next.transform).toEqual(aligned);
        expect(next.keyframes).toEqual([]);
    });

    test("已有轨迹时写当前时间关键帧，CAM 立即显示对齐结果且不丢其他帧", () => {
        const camera = {
            ...createDirectorCamera(),
            keyframes: [keyframe("start", 0, transform([0, 0, 0])), keyframe("end", 2, transform([10, 0, 0]))],
        };
        const aligned = transform([4, 5, 6]);
        const next = resolveDirectorCameraAlignment(camera, aligned, 1);
        expect(next.transform).toBe(camera.transform);
        expect(next.keyframes).toHaveLength(3);
        expect(interpolateDirectorTransform(next.transform, next.keyframes, 1)).toEqual(aligned);
        expect(next.keyframes.find((item) => item.id === "start")).toEqual(camera.keyframes[0]);
        expect(next.keyframes.find((item) => item.id === "end")).toEqual(camera.keyframes[1]);
    });
});

describe("生成摄影机运镜首尾帧", () => {
    test("保留手工中间帧、已有 id 与 easing，只更新首尾 transform", () => {
        const existing: DirectorKeyframe[] = [{ ...keyframe("start", 0, transform([9, 0, 0])), easing: "step" }, { ...keyframe("manual", 1, transform([4, 2, 0])), easing: "smooth" }, keyframe("end", 2, transform([8, 0, 0]))];
        const next = resolveDirectorCameraMoveKeyframes(existing, transform([0, 0, 0]), transform([2, 0, 0]), 2);
        expect(next.map((item) => item.id)).toEqual(["start", "manual", "end"]);
        expect(next[0].transform.position).toEqual([0, 0, 0]);
        expect(next[1]).toEqual(existing[1]);
        expect(next[2].transform.position).toEqual([2, 0, 0]);
        expect(next[0].easing).toBe("step");
    });

    test("空轨道生成两枚有序首尾帧", () => {
        const next = resolveDirectorCameraMoveKeyframes([], transform([0, 0, 0]), transform([0, 0, -2]), 3);
        expect(next.map((item) => item.time)).toEqual([0, 3]);
    });
});

describe("播放头循环推进", () => {
    test("跨越镜头末尾时保留余量", () => {
        expect(advanceDirectorPlayhead(1.9, 0.3, 2)).toBeCloseTo(0.2, 8);
    });

    test("非法播放头、增量和时长安全回落", () => {
        expect(advanceDirectorPlayhead(Number.NaN, 0.5, 2)).toBe(0.5);
        expect(advanceDirectorPlayhead(1, Number.NaN, 2)).toBe(1);
        expect(advanceDirectorPlayhead(1, 1, 0)).toBe(0);
    });
});

describe("Transform 轨迹统计", () => {
    test("按时间顺序累计空间路径，不把输入数组顺序当成路径顺序", () => {
        const keys = [keyframe("end", 2, transform([3, 4, 0])), keyframe("start", 0, transform([0, 0, 0])), keyframe("middle", 1, transform([0, 4, 0]))];
        expect(directorTransformPathLength(keys)).toBe(7);
        expect(keys.map((key) => key.id)).toEqual(["end", "start", "middle"]);
    });

    test("忽略含非法坐标的段，避免 NaN 污染轨迹显示判断", () => {
        const keys = [keyframe("valid", 0, transform([0, 0, 0])), keyframe("invalid", 1, transform([Number.NaN, 2, 0])), keyframe("valid-again", 2, transform([3, 4, 0]))];
        expect(directorTransformPathLength(keys)).toBe(0);
    });

    test("轨迹渲染过滤非法时间与坐标，不把 NaN/Infinity 传给 Three", () => {
        const keys = [keyframe("start", 0, transform([0, 0, 0])), keyframe("bad-time", Number.NaN, transform([1, 0, 0])), keyframe("bad-position", 1, transform([Number.POSITIVE_INFINITY, 0, 0])), keyframe("end", 2, transform([2, 0, 0]))];
        const renderable = finiteDirectorTransformKeyframes(keys);
        expect(renderable.map((item) => item.id)).toEqual(["start", "end"]);
        expect(renderable.flatMap((item) => [item.time, ...item.transform.position]).every(Number.isFinite)).toBe(true);
    });
});

describe("resolveDirectorObjectTransformEdit：Auto Key 打开", () => {
    test("只在吸附播放头写单个关键帧，base 与其他关键帧不变", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([4, 0, 0]))];
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: transform([2, 0, 0]), edited: transform([2, 5, 0]), autoKey: true, time: 1 });
        expect(edit.transform).toEqual(base);
        expect(edit.keyframes).toHaveLength(3);
        expect(edit.keyframes.find((item) => item.time === 1)?.transform.position).toEqual([2, 5, 0]);
        expect(edit.keyframes.find((item) => item.id === "k0")?.transform.position).toEqual([0, 0, 0]);
        expect(edit.keyframes.find((item) => item.id === "k2")?.transform.position).toEqual([4, 0, 0]);
    });

    test("同一时间重复编辑复用同一关键帧而不是新增", () => {
        const edit = resolveDirectorObjectTransformEdit({ base: transform([0, 0, 0]), keyframes: [keyframe("k1", 1, transform([1, 0, 0]))], rendered: transform([1, 0, 0]), edited: transform([9, 0, 0]), autoKey: true, time: 1 });
        expect(edit.keyframes).toHaveLength(1);
        expect(edit.keyframes[0].transform.position).toEqual([9, 0, 0]);
    });
});

describe("resolveDirectorObjectTransformEdit：Auto Key 关闭", () => {
    test("无关键帧时直接改写 base，保留用户输入的精确数值", () => {
        const edited = transform([1.5, 2.25, -3], [0.1, 0.2, 0.3], [2, 2, 2]);
        const edit = resolveDirectorObjectTransformEdit({ base: transform([0, 0, 0]), keyframes: [], rendered: transform([0, 0, 0]), edited, autoKey: false, time: 0.5 });
        expect(edit.transform).toEqual(edited);
        expect(edit.keyframes).toEqual([]);
    });

    test("有关键帧时把增量整体搬到 base 和所有关键帧，编辑立即可见", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([4, 0, 0]))];
        const rendered = interpolateDirectorTransform(base, keyframes, 1);
        expect(rendered.position).toEqual([2, 0, 0]);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: transform([2, 3, 0]), autoKey: false, time: 1 });
        expect(edit.keyframes).toHaveLength(2);
        expect(edit.transform.position).toEqual([0, 3, 0]);
        expect(edit.keyframes[0].transform.position).toEqual([0, 3, 0]);
        expect(edit.keyframes[1].transform.position).toEqual([4, 3, 0]);
        // 编辑后在同一时间点的渲染值等于用户所见的编辑值。
        expect(interpolateDirectorTransform(edit.transform, edit.keyframes, 1).position).toEqual([2, 3, 0]);
    });
});

describe("未被编辑场景的兼容性", () => {
    test("单关键帧场景在编辑前后都由该关键帧决定渲染", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("only", 1, transform([7, 0, 0]))];
        expect(interpolateDirectorTransform(base, keyframes, 0).position).toEqual([7, 0, 0]);
        expect(interpolateDirectorTransform(base, keyframes, 5).position).toEqual([7, 0, 0]);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: transform([7, 0, 0]), edited: transform([7, 2, 0]), autoKey: false, time: 3 });
        expect(edit.keyframes).toHaveLength(1);
        expect(interpolateDirectorTransform(edit.transform, edit.keyframes, 3).position).toEqual([7, 2, 0]);
    });

    test("零增量编辑不改变任何已有关键帧的渲染结果", () => {
        const base = transform([1, 1, 1], [0, 0.3, 0], [2, 2, 2]);
        const keyframes = [keyframe("a", 0, transform([0, 0, 0])), keyframe("b", 4, transform([8, 2, 0]))];
        const rendered = interpolateDirectorTransform(base, keyframes, 2);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: rendered, autoKey: false, time: 2 });
        [0, 1, 2, 3, 4].forEach((time) => {
            const before = interpolateDirectorTransform(base, keyframes, time);
            const after = interpolateDirectorTransform(edit.transform, edit.keyframes, time);
            after.position.forEach((value, index) => expect(value).toBeCloseTo(before.position[index], 10));
            after.scale.forEach((value, index) => expect(value).toBeCloseTo(before.scale[index], 10));
        });
    });
});

describe("缩放增量的零值与比例行为", () => {
    test("源缩放为 0 时用绝对偏移，不产生 Infinity 或 NaN", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0], [0, 0, 0]), transform([0, 0, 0], [0, 0, 0], [3, 0, 1.5]));
        expect(delta.scaleRatio).toEqual([1, 1, 1]);
        expect(delta.scaleOffset).toEqual([3, 0, 1.5]);
        const applied = applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0], [0, 0, 0]), delta);
        applied.scale.forEach((value) => expect(Number.isFinite(value)).toBe(true));
        expect(applied.scale).toEqual([3, 0, 1.5]);
    });

    test("非零缩放走比例，等比套用到其他关键帧", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0], [2, 2, 2]), transform([0, 0, 0], [0, 0, 0], [3, 3, 3]));
        expect(delta.scaleRatio).toEqual([1.5, 1.5, 1.5]);
        expect(applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0], [4, 4, 4]), delta).scale).toEqual([6, 6, 6]);
    });

    test("旋转增量在整条路径上保持确定性（按朝向而非欧拉三元组断言）", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0]), transform([0, 0, 0], [0, Math.PI / 2, 0]));
        const applied = applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0]), delta);
        expect(applied.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
        // 连续两次同一增量等价于 yaw π；欧拉 XYZ 的规范分支会写成 (π, 0, π)，因此比较朝向。
        const twice = applyDirectorTransformDelta(applied, delta);
        const forward = new Vector3(0, 0, 1).applyEuler(new Euler(...twice.rotation));
        expect(forward.x).toBeCloseTo(0, 6);
        expect(forward.z).toBeCloseTo(-1, 6);
    });
});

describe("raw playhead 与 snapped 目的时间的分工（#2 回归）", () => {
    // 24fps 下 1.02s 落在两个帧格之间：snapped = 1.0，raw = 1.02。
    const fps = 24;
    const rawTime = 1.02;
    const snappedTime = snapDirectorTime(rawTime, fps);
    const base = transform([0, 0, 0]);
    const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([20, 0, 0]))];

    test("前置条件：raw 与 snapped 真的解算出不同的值", () => {
        expect(snappedTime).toBeCloseTo(1, 6);
        expect(interpolateDirectorTransform(base, keyframes, rawTime).position[0]).toBeCloseTo(10.2, 6);
        expect(interpolateDirectorTransform(base, keyframes, snappedTime).position[0]).toBeCloseTo(10, 6);
    });

    test("记录关键帧：取值用 raw，写入时间用 snapped", () => {
        const record = resolveDirectorKeyframeRecord({ base, keyframes, rawTime, snappedTime });
        expect(record.time).toBeCloseTo(1, 6);
        // 取错时间会写成 10（rendered-at-snapped），这里必须是 10.2（rendered-at-raw）。
        expect(record.transform.position[0]).toBeCloseTo(10.2, 6);
        const written = record.keyframes.find((item) => Math.abs(item.time - snappedTime) < 0.001);
        expect(written?.transform.position[0]).toBeCloseTo(10.2, 6);
    });

    test("AutoKey OFF 的增量起点必须是 rendered-at-raw，否则编辑后在 raw 处漂移", () => {
        const edited = transform([10.2, 4, 0]);
        const fromRaw = interpolateDirectorTransform(base, keyframes, rawTime);
        const correct = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: fromRaw, edited, autoKey: false, time: snappedTime });
        const afterCorrect = interpolateDirectorTransform(correct.transform, correct.keyframes, rawTime);
        afterCorrect.position.forEach((value, index) => expect(value).toBeCloseTo(edited.position[index], 6));

        // 用 snapped 求起点是原缺陷：编辑后在 raw 处不等于用户所见的编辑值。
        const fromSnapped = interpolateDirectorTransform(base, keyframes, snappedTime);
        const drifted = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: fromSnapped, edited, autoKey: false, time: snappedTime });
        const afterDrift = interpolateDirectorTransform(drifted.transform, drifted.keyframes, rawTime);
        expect(Math.abs(afterDrift.position[0] - edited.position[0])).toBeGreaterThan(0.1);
    });

    test("AutoKey ON 在 raw 与 snapped 之间时只写一个吸附帧", () => {
        const rendered = interpolateDirectorTransform(base, keyframes, rawTime);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: transform([10.2, 7, 0]), autoKey: true, time: snappedTime });
        expect(edit.keyframes).toHaveLength(3);
        const written = edit.keyframes.find((item) => Math.abs(item.time - snappedTime) < 0.001);
        expect(written?.transform.position[1]).toBeCloseTo(7, 6);
        expect(edit.keyframes.some((item) => Math.abs(item.time - rawTime) < 0.001)).toBe(false);
    });
});
