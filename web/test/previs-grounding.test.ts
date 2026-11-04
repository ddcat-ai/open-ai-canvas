import { describe, expect, test } from "bun:test";

import { dropPrevisObjectToGround, groundPrevisObject, groundPrevisScene, isPrevisObjectOnGround, isPrevisUprightObject } from "@/lib/canvas/previs/previs-grounding";
import { createPrevisActor, createPrevisObject, createPrevisScene } from "@/lib/canvas/previs/previs-scene";

describe("落地规则", () => {
    test("演员与旧 character 保持直立，普通几何体不限制旋转", () => {
        expect(isPrevisUprightObject({ kind: "actor" })).toBe(true);
        expect(isPrevisUprightObject({ kind: "primitive", primitive: "character" })).toBe(true);
        expect(isPrevisUprightObject({ kind: "primitive", primitive: "box" })).toBe(false);
    });

    test("掉到地下的演员（截图里的 -14.54）被拉回 y=0，关键帧与路径只修正地下部分", () => {
        const actor = createPrevisActor("演员", [-1.71, -14.54, -0.62]);
        const withKeys = {
            ...actor,
            keyframes: [
                { id: "k1", time: 0, transform: { ...actor.transform, position: [0, -3, 0] as [number, number, number] } },
                { id: "k2", time: 1, transform: { ...actor.transform, position: [1, 0.8, 0] as [number, number, number] } },
            ],
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
        expect(grounded.keyframes[1].transform.position[1]).toBe(0.8);
        expect(grounded.motionPath!.points.map((point) => point[1])).toEqual([0, 0.5]);
    });

    test("演员可以抬高（站上桌面、台阶），不会被拉回地面", () => {
        const raised = createPrevisActor("演员", [0, 0.76, 0]);
        expect(groundPrevisObject(raised)).toBe(raised);
        const onRoof = {
            ...createPrevisActor("屋顶演员", [0, 3, 0]),
            motionPath: {
                points: [
                    [0, 3, 0],
                    [2, 3, 0],
                ] as [number, number, number][],
                speed: "walk" as const,
                startDelay: 0,
                orientToPath: true,
            },
        };
        expect(groundPrevisObject(onRoof)).toBe(onRoof);
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
        expect(groundPrevisObject(createPrevisActor("坏演员", [0, Number.NaN, 0])).transform.position[1]).toBe(0);
    });

    test("无变化时返回原引用，场景修复报告被修正对象", () => {
        const scene = createPrevisScene("测试");
        const ok = createPrevisActor("甲", [0, 0, 0]);
        const raised = createPrevisActor("丙", [0, 1.2, 0]);
        const sunk = createPrevisActor("乙", [1, -5, 0]);
        expect(groundPrevisObject(ok)).toBe(ok);
        const result = groundPrevisScene({ ...scene, objects: [ok, raised, sunk] });
        expect(result.fixed).toEqual(["乙"]);
        expect(result.scene.objects[0]).toBe(ok);
        expect(result.scene.objects[1]).toBe(raised);
        const clean = groundPrevisScene({ ...scene, objects: [ok, raised] });
        expect(clean.fixed).toEqual([]);
    });

    test("贴地操作把抬高的道具和演员放回地面", () => {
        const dropped = dropPrevisObjectToGround(createPrevisObject("box", "箱子", [1, 1.2, 2]));
        expect(dropped.transform.position).toEqual([1, 0.5, 2]);
        expect(dropPrevisObjectToGround(createPrevisActor("演员", [0, 3, 0])).transform.position[1]).toBe(0);
    });

    test("贴地按钮状态：演员按脚底判断，几何体按底面判断", () => {
        const actor = createPrevisActor("演员", [0, 0, 0]);
        expect(isPrevisObjectOnGround(actor, actor.transform)).toBe(true);
        expect(isPrevisObjectOnGround(actor, { ...actor.transform, position: [0, 0.76, 0] })).toBe(false);
        const box = createPrevisObject("box", "箱子", [0, 0.5, 0]);
        expect(isPrevisObjectOnGround(box, box.transform)).toBe(true);
        expect(isPrevisObjectOnGround(box, { ...box.transform, position: [0, 1.2, 0] })).toBe(false);
    });
});
