import { describe, expect, test } from "bun:test";

import { applyPrevisMotionPath, buildPrevisMotionPathKeyframes, insertPrevisPathPoint, normalizePrevisMotionPath, planPrevisMotionPath, previsPathEase, previsPathPointsFromStroke, removePrevisPathPoint } from "@/lib/canvas/previs/previs-motion-path";
import { evaluatePrevisActorPose } from "@/lib/canvas/previs/previs-motion";
import { createPrevisActor, interpolatePrevisKeyframeLift, interpolatePrevisTransform, previsIdentityTransform } from "@/lib/canvas/previs/previs-scene";
import { resolvePrevisSubjectState } from "@/lib/canvas/previs/previs-camera-moves";
import type { PrevisKeyframe, PrevisMotionPath, PrevisVec3 } from "@/types/previs";

const base = previsIdentityTransform([0, 0, 0]);

/**
 * 与 backend/internal/app/cloud_agent_previs_path_test.go 共用的三组路径：同一输入在前后端展开出同样的关键帧。
 * 校验量：帧数、首末帧、时间和、X 和、高度（lift 或 Y）和，均保留 4 位小数。
 */
export const PREVIS_PATH_GOLDEN: Array<{ name: string; locked: boolean; shot: number; path: PrevisMotionPath }> = [
    {
        name: "actor-hold-smooth",
        locked: true,
        shot: 10,
        path: {
            points: [
                [0, 0, 0],
                [4, 2, 0],
                [4, 2, 4],
            ],
            speed: "walk",
            metersPerSecond: 2,
            startDelay: 1,
            orientToPath: true,
            easing: "smooth",
            holds: [0, 1, 0],
        },
    },
    {
        name: "camera-curve-speeds",
        locked: false,
        shot: 6,
        path: {
            points: [
                [0, 3, 0],
                [2, 3, 2],
                [4, 1, 0],
                [6, 0.5, 2],
            ],
            speed: "run",
            startDelay: 0,
            orientToPath: false,
            curve: true,
            speeds: [1, 2, 0.5],
        },
    },
    {
        name: "compressed-ease-in",
        locked: true,
        shot: 5,
        path: {
            points: [
                [0, 0, 0],
                [30, 0, 0],
            ],
            speed: "walk",
            startDelay: 0,
            orientToPath: true,
            easing: "ease_in",
        },
    },
];

const r4 = (value: number) => Math.round(value * 10000) / 10000;

export function previsPathChecksum(frames: PrevisKeyframe[], locked: boolean) {
    const height = (frame: PrevisKeyframe) => (locked ? (frame.lift ?? 0) : frame.transform.position[1]);
    return {
        count: frames.length,
        first: [frames[0].id.replace(/^.*-path-/u, ""), frames[0].time, ...frames[0].transform.position],
        last: [frames[frames.length - 1].id.replace(/^.*-path-/u, ""), frames[frames.length - 1].time, ...frames[frames.length - 1].transform.position],
        timeSum: r4(frames.reduce((sum, frame) => sum + frame.time, 0)),
        xSum: r4(frames.reduce((sum, frame) => sum + frame.transform.position[0], 0)),
        heightSum: r4(frames.reduce((sum, frame) => sum + height(frame), 0)),
    };
}

const EXPECTED: Record<string, ReturnType<typeof previsPathChecksum>> = {
    "actor-hold-smooth": { count: 46, first: ["hold", 0, 0, 0, 0], last: ["45", 6.236, 4, 0, 4], timeSum: 160.789, xSum: 132, heightSum: 66 },
    "camera-curve-speeds": { count: 25, first: ["1", 0, 0, 3, 0], last: ["25", 3.019, 6, 0.5, 2], timeSum: 31.005, xSum: 75, heightSum: 47.9142 },
    "compressed-ease-in": { count: 51, first: ["1", 0, 0, 0, 0], last: ["51", 5, 30, 0, 0], timeSum: 127.5, xSum: 515.1, heightSum: 0 },
};

describe("路径展开（与后端同一组数值）", () => {
    for (const fixture of PREVIS_PATH_GOLDEN) {
        test(fixture.name, () => {
            const frames = buildPrevisMotionPathKeyframes({ id: "p", base, path: fixture.path, shotDuration: fixture.shot, locked: fixture.locked });
            expect(previsPathChecksum(frames, fixture.locked)).toEqual(EXPECTED[fixture.name]);
            for (let index = 1; index < frames.length; index += 1) expect(frames[index].time).toBeGreaterThan(frames[index - 1].time);
        });
    }
});

describe("路径动画", () => {
    test("旧行为不变：步行 1.4m/s，1 秒出发，0 秒有等待帧", () => {
        const frames = buildPrevisMotionPathKeyframes({
            id: "w",
            base,
            path: {
                points: [
                    [0, 0, 0],
                    [2.8, 0, 0],
                ],
                speed: "walk",
                startDelay: 1,
                orientToPath: true,
            },
            shotDuration: 5,
            locked: true,
        });
        expect(frames.map((frame) => [frame.id, frame.time])).toEqual([
            ["w-path-hold", 0],
            ["w-path-1", 1],
            ["w-path-2", 3],
        ]);
        expect(frames[2].transform.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
    });

    test("镜头结束才出发时只写一帧原地等待", () => {
        const frames = buildPrevisMotionPathKeyframes({
            id: "w",
            base,
            path: {
                points: [
                    [0, 0, 0],
                    [1, 0, 0],
                ],
                speed: "walk",
                startDelay: 5,
                orientToPath: false,
            },
            shotDuration: 5,
            locked: true,
        });
        expect(frames.map((frame) => frame.id)).toEqual(["w-path-hold"]);
    });

    test("演员路径高度写进 lift，位置贴地；人偶悬空且不迈步，机位跟拍按真实高度", () => {
        const actor = createPrevisActor("飞人", [0, 0, 0]);
        const flying = applyPrevisMotionPath(
            actor,
            {
                points: [
                    [0, 0, 0],
                    [5, 3, 0],
                    [10, 3, 0],
                ],
                speed: "walk",
                metersPerSecond: 2.5,
                startDelay: 0,
                orientToPath: true,
            },
            6,
            true,
        );
        expect(flying.keyframes.every((frame) => frame.transform.position[1] === 0)).toBe(true);
        const mid = flying.keyframes.find((frame) => frame.transform.position[0] === 10)!;
        expect(mid.lift).toBe(3);
        const time = 3;
        expect(interpolatePrevisKeyframeLift(flying.keyframes, time)).toBeGreaterThan(2.5);
        const pose = evaluatePrevisActorPose(flying, time);
        expect(pose.worldLift).toBeCloseTo(interpolatePrevisKeyframeLift(flying.keyframes, time), 6);
        expect(pose.locomotion).toBe("still");
        expect(resolvePrevisSubjectState(flying, time).root[1]).toBeCloseTo(pose.worldLift, 6);
    });

    test("摄影机与道具的高度直接写进位置 Y", () => {
        const camera = { id: "cam", transform: previsIdentityTransform([0, 2, 0]), keyframes: [] as PrevisKeyframe[] };
        const updated = applyPrevisMotionPath(
            camera,
            {
                points: [
                    [0, 2, 0],
                    [0, 10, -20],
                ],
                speed: "walk",
                metersPerSecond: 10,
                startDelay: 0,
                orientToPath: false,
            },
            5,
            false,
        );
        expect(interpolatePrevisTransform(camera.transform, updated.keyframes, 5).position).toEqual([0, 10, -20]);
        expect(updated.keyframes.some((frame) => frame.lift)).toBe(false);
    });

    test("用时优先于速度；每段倍率改变分配；停留插入原地帧；镜头放不下时等比压缩", () => {
        const byDuration = planPrevisMotionPath(
            {
                points: [
                    [0, 0, 0],
                    [10, 0, 0],
                ],
                speed: "run",
                startDelay: 0,
                orientToPath: false,
                duration: 4,
            },
            10,
        );
        expect(byDuration.travel).toBeCloseTo(4, 6);
        const segmented = planPrevisMotionPath(
            {
                points: [
                    [0, 0, 0],
                    [2, 0, 0],
                    [4, 0, 0],
                ],
                speed: "walk",
                metersPerSecond: 1,
                startDelay: 0,
                orientToPath: false,
                speeds: [1, 2],
            },
            10,
        );
        expect(segmented.edgeTimes).toEqual([2, 1]);
        const held = planPrevisMotionPath(
            {
                points: [
                    [0, 0, 0],
                    [2, 0, 0],
                    [4, 0, 0],
                ],
                speed: "walk",
                metersPerSecond: 1,
                startDelay: 0,
                orientToPath: false,
                holds: [0, 1.5, 9],
            },
            10,
        );
        expect(held.end).toBeCloseTo(5.5, 6);
        const compressed = planPrevisMotionPath(
            {
                points: [
                    [0, 0, 0],
                    [30, 0, 0],
                ],
                speed: "walk",
                startDelay: 1,
                orientToPath: false,
            },
            5,
        );
        expect(compressed.compressed).toBe(true);
        expect(compressed.end).toBeCloseTo(5, 6);
    });

    test("运动规律：加速前慢后快、减速前快后慢、缓入缓出两头慢", () => {
        expect(previsPathEase("ease_in", 0.5)).toBeCloseTo(0.25, 6);
        expect(previsPathEase("ease_out", 0.5)).toBeCloseTo(0.75, 6);
        expect(previsPathEase("smooth", 0.5)).toBeCloseTo(0.5, 6);
        expect(previsPathEase("smooth", 0.1)).toBeLessThan(0.1);
        const frames = buildPrevisMotionPathKeyframes({
            id: "a",
            base,
            path: {
                points: [
                    [0, 0, 0],
                    [10, 0, 0],
                ],
                speed: "walk",
                metersPerSecond: 1,
                startDelay: 0,
                orientToPath: false,
                easing: "ease_in",
            },
            shotDuration: 20,
            locked: false,
        });
        const at = (time: number) => interpolatePrevisTransform(base, frames, time).position[0];
        expect(at(5)).toBeCloseTo(2.5, 1);
        expect(at(10)).toBeCloseTo(10, 6);
    });

    test("途经点插入、删除保持速度倍率与停留对齐；画笔笔迹去抖并限制点数", () => {
        const path: PrevisMotionPath = {
            points: [
                [0, 0, 0],
                [4, 0, 0],
            ],
            speed: "walk",
            startDelay: 0,
            orientToPath: true,
            speeds: [2],
            holds: [1, 0],
        };
        const inserted = insertPrevisPathPoint(path, 0);
        expect(inserted.points[1]).toEqual([2, 0, 0]);
        expect(inserted.speeds).toEqual([2, 2]);
        expect(inserted.holds).toEqual([1, 0, 0]);
        expect(removePrevisPathPoint(inserted, 1)).toEqual({ ...path, speeds: [2], holds: [1, 0] });
        expect(removePrevisPathPoint(path, 0)).toBe(path);
        const stroke: PrevisVec3[] = Array.from({ length: 400 }, (_, index) => [index * 0.05, 0, Math.sin(index / 12) * 2 + (index % 2) * 0.01]);
        const points = previsPathPointsFromStroke(stroke);
        expect(points.length).toBeLessThanOrEqual(24);
        expect(points[0]).toEqual(stroke[0]);
        expect(points.at(-1)).toEqual(stroke.at(-1));
        expect(
            normalizePrevisMotionPath(
                {
                    ...path,
                    points: [
                        [0, -2, 0],
                        [1, 3, 0],
                    ],
                },
                true,
            ).points,
        ).toEqual([
            [0, 0, 0],
            [1, 3, 0],
        ]);
    });
});
