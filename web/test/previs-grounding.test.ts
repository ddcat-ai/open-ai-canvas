import { describe, expect, test } from "bun:test";

import { dropPrevisObjectToGround, groundPrevisObject, groundPrevisScene, isPrevisGroundLockedObject } from "@/lib/canvas/previs/previs-grounding";
import { createPrevisActor, createPrevisObject, createPrevisScene } from "@/lib/canvas/previs/previs-scene";

describe("落地规则", () => {
    test("演员与旧 character 锁地，普通几何体不锁", () => {
        expect(isPrevisGroundLockedObject({ kind: "actor" })).toBe(true);
        expect(isPrevisGroundLockedObject({ kind: "primitive", primitive: "character" })).toBe(true);
        expect(isPrevisGroundLockedObject({ kind: "primitive", primitive: "box" })).toBe(false);
    });

    test("掉到地下的演员（截图里的 -14.54）被拉回 y=0，关键帧与路径同步修正", () => {
        const actor = createPrevisActor("演员", [-1.71, -14.54, -0.62]);
        const withKeys = {
            ...actor,
            keyframes: [{ id: "k1", time: 0, transform: { ...actor.transform, position: [0, -3, 0] as [number, number, number] } }],
            motionPath: {
                points: [
                    [0, -1, 0],
                    [2, 0.5, 0],
                ] as [number, number, number][],
                speed: "walk" as const,
                startDelay: 0,
                orientToPath: true,
            },
        };
        const grounded = groundPrevisObject(withKeys);
        expect(grounded.transform.position).toEqual([-1.71, 0, -0.62]);
        expect(grounded.keyframes[0].transform.position[1]).toBe(0);
        // 路径点 Y 是离地高度：地下的点拉回 0，空中的点保留（演员沿路径悬空移动）。
        expect(grounded.motionPath!.points.map((point) => point[1])).toEqual([0, 0.5]);
    });

    test("演员抬高同样被锁回地面", () => {
        expect(groundPrevisObject(createPrevisActor("演员", [0, 2, 0])).transform.position[1]).toBe(0);
    });

    test("道具可以抬高，但不能沉到地下", () => {
        const raised = createPrevisObject("box", "杯子", [0, 0.75, 0]);
        expect(groundPrevisObject(raised)).toBe(raised);
        // 单位立方体中心原点：底面贴地时中心在 0.5。
        expect(groundPrevisObject(createPrevisObject("box", "箱子", [0, -2, 0])).transform.position[1]).toBe(0.5);
        // 压扁的地面板（高 0.1）贴地时中心在 0.05。
        const slab = createPrevisObject("box", "地面板", [0, -1, 0]);
        expect(groundPrevisObject({ ...slab, transform: { ...slab.transform, scale: [4, 0.1, 4] } }).transform.position[1]).toBeCloseTo(0.05, 6);
        // 模型原点在底部，下限是 0。
        const model = { ...createPrevisObject("box", "模型", [0, -1, 0]), kind: "model" as const, primitive: undefined };
        expect(groundPrevisObject(model).transform.position[1]).toBe(0);
    });

    test("非有限高度视为地面", () => {
        const broken = createPrevisObject("box", "坏数据", [0, Number.NaN, 0]);
        expect(groundPrevisObject(broken).transform.position[1]).toBe(0.5);
    });

    test("无变化时返回原引用，场景修复报告被修正对象", () => {
        const scene = createPrevisScene("测试");
        const ok = createPrevisActor("甲", [0, 0, 0]);
        const sunk = createPrevisActor("乙", [1, -5, 0]);
        expect(groundPrevisObject(ok)).toBe(ok);
        const result = groundPrevisScene({ ...scene, objects: [ok, sunk] });
        expect(result.fixed).toEqual(["乙"]);
        expect(result.scene.objects[0]).toBe(ok);
        const clean = groundPrevisScene({ ...scene, objects: [ok] });
        expect(clean.fixed).toEqual([]);
    });

    test("贴地操作把抬高的道具放回地面", () => {
        const dropped = dropPrevisObjectToGround(createPrevisObject("box", "箱子", [1, 1.2, 2]));
        expect(dropped.transform.position).toEqual([1, 0.5, 2]);
        expect(dropPrevisObjectToGround(createPrevisActor("演员", [0, 3, 0])).transform.position[1]).toBe(0);
    });
});
