import { describe, expect, test } from "bun:test";

import {
    PREVIS_KEYFRAME_EPSILON,
    createPrevisActor,
    createPrevisCamera,
    createPrevisScene,
    interpolatePrevisTransform,
    removePrevisBoneKeyframe,
    removePrevisKeyframe,
    removePrevisSceneKeyframe,
    resolvePrevisKeyframeProgress,
    setPrevisSceneKeyframeEasing,
    upsertPrevisBoneKeyframe,
    upsertPrevisKeyframe,
} from "../src/lib/canvas/previs/previs-scene";
import type { PrevisKeyframe, PrevisQuat, PrevisScene, PrevisTransform } from "../src/types/previs";

const transformAt = (x: number): PrevisTransform => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

function seededKeyframes(): PrevisKeyframe[] {
    let keys: PrevisKeyframe[] = [];
    keys = upsertPrevisKeyframe(keys, 0, transformAt(0));
    keys = upsertPrevisKeyframe(keys, 1, transformAt(10));
    keys = upsertPrevisKeyframe(keys, 2, transformAt(20));
    return keys;
}

describe("删除 transform 关键帧", () => {
    test("按 id 删除只移除目标帧，其余保持有序", () => {
        const keys = seededKeyframes();
        const next = removePrevisKeyframe(keys, keys[1].id);

        expect(next).toHaveLength(2);
        expect(next.map((k) => k.time)).toEqual([0, 2]);
        // 纯函数：不得改写入参。
        expect(keys).toHaveLength(3);
    });

    test("id 不存在时返回原引用，避免无意义重渲染", () => {
        const keys = seededKeyframes();
        expect(removePrevisKeyframe(keys, "missing")).toBe(keys);
    });

    test("删空后得到空数组，插值回落到 base", () => {
        let keys = upsertPrevisKeyframe([], 1, transformAt(5));
        keys = removePrevisKeyframe(keys, keys[0].id);
        expect(keys).toEqual([]);
        expect(interpolatePrevisTransform(transformAt(99), keys, 1).position[0]).toBe(99);
    });

    test("upsert 使用同一容差，记录下的帧一定能按 id 删除", () => {
        // 非整帧时间点最容易出现「记录能覆盖但删不掉」，这里锁住判据一致。
        let keys = upsertPrevisKeyframe([], 0.75, transformAt(3));
        keys = upsertPrevisKeyframe(keys, 0.75 + PREVIS_KEYFRAME_EPSILON / 2, transformAt(4));
        expect(keys).toHaveLength(1);
        expect(removePrevisKeyframe(keys, keys[0].id)).toEqual([]);
    });
});

describe("关键帧缓动", () => {
    test("linear / step / smooth 产生不同且确定的区间进度", () => {
        expect(resolvePrevisKeyframeProgress(0.25, "linear")).toBe(0.25);
        expect(resolvePrevisKeyframeProgress(0.25, "step")).toBe(0);
        expect(resolvePrevisKeyframeProgress(0.25, "smooth")).toBeCloseTo(0.15625, 8);
        expect(resolvePrevisKeyframeProgress(-1, "linear")).toBe(0);
        expect(resolvePrevisKeyframeProgress(2, "linear")).toBe(1);
    });

    test("插值读取前一枚关键帧的 easing，旧数据默认线性", () => {
        const base = seededKeyframes().slice(0, 2);
        expect(interpolatePrevisTransform(transformAt(0), base, 0.25).position[0]).toBeCloseTo(2.5, 8);
        expect(interpolatePrevisTransform(transformAt(0), [{ ...base[0], easing: "step" }, base[1]], 0.25).position[0]).toBe(0);
        expect(interpolatePrevisTransform(transformAt(0), [{ ...base[0], easing: "smooth" }, base[1]], 0.25).position[0]).toBeCloseTo(1.5625, 8);
        expect(interpolatePrevisTransform(transformAt(0), [{ ...base[0], easing: "step" }, base[1]], 1).position[0]).toBe(10);
    });
});

describe("删除骨骼关键帧", () => {
    const rotation: PrevisQuat = [0, 0, 0, 1];

    test("删除后轨道保留其余帧", () => {
        let tracks = upsertPrevisBoneKeyframe([], "hips", 0, rotation);
        tracks = upsertPrevisBoneKeyframe(tracks, "hips", 1, rotation);
        const target = tracks[0].keyframes[0].id;

        const next = removePrevisBoneKeyframe(tracks, "hips", target);
        expect(next).toHaveLength(1);
        expect(next[0].keyframes).toHaveLength(1);
        expect(next[0].keyframes[0].time).toBe(1);
    });

    test("轨道被删空后整条移除，不留空子轨道", () => {
        const tracks = upsertPrevisBoneKeyframe([], "head", 0, rotation);
        const next = removePrevisBoneKeyframe(tracks, "head", tracks[0].keyframes[0].id);
        expect(next).toEqual([]);
    });

    test("骨骼或 id 不存在时返回原引用", () => {
        const tracks = upsertPrevisBoneKeyframe([], "head", 0, rotation);
        expect(removePrevisBoneKeyframe(tracks, "hips", tracks[0].keyframes[0].id)).toBe(tracks);
        expect(removePrevisBoneKeyframe(tracks, "head", "missing")).toBe(tracks);
    });

    test("只影响目标骨骼，其他轨道不动", () => {
        let tracks = upsertPrevisBoneKeyframe([], "hips", 0, rotation);
        tracks = upsertPrevisBoneKeyframe(tracks, "head", 0, rotation);
        const next = removePrevisBoneKeyframe(tracks, "hips", tracks[0].keyframes[0].id);
        expect(next.map((t) => t.bone)).toEqual(["head"]);
    });
});

describe("removePrevisSceneKeyframe：时间轴删除的唯一分派入口", () => {
    const rotation: PrevisQuat = [0, 0, 0, 1];

    /** 一个带对象 transform 帧、骨骼帧和摄影机帧的完整场景。 */
    function seededScene() {
        const base = createPrevisScene("删除测试");
        const actor = {
            ...createPrevisActor("演员 A"),
            keyframes: upsertPrevisKeyframe(upsertPrevisKeyframe([], 0, transformAt(0)), 1, transformAt(10)),
            boneTracks: upsertPrevisBoneKeyframe(upsertPrevisBoneKeyframe([], "hips", 0, rotation), "head", 0.5, rotation),
        };
        const camera = { ...createPrevisCamera("摄影机 A"), keyframes: upsertPrevisKeyframe([], 2, transformAt(5)) };
        const scene: PrevisScene = { ...base, objects: [actor], cameras: [camera] };
        return { scene, actor, camera };
    }

    test("删除对象 transform 帧，只动目标对象", () => {
        const { scene, actor } = seededScene();
        const next = removePrevisSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id });

        expect(next).not.toBe(scene);
        expect(next.objects[0].keyframes.map((key) => key.time)).toEqual([1]);
        // 骨骼轨道和摄影机不受影响，保持原引用。
        expect(next.objects[0].boneTracks).toBe(actor.boneTracks);
        expect(next.cameras).toBe(scene.cameras);
    });

    test("删除骨骼帧，删空的子轨道整条移除", () => {
        const { scene, actor } = seededScene();
        const hips = actor.boneTracks.find((track) => track.bone === "hips");
        const next = removePrevisSceneKeyframe(scene, { track: "object-bone", objectId: actor.id, bone: "hips", keyframeId: hips!.keyframes[0].id });

        expect(next.objects[0].boneTracks?.map((track) => track.bone)).toEqual(["head"]);
        expect(next.objects[0].keyframes).toBe(actor.keyframes);
    });

    test("删除摄影机帧，只动目标摄影机", () => {
        const { scene, camera } = seededScene();
        const next = removePrevisSceneKeyframe(scene, { track: "camera", cameraId: camera.id, keyframeId: camera.keyframes[0].id });

        expect(next.cameras[0].keyframes).toEqual([]);
        expect(next.objects).toBe(scene.objects);
    });

    test("未命中一律返回同一 scene 引用：调用方据此跳过历史与保存", () => {
        const { scene, actor, camera } = seededScene();
        // 对象存在但帧 id 不存在。
        expect(removePrevisSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: "missing" })).toBe(scene);
        // 对象本身不存在。
        expect(removePrevisSceneKeyframe(scene, { track: "object-transform", objectId: "missing", keyframeId: actor.keyframes[0].id })).toBe(scene);
        // 骨骼轨道不存在。
        expect(removePrevisSceneKeyframe(scene, { track: "object-bone", objectId: actor.id, bone: "leftHand", keyframeId: "missing" })).toBe(scene);
        // 摄影机不存在。
        expect(removePrevisSceneKeyframe(scene, { track: "camera", cameraId: "missing", keyframeId: camera.keyframes[0].id })).toBe(scene);
    });

    test("对象没有 boneTracks 时删除骨骼帧不虚构空数组", () => {
        const base = createPrevisScene("无骨骼");
        const object = { ...createPrevisActor("演员 B"), boneTracks: undefined };
        const scene: PrevisScene = { ...base, objects: [object] };
        expect(removePrevisSceneKeyframe(scene, { track: "object-bone", objectId: object.id, bone: "hips", keyframeId: "any" })).toBe(scene);
    });

    test("不改写入参：原 scene 与原数组保持完整", () => {
        const { scene, actor } = seededScene();
        removePrevisSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id });
        expect(scene.objects[0].keyframes).toHaveLength(2);
    });
});

describe("setPrevisSceneKeyframeEasing：按轨道更新且保持纯函数", () => {
    test("对象、骨骼和摄影机三类目标都能独立更新", () => {
        const base = createPrevisScene("缓动测试");
        const actor = {
            ...createPrevisActor("演员"),
            keyframes: upsertPrevisKeyframe([], 0, transformAt(0)),
            boneTracks: upsertPrevisBoneKeyframe([], "hips", 0, [0, 0, 0, 1]),
        };
        const camera = { ...createPrevisCamera("摄影机"), keyframes: upsertPrevisKeyframe([], 0, transformAt(1)) };
        const scene: PrevisScene = { ...base, objects: [actor], cameras: [camera] };

        const objectNext = setPrevisSceneKeyframeEasing(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id }, "smooth");
        expect(objectNext.objects[0].keyframes[0].easing).toBe("smooth");
        expect(objectNext.cameras).toBe(scene.cameras);

        const boneNext = setPrevisSceneKeyframeEasing(scene, { track: "object-bone", objectId: actor.id, bone: "hips", keyframeId: actor.boneTracks[0].keyframes[0].id }, "step");
        expect(boneNext.objects[0].boneTracks?.[0].keyframes[0].easing).toBe("step");

        const cameraNext = setPrevisSceneKeyframeEasing(scene, { track: "camera", cameraId: camera.id, keyframeId: camera.keyframes[0].id }, "linear");
        expect(cameraNext.cameras[0].keyframes[0].easing).toBe("linear");
        expect(scene.objects[0].keyframes[0].easing).toBeUndefined();
    });

    test("目标不存在时返回原 scene 引用", () => {
        const scene = createPrevisScene("missing");
        expect(setPrevisSceneKeyframeEasing(scene, { track: "camera", cameraId: "missing", keyframeId: "missing" }, "smooth")).toBe(scene);
    });
});
