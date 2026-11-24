import { describe, expect, test } from "bun:test";
import { applyPrevisMotionPath, isPrevisPathKeyframe } from "@/lib/canvas/previs/previs-motion-path";
import { resolvePrevisPathSource, transferPrevisPathToActor } from "@/lib/canvas/previs/previs-path-transfer";
import { createPrevisActor, createPrevisCamera, createPrevisScene, previsIdentityTransform } from "@/lib/canvas/previs/previs-scene";
import type { PrevisMotionPath, PrevisScene } from "@/types/previs";

const SHOT = 8;

/** 摄影机上画了一条从 1.6 米升到 3 米的运镜轨迹，用时 3 秒、减速收尾。 */
function setup(): PrevisScene {
    const base = createPrevisScene();
    const actor = { ...createPrevisActor("主角", [0, 0, 0]), id: "hero" };
    const cameraPath: PrevisMotionPath = {
        points: [
            [0, 1.6, 6],
            [4, 2.4, 2],
            [8, 3, -2],
        ],
        speed: "walk",
        duration: 3,
        easing: "ease_out",
        startDelay: 0,
        orientToPath: false,
    };
    const camera = applyPrevisMotionPath({ ...createPrevisCamera(), id: "cam", transform: previsIdentityTransform([0, 1.6, 6]), target: [0, 1.5, 0] }, cameraPath, SHOT, false);
    return {
        ...base,
        objects: [actor],
        cameras: [camera],
        shots: [{ ...base.shots[0], cameraId: "cam", duration: SHOT }],
        paths: [
            {
                id: "sketch-1",
                label: "路径1",
                points: [
                    [0, 0, 0],
                    [6, 2, 0],
                    [12, 2, 6],
                ],
            },
        ],
    };
}

const actorOf = (scene: PrevisScene) => scene.objects.find((item) => item.id === "hero")!;
const cameraOf = (scene: PrevisScene) => scene.cameras.find((item) => item.id === "cam")!;

describe("人物沿运镜轨迹走", () => {
    test("trail：人物贴地沿同一节奏走，镜头沿原轨迹晚 0.8 秒出发并盯住人物", () => {
        const next = transferPrevisPathToActor(setup(), { source: { kind: "camera", id: "cam" }, actorId: "hero", keepHeight: false, cameraId: "cam", cameraMode: "trail", shotDuration: SHOT });
        const actor = actorOf(next);
        expect(actor.motionPath?.easing).toBe("ease_out");
        expect(actor.motionPath?.duration).toBe(3);
        expect(actor.motionPath?.points.every((point) => point[1] === 0)).toBe(true);
        expect(actor.keyframes.every((key) => !key.lift)).toBe(true);
        const camera = cameraOf(next);
        expect(camera.motionPath?.startDelay).toBeCloseTo(0.8, 6);
        expect(camera.motionPath?.points.map((point) => point[1])).toEqual([1.6, 2.4, 3]);
        expect(camera.moves?.map((move) => [move.technique, move.subjectId])).toEqual([["look_at", "hero"]]);
    });

    test("keepHeight：人物按轨迹高度悬空飞行，高度进 lift，位置贴地", () => {
        const next = transferPrevisPathToActor(setup(), { source: { kind: "camera", id: "cam" }, actorId: "hero", keepHeight: true, cameraMode: "none", shotDuration: SHOT });
        const actor = actorOf(next);
        expect(actor.keyframes.every((key) => key.transform.position[1] === 0)).toBe(true);
        expect(Math.max(...actor.keyframes.map((key) => key.lift ?? 0))).toBeCloseTo(3, 6);
        expect(cameraOf(next).motionPath?.startDelay).toBe(0);
    });

    test("follow：去掉镜头原路径与路径关键帧，改为后方跟拍；重复操作不叠加旧跟拍", () => {
        const once = transferPrevisPathToActor(setup(), { source: { kind: "camera", id: "cam" }, actorId: "hero", keepHeight: false, cameraId: "cam", cameraMode: "follow", shotDuration: SHOT });
        const twice = transferPrevisPathToActor(once, { source: { kind: "object", id: "hero" }, actorId: "hero", keepHeight: false, cameraId: "cam", cameraMode: "follow", shotDuration: SHOT });
        const camera = cameraOf(twice);
        expect(camera.motionPath).toBeUndefined();
        expect(camera.keyframes.some((key) => isPrevisPathKeyframe(key, "cam"))).toBe(false);
        expect(camera.moves?.map((move) => [move.technique, move.subjectId, move.params?.side])).toEqual([["follow", "hero", "behind"]]);
    });

    test("keep：镜头路径不变，只加注视", () => {
        const scene = setup();
        const next = transferPrevisPathToActor(scene, { source: { kind: "camera", id: "cam" }, actorId: "hero", keepHeight: false, cameraId: "cam", cameraMode: "keep", shotDuration: SHOT });
        expect(cameraOf(next).motionPath).toEqual(cameraOf(scene).motionPath);
        expect(cameraOf(next).moves?.map((move) => move.technique)).toEqual(["look_at"]);
    });

    test("参考轨迹交给人物：按画下的折线走，不超出画的高度；找不到来源时报错", () => {
        const source = resolvePrevisPathSource(setup(), { kind: "sketch", id: "sketch-1" });
        expect(source?.curve).toBe(false);
        const next = transferPrevisPathToActor(setup(), { source: { kind: "sketch", id: "sketch-1" }, actorId: "hero", keepHeight: true, cameraMode: "none", shotDuration: SHOT });
        expect(Math.max(...actorOf(next).keyframes.map((key) => key.lift ?? 0))).toBeLessThanOrEqual(2 + 1e-6);
        expect(() => transferPrevisPathToActor(setup(), { source: { kind: "sketch", id: "missing" }, actorId: "hero", keepHeight: false, cameraMode: "none", shotDuration: SHOT })).toThrow("没有找到这条轨迹");
        expect(() => transferPrevisPathToActor(setup(), { source: { kind: "camera", id: "cam" }, actorId: "ghost", keepHeight: false, cameraMode: "none", shotDuration: SHOT })).toThrow("没有找到这个人物");
    });
});
