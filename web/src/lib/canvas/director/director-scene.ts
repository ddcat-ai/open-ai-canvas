import { nanoid } from "nanoid";
import { Color, Euler, Quaternion } from "three";

import type { DirectorBoneKeyframe, DirectorBoneTrack, DirectorCamera, DirectorHumanoidBone, DirectorKeyframe, DirectorLight, DirectorObject, DirectorPose, DirectorQuat, DirectorScene, DirectorTransform, DirectorVec3 } from "@/types/director";

export const DIRECTOR_DEFAULT_ACTOR_URL = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/Xbot.glb";
export const DIRECTOR_ACTOR_COLORS = ["#f1f3f5", "#202329", "#2f7de1", "#d84949", "#dfae3f", "#34a276"] as const;

export const directorIdentityTransform = (position: DirectorVec3 = [0, 0, 0]): DirectorTransform => ({ position, rotation: [0, 0, 0], scale: [1, 1, 1] });

export function createDirectorScene(title = "未命名场景"): DirectorScene {
    const now = new Date().toISOString();
    const camera = createDirectorCamera();
    const shotId = nanoid();
    return {
        id: nanoid(),
        version: 1,
        title,
        background: "#d8dde3",
        environmentIntensity: 0.7,
        gridVisible: true,
        objects: [createDirectorActor("演员 1", [0, 0, 0])],
        cameras: [camera],
        lights: [createDirectorLight("directional", "主光", [4, 6, 4], 2.4), createDirectorLight("directional", "轮廓光", [-4, 3, -2], 1.1), createDirectorLight("ambient", "环境光", [0, 0, 0], 0.65)],
        shots: [{ id: shotId, name: "镜头 1", cameraId: camera.id, duration: 5, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" }],
        activeShotId: shotId,
        createdAt: now,
        updatedAt: now,
    };
}

export function createDirectorObject(primitive: DirectorObject["primitive"] = "box", name = "新对象", position: DirectorVec3 = [0, 0.5, 0], color = "#8795a5"): DirectorObject {
    return {
        id: nanoid(),
        name,
        kind: "primitive",
        primitive,
        transform: directorIdentityTransform(position),
        color,
        visible: true,
        castShadow: true,
        receiveShadow: true,
        pose: primitive === "character" ? "stand" : undefined,
        keyframes: [],
    };
}

export function createDirectorActor(name = "演员", position: DirectorVec3 = [0, 0, 0], color: string = DIRECTOR_ACTOR_COLORS[0]): DirectorObject {
    return {
        ...createDirectorObject("box", name, position, color),
        kind: "actor",
        primitive: undefined,
        url: DIRECTOR_DEFAULT_ACTOR_URL,
        mimeType: "model/gltf-binary",
        pose: "stand",
        rig: { status: "unmapped", boneMap: {}, animationNames: [] },
        motionClips: [],
        boneOverrides: {},
        boneTracks: [],
    };
}

export function createDirectorModel(input: Pick<DirectorObject, "name" | "storageKey" | "url" | "mimeType" | "assetId">): DirectorObject {
    return { ...createDirectorObject("box", input.name, [0, 0, 0]), ...input, kind: "model", primitive: undefined };
}

export function createDirectorBillboard(name: string, url: string, storageKey?: string, sourceNodeId?: string): DirectorObject {
    return { ...createDirectorObject("plane", name, [0, 1.1, 0], "#ffffff"), kind: "billboard", url, storageKey, sourceNodeId, transform: { position: [0, 1.1, 0], rotation: [0, 0, 0], scale: [1.6, 0.9, 1] } };
}

export function createDirectorCamera(name = "主摄影机"): DirectorCamera {
    return { id: nanoid(), name, transform: directorIdentityTransform([4.8, 2.7, 6.8]), target: [0, 1, 0], focalLength: 35, fov: 50, aperture: 2.8, focusDistance: 5, near: 0.05, far: 500, keyframes: [] };
}

export function createDirectorLight(type: DirectorLight["type"], name: string, position: DirectorVec3, intensity = 1): DirectorLight {
    return { id: nanoid(), name, type, transform: directorIdentityTransform(position), color: "#ffffff", intensity, angle: Math.PI / 4, penumbra: 0.35, castShadow: type !== "ambient" };
}

export function touchDirectorScene(scene: DirectorScene): DirectorScene {
    return { ...scene, updatedAt: new Date().toISOString() };
}

export function upsertDirectorKeyframe(keyframes: DirectorKeyframe[], time: number, transform: DirectorTransform) {
    const current = keyframes.find((item) => Math.abs(item.time - time) < 0.001);
    const next = current ? keyframes.map((item) => (item.id === current.id ? { ...item, transform } : item)) : [...keyframes, { id: nanoid(), time, transform }];
    return next.toSorted((a, b) => a.time - b.time);
}

export function upsertDirectorBoneKeyframe(tracks: DirectorBoneTrack[], bone: DirectorHumanoidBone, time: number, rotation: DirectorQuat) {
    const track = tracks.find((item) => item.bone === bone);
    const nextKeyframes = upsertBoneKeyframe(track?.keyframes || [], time, rotation);
    return track ? tracks.map((item) => item.bone === bone ? { ...item, keyframes: nextKeyframes } : item) : [...tracks, { bone, keyframes: nextKeyframes }];
}

function upsertBoneKeyframe(keyframes: DirectorBoneKeyframe[], time: number, rotation: DirectorQuat) {
    const current = keyframes.find((item) => Math.abs(item.time - time) < 0.001);
    const next = current ? keyframes.map((item) => item.id === current.id ? { ...item, rotation } : item) : [...keyframes, { id: nanoid(), time, rotation }];
    return next.toSorted((a, b) => a.time - b.time);
}

export function interpolateDirectorTransform(base: DirectorTransform, keyframes: DirectorKeyframe[], time: number): DirectorTransform {
    if (!keyframes.length) return base;
    const previous = [...keyframes].reverse().find((item) => item.time <= time) || keyframes[0];
    const next = keyframes.find((item) => item.time >= time) || keyframes[keyframes.length - 1];
    if (previous.id === next.id) return previous.transform;
    const progress = Math.max(0, Math.min(1, (time - previous.time) / Math.max(next.time - previous.time, 0.001)));
    const rotation = new Quaternion().setFromEuler(new Euler(...previous.transform.rotation)).slerp(new Quaternion().setFromEuler(new Euler(...next.transform.rotation)), progress);
    return {
        position: lerpVec3(previous.transform.position, next.transform.position, progress),
        rotation: new Euler().setFromQuaternion(rotation).toArray().slice(0, 3) as DirectorVec3,
        scale: lerpVec3(previous.transform.scale, next.transform.scale, progress),
    };
}

export function interpolateDirectorBoneRotation(base: DirectorQuat, keyframes: DirectorBoneKeyframe[], time: number): DirectorQuat {
    if (!keyframes.length) return base;
    const previous = [...keyframes].reverse().find((item) => item.time <= time) || keyframes[0];
    const next = keyframes.find((item) => item.time >= time) || keyframes[keyframes.length - 1];
    if (previous.id === next.id) return previous.rotation;
    const progress = Math.max(0, Math.min(1, (time - previous.time) / Math.max(next.time - previous.time, 0.001)));
    return new Quaternion(...previous.rotation).slerp(new Quaternion(...next.rotation), progress).toArray() as DirectorQuat;
}

export function directorBoneLabel(bone: string) {
    return ({ hips: "骨盆", spine: "脊柱", chest: "胸腔", neck: "颈部", head: "头部", leftShoulder: "左肩", leftUpperArm: "左上臂", leftLowerArm: "左前臂", leftHand: "左手", rightShoulder: "右肩", rightUpperArm: "右上臂", rightLowerArm: "右前臂", rightHand: "右手", leftUpperLeg: "左大腿", leftLowerLeg: "左小腿", leftFoot: "左脚", rightUpperLeg: "右大腿", rightLowerLeg: "右小腿", rightFoot: "右脚" } as Record<string, string>)[bone] || bone;
}

export function directorPoseLabel(pose: DirectorPose) {
    return ({ neutral: "自然", stand: "站立", t_pose: "T 型", walk: "行走", run: "跑步", sit: "坐姿", squat: "蹲下", kneel_single: "单膝跪", kneel_double: "双膝跪", hands_hips: "叉腰", lean: "倚靠", bow: "鞠躬", think: "思考", fight: "格斗", kick: "踢球", throw: "投掷", push: "推进", wave: "招手", reach: "伸手", arms_crossed: "抱臂", phone: "看手机" } as Record<DirectorPose, string>)[pose];
}

export function directorPoseBoneDeltas(pose: DirectorPose): Partial<Record<DirectorHumanoidBone, DirectorQuat>> {
    // Soldier 的左右上臂局部 Z 轴方向一致，正向旋转才会把两侧手臂从 T Pose 放下。
    const armsDown = { leftUpperArm: poseQuaternion(0, 0, 1.28), rightUpperArm: poseQuaternion(0, 0, 1.28) };
    const poses: Record<DirectorPose, Partial<Record<DirectorHumanoidBone, DirectorQuat>>> = {
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

export function directorColorLabel(value: string) {
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

function poseQuaternion(x: number, y: number, z: number): DirectorQuat {
    return new Quaternion().setFromEuler(new Euler(x, y, z)).toArray() as DirectorQuat;
}

function lerpVec3(from: DirectorVec3, to: DirectorVec3, progress: number): DirectorVec3 {
    return from.map((value, index) => value + (to[index] - value) * progress) as DirectorVec3;
}
