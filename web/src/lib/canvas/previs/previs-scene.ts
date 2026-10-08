import { nanoid } from "nanoid";
import { Color, Euler, Quaternion } from "three";

import type { PrevisActorArchetype, PrevisActorProfile, PrevisAspectRatio, PrevisBoneKeyframe, PrevisBoneTrack, PrevisCamera, PrevisHumanoidBone, PrevisKeyframe, PrevisKeyframeDeleteTarget, PrevisKeyframeEasing, PrevisLight, PrevisObject, PrevisPose, PrevisQuat, PrevisScene, PrevisTransform, PrevisVec3 } from "@/types/previs";

export const PREVIS_DEFAULT_ACTOR_URL = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/Xbot.glb";
export const PREVIS_LEGACY_DEFAULT_ACTOR_COLOR = "#f1f3f5";
export const PREVIS_ACTOR_COLORS = [
    "#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#e879f9",
    "#f97316", "#06b6d4", "#84cc16", "#ec4899", "#a78bfa", "#fb7185",
    "#22d3ee", "#4ade80", "#facc15", "#f472b6", "#818cf8", "#34d399",
] as const;

export const PREVIS_ACTOR_ARCHETYPES = [
    { value: "adult", label: "大人" },
    { value: "child", label: "小孩" },
    { value: "elderly", label: "老人" },
    { value: "man", label: "男人" },
    { value: "woman", label: "女人" },
    { value: "monster", label: "怪兽" },
] as const;

export function previsActorProfileForArchetype(archetype: PrevisActorArchetype = "adult"): PrevisActorProfile {
    switch (archetype) {
        case "child": return { height: 0.72, headRatio: 1.28, shoulderWidth: 0.78, torsoRatio: 0.82, accessory: "none" };
        case "elderly": return { height: 0.92, headRatio: 1.04, shoulderWidth: 0.9, torsoRatio: 1, accessory: "cane" };
        case "man": return { height: 1.04, headRatio: 0.94, shoulderWidth: 1.16, torsoRatio: 1, accessory: "none" };
        case "woman": return { height: 1, headRatio: 1, shoulderWidth: 0.86, torsoRatio: 1.02, accessory: "none" };
        case "monster": return { height: 1.12, headRatio: 1.18, shoulderWidth: 1.34, torsoRatio: 1.08, accessory: "horns" };
        default: return { height: 1, headRatio: 1, shoulderWidth: 1, torsoRatio: 1, accessory: "none" };
    }
}

export function previsActorArchetypeLabel(archetype?: PrevisObject["archetype"]) {
    return PREVIS_ACTOR_ARCHETYPES.find((item) => item.value === archetype)?.label || "大人";
}

export function resolvePrevisActorColor(color?: string) {
    const normalized = color?.trim().toLowerCase();
    return !normalized || normalized === PREVIS_LEGACY_DEFAULT_ACTOR_COLOR ? PREVIS_ACTOR_COLORS[0] : color!;
}

export const previsIdentityTransform = (position: PrevisVec3 = [0, 0, 0]): PrevisTransform => ({ position, rotation: [0, 0, 0], scale: [1, 1, 1] });

export function createPrevisScene(title = "未命名场景"): PrevisScene {
    const now = new Date().toISOString();
    const camera = createPrevisCamera();
    const shotId = nanoid();
    return {
        id: nanoid(),
        version: 1,
        title,
        background: "#d8dde3",
        environmentIntensity: 0.7,
        environment: { mode: "color" },
        gridVisible: true,
        objects: [createPrevisActor("演员 1", [0, 0, 0])],
        cameras: [camera],
        lights: [createPrevisLight("directional", "主光", [4, 6, 4], 2.4), createPrevisLight("directional", "轮廓光", [-4, 3, -2], 1.1), createPrevisLight("ambient", "环境光", [0, 0, 0], 0.65)],
        shots: [{ id: shotId, name: "镜头 1", cameraId: camera.id, duration: 5, fps: 24, aspectRatio: "9:16", shotSize: "medium", cameraMove: "static", prompt: "" }],
        activeShotId: shotId,
        createdAt: now,
        updatedAt: now,
    };
}

export function createPrevisObject(primitive: PrevisObject["primitive"] = "box", name = "新对象", position: PrevisVec3 = [0, 0.5, 0], color = "#8795a5"): PrevisObject {
    return {
        id: nanoid(),
        name,
        kind: "primitive",
        primitive,
        transform: previsIdentityTransform(position),
        color,
        visible: true,
        castShadow: true,
        receiveShadow: true,
        pose: primitive === "character" ? "stand" : undefined,
        keyframes: [],
        motionPath: undefined,
    };
}

export function createPrevisActor(name = "演员", position: PrevisVec3 = [0, 0, 0], color: string = PREVIS_ACTOR_COLORS[0], archetype: PrevisObject["archetype"] = "adult"): PrevisObject {
    return {
        ...createPrevisObject("box", name, position, color),
        kind: "actor",
        primitive: undefined,
        url: PREVIS_DEFAULT_ACTOR_URL,
        mimeType: "model/gltf-binary",
        pose: "stand",
        archetype,
        actorProfile: previsActorProfileForArchetype(archetype),
        rig: { status: "unmapped", boneMap: {}, animationNames: [] },
        motionClips: [],
        boneOverrides: {},
        boneTracks: [],
    };
}

export function createPrevisModel(input: Pick<PrevisObject, "name" | "storageKey" | "url" | "mimeType" | "assetId">): PrevisObject {
    return { ...createPrevisObject("box", input.name, [0, 0, 0]), ...input, kind: "model", primitive: undefined };
}

export function createPrevisBillboard(name: string, url: string, storageKey?: string, sourceNodeId?: string): PrevisObject {
    return { ...createPrevisObject("plane", name, [0, 1.1, 0], "#ffffff"), kind: "billboard", url, storageKey, sourceNodeId, transform: { position: [0, 1.1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
}

export function createPrevisCamera(name = "主摄影机"): PrevisCamera {
    return { id: nanoid(), name, transform: previsIdentityTransform([4.8, 2.7, 6.8]), target: [0, 1, 0], focalLength: 35, fov: 50, aperture: 2.8, focusDistance: 5, near: 0.05, far: 500, keyframes: [], motionPath: undefined };
}

export function resolvePrevisAspectRatio(value?: PrevisAspectRatio) {
    if (value === "16:9") return 16 / 9;
    if (value === "2.39:1") return 2.39;
    return 9 / 16;
}

export function uniquePrevisName(existing: readonly string[], requested: string) {
    const base = requested.trim() || "对象";
    if (!existing.includes(base)) return base;
    let index = 2;
    while (existing.includes(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
}

/** 35mm 全画幅水平视角换算。摄影机检查器与场景模板共用，避免两处各写一份光学。 */
export function previsFocalLengthToFov(focalLength: number) {
    return (2 * Math.atan(36 / (2 * Math.max(1, focalLength))) * 180) / Math.PI;
}

export function createPrevisLight(type: PrevisLight["type"], name: string, position: PrevisVec3, intensity = 1): PrevisLight {
    return { id: nanoid(), name, type, transform: previsIdentityTransform(position), color: "#ffffff", intensity, angle: Math.PI / 4, penumbra: 0.35, castShadow: type !== "ambient" };
}

export function touchPrevisScene(scene: PrevisScene): PrevisScene {
    return { ...scene, updatedAt: new Date().toISOString() };
}

/** 关键帧命中容差：upsert 与 remove 必须同判据，否则会出现「记录能覆盖但删不掉」。 */
export const PREVIS_KEYFRAME_EPSILON = 0.001;

export function upsertPrevisKeyframe(keyframes: PrevisKeyframe[], time: number, transform: PrevisTransform) {
    const current = keyframes.find((item) => Math.abs(item.time - time) < PREVIS_KEYFRAME_EPSILON);
    const next = current ? keyframes.map((item) => (item.id === current.id ? { ...item, transform } : item)) : [...keyframes, { id: nanoid(), time, transform }];
    return next.toSorted((a, b) => a.time - b.time);
}

export function upsertPrevisBoneKeyframe(tracks: PrevisBoneTrack[], bone: PrevisHumanoidBone, time: number, rotation: PrevisQuat) {
    const track = tracks.find((item) => item.bone === bone);
    const nextKeyframes = upsertBoneKeyframe(track?.keyframes || [], time, rotation);
    return track ? tracks.map((item) => item.bone === bone ? { ...item, keyframes: nextKeyframes } : item) : [...tracks, { bone, keyframes: nextKeyframes }];
}

function upsertBoneKeyframe(keyframes: PrevisBoneKeyframe[], time: number, rotation: PrevisQuat) {
    const current = keyframes.find((item) => Math.abs(item.time - time) < PREVIS_KEYFRAME_EPSILON);
    const next = current ? keyframes.map((item) => item.id === current.id ? { ...item, rotation } : item) : [...keyframes, { id: nanoid(), time, rotation }];
    return next.toSorted((a, b) => a.time - b.time);
}

/** 按 id 删除对象 transform 关键帧；id 不存在时返回原数组引用。 */
export function removePrevisKeyframe(keyframes: PrevisKeyframe[], keyframeId: string): PrevisKeyframe[] {
    if (!keyframes.some((item) => item.id === keyframeId)) return keyframes;
    return keyframes.filter((item) => item.id !== keyframeId);
}

/**
 * 按 id 删除某骨骼轨道上的关键帧。
 * 轨道被删空后整条移除，否则时间轴会留下永远为空的子轨道。
 */
export function removePrevisBoneKeyframe(tracks: PrevisBoneTrack[], bone: PrevisHumanoidBone, keyframeId: string): PrevisBoneTrack[] {
    const track = tracks.find((item) => item.bone === bone);
    if (!track?.keyframes.some((item) => item.id === keyframeId)) return tracks;

    const nextKeyframes = track.keyframes.filter((item) => item.id !== keyframeId);
    if (!nextKeyframes.length) return tracks.filter((item) => item.bone !== bone);
    return tracks.map((item) => (item.bone === bone ? { ...item, keyframes: nextKeyframes } : item));
}

/**
 * 时间轴删除关键帧的唯一入口：按轨道类型分派到对应领域函数。
 *
 * 未命中（对象/摄影机/骨骼/关键帧任一不存在）时返回同一个 scene 引用，
 * 调用方据此跳过历史与保存，避免「点了没删掉却多一次修订」。
 */
export function removePrevisSceneKeyframe(scene: PrevisScene, target: PrevisKeyframeDeleteTarget): PrevisScene {
    if (target.track === "camera") {
        const camera = scene.cameras.find((item) => item.id === target.cameraId);
        if (!camera) return scene;
        const keyframes = removePrevisKeyframe(camera.keyframes, target.keyframeId);
        if (keyframes === camera.keyframes) return scene;
        return { ...scene, cameras: scene.cameras.map((item) => (item.id === camera.id ? { ...item, keyframes } : item)) };
    }

    const object = scene.objects.find((item) => item.id === target.objectId);
    if (!object) return scene;

    if (target.track === "object-transform") {
        const keyframes = removePrevisKeyframe(object.keyframes, target.keyframeId);
        if (keyframes === object.keyframes) return scene;
        return { ...scene, objects: scene.objects.map((item) => (item.id === object.id ? { ...item, keyframes } : item)) };
    }

    const tracks = object.boneTracks || [];
    const boneTracks = removePrevisBoneKeyframe(tracks, target.bone, target.keyframeId);
    if (boneTracks === tracks) return scene;
    return { ...scene, objects: scene.objects.map((item) => (item.id === object.id ? { ...item, boneTracks } : item)) };
}

/**
 * 更新一枚关键帧后续区间的缓动。未命中时返回原 scene 引用，调用方据此跳过历史与保存。
 */
export function setPrevisSceneKeyframeEasing(scene: PrevisScene, target: PrevisKeyframeDeleteTarget, easing: PrevisKeyframeEasing): PrevisScene {
    const update = <T extends { id: string; easing?: PrevisKeyframeEasing }>(keyframes: T[]) => {
        if (!keyframes.some((item) => item.id === target.keyframeId)) return keyframes;
        return keyframes.map((item) => item.id === target.keyframeId ? { ...item, easing } : item);
    };

    if (target.track === "camera") {
        const camera = scene.cameras.find((item) => item.id === target.cameraId);
        if (!camera) return scene;
        const keyframes = update(camera.keyframes);
        if (keyframes === camera.keyframes) return scene;
        return { ...scene, cameras: scene.cameras.map((item) => item.id === camera.id ? { ...item, keyframes } : item) };
    }

    const object = scene.objects.find((item) => item.id === target.objectId);
    if (!object) return scene;
    if (target.track === "object-transform") {
        const keyframes = update(object.keyframes);
        if (keyframes === object.keyframes) return scene;
        return { ...scene, objects: scene.objects.map((item) => item.id === object.id ? { ...item, keyframes } : item) };
    }

    const tracks = object.boneTracks || [];
    const track = tracks.find((item) => item.bone === target.bone);
    if (!track) return scene;
    const keyframes = update(track.keyframes);
    if (keyframes === track.keyframes) return scene;
    const boneTracks = tracks.map((item) => item.bone === target.bone ? { ...item, keyframes } : item);
    return { ...scene, objects: scene.objects.map((item) => item.id === object.id ? { ...item, boneTracks } : item) };
}

/** 缓动属于前一枚关键帧到下一枚关键帧的区间。旧数据未声明时保持线性。 */
export function resolvePrevisKeyframeProgress(progress: number, easing: PrevisKeyframeEasing = "linear") {
    const clamped = Math.max(0, Math.min(1, progress));
    if (easing === "step") return 0;
    if (easing === "smooth") return clamped * clamped * (3 - 2 * clamped);
    return clamped;
}

/** 轨迹渲染只接受有限时间与位置；坏数据不得进入 Three 几何体。 */
export function finitePrevisTransformKeyframes(keyframes: PrevisKeyframe[]) {
    return keyframes.filter((keyframe) => [keyframe.time, ...keyframe.transform.position].every(Number.isFinite));
}

/** 按时间顺序累计 Transform 关键帧路径长度；非法时间或坐标段忽略，不污染界面统计。 */
export function previsTransformPathLength(keyframes: PrevisKeyframe[]) {
    const sorted = keyframes.toSorted((left, right) => left.time - right.time);
    let length = 0;
    for (let index = 1; index < sorted.length; index += 1) {
        const previousTime = sorted[index - 1].time;
        const currentTime = sorted[index].time;
        const previous = sorted[index - 1].transform.position;
        const current = sorted[index].transform.position;
        if (![previousTime, currentTime, ...previous, ...current].every(Number.isFinite)) continue;
        length += Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]);
    }
    return length;
}

export function interpolatePrevisTransform(base: PrevisTransform, keyframes: PrevisKeyframe[], time: number): PrevisTransform {
    if (!keyframes.length) return base;
    const previous = [...keyframes].reverse().find((item) => item.time <= time) || keyframes[0];
    const next = keyframes.find((item) => item.time >= time) || keyframes[keyframes.length - 1];
    if (previous.id === next.id) return previous.transform;
    const progress = resolvePrevisKeyframeProgress((time - previous.time) / Math.max(next.time - previous.time, PREVIS_KEYFRAME_EPSILON), previous.easing);
    const rotation = new Quaternion().setFromEuler(new Euler(...previous.transform.rotation)).slerp(new Quaternion().setFromEuler(new Euler(...next.transform.rotation)), progress);
    return {
        position: lerpVec3(previous.transform.position, next.transform.position, progress),
        rotation: new Euler().setFromQuaternion(rotation).toArray().slice(0, 3) as PrevisVec3,
        scale: lerpVec3(previous.transform.scale, next.transform.scale, progress),
    };
}

export function interpolatePrevisBoneRotation(base: PrevisQuat, keyframes: PrevisBoneKeyframe[], time: number): PrevisQuat {
    if (!keyframes.length) return base;
    const previous = [...keyframes].reverse().find((item) => item.time <= time) || keyframes[0];
    const next = keyframes.find((item) => item.time >= time) || keyframes[keyframes.length - 1];
    if (previous.id === next.id) return previous.rotation;
    const progress = resolvePrevisKeyframeProgress((time - previous.time) / Math.max(next.time - previous.time, PREVIS_KEYFRAME_EPSILON), previous.easing);
    return new Quaternion(...previous.rotation).slerp(new Quaternion(...next.rotation), progress).toArray() as PrevisQuat;
}

export function previsBoneLabel(bone: string) {
    return ({
        hips: "骨盆", spine: "脊柱", chest: "胸腔", neck: "颈部", head: "头部",
        leftShoulder: "左肩", leftUpperArm: "左上臂", leftLowerArm: "左前臂", leftHand: "左手",
        rightShoulder: "右肩", rightUpperArm: "右上臂", rightLowerArm: "右前臂", rightHand: "右手",
        leftUpperLeg: "左大腿", leftLowerLeg: "左小腿", leftFoot: "左脚",
        rightUpperLeg: "右大腿", rightLowerLeg: "右小腿", rightFoot: "右脚",
        leftThumb1: "左拇指·根", leftThumb2: "左拇指·中", leftThumb3: "左拇指·尖",
        leftIndex1: "左食指·根", leftIndex2: "左食指·中", leftIndex3: "左食指·尖",
        leftMiddle1: "左中指·根", leftMiddle2: "左中指·中", leftMiddle3: "左中指·尖",
        leftRing1: "左无名指·根", leftRing2: "左无名指·中", leftRing3: "左无名指·尖",
        leftPinky1: "左小指·根", leftPinky2: "左小指·中", leftPinky3: "左小指·尖",
        rightThumb1: "右拇指·根", rightThumb2: "右拇指·中", rightThumb3: "右拇指·尖",
        rightIndex1: "右食指·根", rightIndex2: "右食指·中", rightIndex3: "右食指·尖",
        rightMiddle1: "右中指·根", rightMiddle2: "右中指·中", rightMiddle3: "右中指·尖",
        rightRing1: "右无名指·根", rightRing2: "右无名指·中", rightRing3: "右无名指·尖",
        rightPinky1: "右小指·根", rightPinky2: "右小指·中", rightPinky3: "右小指·尖",
    } as Record<string, string>)[bone] || bone;
}

export function previsPoseLabel(pose: PrevisPose) {
    return ({ neutral: "自然", stand: "站立", t_pose: "T 型", walk: "行走", run: "跑步", sit: "坐姿", squat: "蹲下", kneel_single: "单膝跪", kneel_double: "双膝跪", hands_hips: "叉腰", lean: "倚靠", bow: "鞠躬", think: "思考", fight: "格斗", kick: "踢球", throw: "投掷", push: "推进", wave: "招手", reach: "伸手", arms_crossed: "抱臂", phone: "看手机" } as Record<PrevisPose, string>)[pose];
}

export function previsPoseBoneDeltas(pose: PrevisPose): Partial<Record<PrevisHumanoidBone, PrevisQuat>> {
    // Soldier 的左右上臂局部 Z 轴方向一致，正向旋转才会把两侧手臂从 T Pose 放下。
    const armsDown = { leftUpperArm: poseQuaternion(0, 0, 1.28), rightUpperArm: poseQuaternion(0, 0, 1.28) };
    const poses: Record<PrevisPose, Partial<Record<PrevisHumanoidBone, PrevisQuat>>> = {
        neutral: armsDown,
        stand: armsDown,
        t_pose: {},
        walk: { ...armsDown, leftUpperArm: poseQuaternion(0.36, 0, 1.2), rightUpperArm: poseQuaternion(-0.36, 0, 1.2), leftUpperLeg: poseQuaternion(-0.32, 0, 0), rightUpperLeg: poseQuaternion(0.32, 0, 0) },
        run: { ...armsDown, leftUpperArm: poseQuaternion(0.75, 0, 1.05), rightUpperArm: poseQuaternion(-0.75, 0, 1.05), leftLowerArm: poseQuaternion(-0.7, 0, 0), rightLowerArm: poseQuaternion(-0.7, 0, 0), leftUpperLeg: poseQuaternion(-0.65, 0, 0), rightUpperLeg: poseQuaternion(0.55, 0, 0), rightLowerLeg: poseQuaternion(0.8, 0, 0) },
        sit: { ...armsDown, leftUpperLeg: poseQuaternion(-1.35, 0, 0), rightUpperLeg: poseQuaternion(-1.35, 0, 0), leftLowerLeg: poseQuaternion(1.25, 0, 0), rightLowerLeg: poseQuaternion(1.25, 0, 0) },
        squat: { ...armsDown, hips: poseQuaternion(0.25, 0, 0), leftUpperLeg: poseQuaternion(-0.75, 0, 0), rightUpperLeg: poseQuaternion(-0.75, 0, 0), leftLowerLeg: poseQuaternion(1.2, 0, 0), rightLowerLeg: poseQuaternion(1.2, 0, 0) },
        kneel_single: { ...armsDown, leftUpperLeg: poseQuaternion(-0.95, 0, 0), leftLowerLeg: poseQuaternion(1.45, 0, 0), rightUpperLeg: poseQuaternion(-0.35, 0, 0), rightLowerLeg: poseQuaternion(0.75, 0, 0) },
        kneel_double: { ...armsDown, leftUpperLeg: poseQuaternion(-0.55, 0, 0), rightUpperLeg: poseQuaternion(-0.55, 0, 0), leftLowerLeg: poseQuaternion(1.45, 0, 0), rightLowerLeg: poseQuaternion(1.45, 0, 0) },
        hands_hips: { leftUpperArm: poseQuaternion(0, 0, 0.75), rightUpperArm: poseQuaternion(0, 0, 0.75), leftLowerArm: poseQuaternion(-0.1, 0.2, -1.5), rightLowerArm: poseQuaternion(-0.1, -0.2, 1.5) },
        lean: { ...armsDown, hips: poseQuaternion(0, 0, 0.18), spine: poseQuaternion(0, 0, -0.12), head: poseQuaternion(0, 0, -0.08) },
        bow: { ...armsDown, hips: poseQuaternion(0.5, 0, 0), spine: poseQuaternion(0.28, 0, 0), head: poseQuaternion(-0.18, 0, 0) },
        think: { ...armsDown, rightUpperArm: poseQuaternion(-0.25, 0, 0.55), rightLowerArm: poseQuaternion(-1.35, 0, 0.3), head: poseQuaternion(0.05, -0.22, 0) },
        fight: { leftUpperArm: poseQuaternion(-0.65, 0, 0.7), rightUpperArm: poseQuaternion(-0.55, 0, 0.65), leftLowerArm: poseQuaternion(-1.2, 0, 0), rightLowerArm: poseQuaternion(-1.25, 0, 0), chest: poseQuaternion(0, 0.2, 0), leftUpperLeg: poseQuaternion(-0.15, 0, 0), rightUpperLeg: poseQuaternion(0.2, 0, 0) },
        kick: { ...armsDown, leftUpperArm: poseQuaternion(0.3, 0, 1.1), rightUpperArm: poseQuaternion(-0.3, 0, 1.1), rightUpperLeg: poseQuaternion(-1.1, 0, 0), rightLowerLeg: poseQuaternion(0.35, 0, 0) },
        throw: { leftUpperArm: poseQuaternion(-0.35, 0.2, 0.35), rightUpperArm: poseQuaternion(-1.2, 0, 0.25), rightLowerArm: poseQuaternion(-1.05, 0, 0), chest: poseQuaternion(0, -0.3, 0) },
        push: { leftUpperArm: poseQuaternion(-0.9, 0, 0.3), rightUpperArm: poseQuaternion(-0.9, 0, 0.3), leftLowerArm: poseQuaternion(-0.35, 0, 0), rightLowerArm: poseQuaternion(-0.35, 0, 0), chest: poseQuaternion(0.15, 0, 0) },
        wave: { ...armsDown, rightUpperArm: poseQuaternion(0, 0, -0.35), rightLowerArm: poseQuaternion(0, 0, -1.45), rightHand: poseQuaternion(0, 0, -0.3) },
        reach: { ...armsDown, rightUpperArm: poseQuaternion(-1.35, 0, -0.05), rightLowerArm: poseQuaternion(-0.1, 0, 0) },
        arms_crossed: { leftUpperArm: poseQuaternion(-0.65, 0, 0.65), rightUpperArm: poseQuaternion(-0.65, 0, 0.65), leftLowerArm: poseQuaternion(-1.2, 0.15, -0.4), rightLowerArm: poseQuaternion(-1.2, -0.15, 0.4) },
        phone: { ...armsDown, leftUpperArm: poseQuaternion(-0.45, 0, 0.95), rightUpperArm: poseQuaternion(-0.45, 0, 0.95), leftLowerArm: poseQuaternion(-1.1, 0, 0.15), rightLowerArm: poseQuaternion(-1.1, 0, -0.15), head: poseQuaternion(0.28, 0, 0) },
    };
    return poses[pose];
}

export function previsColorLabel(value: string) {
    const hsl = { h: 0, s: 0, l: 0 };
    new Color(value).getHSL(hsl);
    if (hsl.l >= 0.86 && hsl.s <= 0.2) return "白色";
    if (hsl.l <= 0.18) return "黑色";
    if (hsl.s <= 0.16) return hsl.l >= 0.52 ? "浅灰色" : "深灰色";
    const hue = hsl.h * 360;
    if (hue < 18 || hue >= 345) return "红色";
    if (hue < 48) return "橙色";
    if (hue < 72) return "黄色";
    if (hue < 165) return "绿色";
    if (hue < 195) return "青色";
    if (hue < 255) return "蓝色";
    if (hue < 290) return "紫色";
    return "粉色";
}

function poseQuaternion(x: number, y: number, z: number): PrevisQuat {
    return new Quaternion().setFromEuler(new Euler(x, y, z)).toArray() as PrevisQuat;
}

function lerpVec3(from: PrevisVec3, to: PrevisVec3, progress: number): PrevisVec3 {
    return from.map((value, index) => value + (to[index] - value) * progress) as PrevisVec3;
}
