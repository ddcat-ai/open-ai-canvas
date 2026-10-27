import { nanoid } from "nanoid";

import { interpolatePrevisTransform } from "@/lib/canvas/previs/previs-scene";
import type { PrevisActorTravel, PrevisKeyframe, PrevisKeyframeEasing, PrevisObject, PrevisTravelStyle, PrevisVec3 } from "@/types/previs";

/**
 * A→B 位移：位置写成 transform 关键帧（始终贴地，地面拖动与落地规则不受影响），
 * 姿态与离地高度由 travel 段在求值时叠加：飞行俯身、御剑脚下出剑、悬浮缓慢起伏、跳跃按路程分段起落、闪现瞬移。
 * 后端 cloud_agent_previs_travel.go 用同一套关键帧规则写入，两边改动需同步。
 */
export type PrevisTravelStyleInfo = { value: PrevisTravelStyle; label: string; verb: string; easing: PrevisKeyframeEasing; height: number; speed: number };

export const PREVIS_TRAVEL_STYLES: PrevisTravelStyleInfo[] = [
    { value: "walk", label: "走路", verb: "走到", easing: "linear", height: 0, speed: 1.4 },
    { value: "run", label: "跑步", verb: "跑到", easing: "linear", height: 0, speed: 3.6 },
    { value: "dash", label: "冲刺", verb: "冲刺到", easing: "linear", height: 0, speed: 6.5 },
    { value: "jump", label: "跳跃", verb: "连跳到", easing: "linear", height: 0.7, speed: 3 },
    { value: "fly", label: "飞行", verb: "飞到", easing: "smooth", height: 3, speed: 8 },
    { value: "sword_fly", label: "御剑", verb: "御剑飞到", easing: "smooth", height: 2.5, speed: 9 },
    { value: "float", label: "悬浮", verb: "飘到", easing: "smooth", height: 1, speed: 1.6 },
    { value: "teleport", label: "闪现", verb: "闪现到", easing: "step", height: 0, speed: 0 },
];

export function resolvePrevisTravelStyle(style?: string): PrevisTravelStyleInfo {
    return PREVIS_TRAVEL_STYLES.find((item) => item.value === style) ?? PREVIS_TRAVEL_STYLES[0];
}

/** 起点：给定时刻演员所在位置（考虑已有关键帧）。 */
export function previsActorPositionAt(object: Pick<PrevisObject, "transform" | "keyframes">, time: number): PrevisVec3 {
    return interpolatePrevisTransform(object.transform, object.keyframes, time).position;
}

/**
 * 生成一段位移：清掉时间窗内旧的位置关键帧与重叠的位移段，写入起点 / 终点两帧并朝向终点。
 * 闪现用 step：保持在起点直到窗口结束瞬间到达终点。
 */
export function applyPrevisActorTravel(object: PrevisObject, input: { from?: PrevisVec3; to: PrevisVec3; start: number; duration: number; style: PrevisTravelStyle; height?: number }): PrevisObject {
    const style = resolvePrevisTravelStyle(input.style);
    const start = Math.max(0, input.start);
    const duration = Math.max(0.1, input.duration);
    const end = start + duration;
    const from = input.from ?? previsActorPositionAt(object, start);
    const ground = (point: PrevisVec3): PrevisVec3 => [point[0], 0, point[2]];
    const a = ground(from);
    const b = ground(input.to);
    const yaw = Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-3 ? Math.atan2(b[0] - a[0], b[2] - a[2]) : object.transform.rotation[1];
    const base = object.transform;
    const frame = (time: number, position: PrevisVec3, easing: PrevisKeyframeEasing): PrevisKeyframe => ({ id: nanoid(), time, easing, transform: { position, rotation: [base.rotation[0], yaw, base.rotation[2]], scale: base.scale } });
    const kept = object.keyframes.filter((keyframe) => keyframe.time < start - 1e-3 || keyframe.time > end + 1e-3);
    const keyframes = [...kept, frame(start, a, style.easing), frame(end, b, "linear")].toSorted((left, right) => left.time - right.time);
    const travel: PrevisActorTravel = { id: nanoid(), start, duration, style: style.value, height: style.height > 0 ? (input.height ?? style.height) : undefined };
    const travels = [...(object.travels ?? []).filter((item) => item.start + item.duration <= start + 1e-3 || item.start >= end - 1e-3), travel].toSorted((left, right) => left.start - right.start);
    return { ...object, keyframes, travels, motionPath: undefined };
}

export function removePrevisActorTravel(object: PrevisObject, travelId: string): PrevisObject {
    const travel = object.travels?.find((item) => item.id === travelId);
    if (!travel) return object;
    const end = travel.start + travel.duration;
    // 位移段与它写入的两帧一起删除，避免留下孤立的位置关键帧。
    const keyframes = object.keyframes.filter((keyframe) => Math.abs(keyframe.time - travel.start) > 1e-3 && Math.abs(keyframe.time - end) > 1e-3);
    return { ...object, keyframes, travels: object.travels?.filter((item) => item.id !== travelId) };
}

export type PrevisTravelState = {
    style: PrevisTravelStyle;
    /** 0–1：起落淡入淡出后的姿态权重。 */
    weight: number;
    /** 离地高度（米）。 */
    lift: number;
    /** 段内进度 0–1。 */
    progress: number;
    /** 段内时间（秒），用于起伏、步频等周期动画。 */
    local: number;
    distance: number;
};

function smooth(value: number) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

/** 当前时刻生效的位移段；不在任何段内返回 null。 */
export function evaluatePrevisTravel(object: Pick<PrevisObject, "travels" | "keyframes" | "transform">, time: number): PrevisTravelState | null {
    const travel = object.travels?.find((item) => time >= item.start - 1e-3 && time <= item.start + item.duration + 1e-3);
    if (!travel) return null;
    const style = resolvePrevisTravelStyle(travel.style);
    const local = Math.max(0, time - travel.start);
    const progress = Math.max(0, Math.min(1, local / Math.max(travel.duration, 1e-3)));
    const a = previsActorPositionAt(object, travel.start);
    const b = previsActorPositionAt(object, travel.start + travel.duration);
    const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const height = travel.height ?? style.height;
    // 起飞 / 降落各占约 25%（至少 0.35s，不超过半段）。
    const ramp = Math.min(0.5, Math.max(0.35 / Math.max(travel.duration, 0.1), 0.25));
    const envelope = Math.min(smooth(progress / ramp), smooth((1 - progress) / ramp));
    if (style.value === "fly" || style.value === "sword_fly") return { style: style.value, weight: envelope, lift: height * envelope, progress, local, distance };
    if (style.value === "float") return { style: style.value, weight: envelope, lift: (height + 0.12 * Math.sin(local * Math.PI * 1.2)) * envelope, progress, local, distance };
    if (style.value === "jump") {
        const hops = Math.max(1, Math.round(distance / 2.4));
        const phase = progress * hops;
        return { style: style.value, weight: 1, lift: height * Math.sin(Math.PI * (phase - Math.floor(phase))), progress, local, distance };
    }
    return { style: style.value, weight: 1, lift: 0, progress, local, distance };
}

type Euler3 = [number, number, number];

/**
 * 飞行类姿态（规范骨骼，弧度）：
 * - 飞行：整身前倾接近水平，一臂前伸过头、一臂贴身，抬头看前方；
 * - 御剑：直立微屈膝前倾，右手剑指前伸，左手背后；
 * - 悬浮：直立，双臂微张，双腿并拢微屈；
 * - 跳跃：腾空时收腿、双臂上摆。
 */
export function previsTravelPose(state: PrevisTravelState): Partial<Record<string, Euler3>> | null {
    const t = state.local;
    switch (state.style) {
        case "fly":
            return {
                hips: [-1.25, 0, 0],
                spine: [0.08, 0, 0],
                chest: [0.06, 0, 0],
                neck: [-0.45, 0, 0],
                head: [-0.55, 0, 0],
                rightUpperArm: [-2.9, 0, -0.1],
                rightLowerArm: [-0.05, 0, 0],
                leftUpperArm: [0.25, 0, 0.18],
                leftLowerArm: [-0.15, 0, 0],
                leftUpperLeg: [0.08 + 0.05 * Math.sin(t * 5), 0, 0.04],
                rightUpperLeg: [0.12 - 0.05 * Math.sin(t * 5), 0, -0.04],
                leftLowerLeg: [0.1, 0, 0],
                rightLowerLeg: [0.18, 0, 0],
                leftFoot: [0.5, 0, 0],
                rightFoot: [0.5, 0, 0],
            };
        case "sword_fly":
            return {
                hips: [-0.12, 0, 0],
                spine: [0.08, 0, 0],
                leftUpperLeg: [-0.22, 0, 0.06],
                rightUpperLeg: [0.12, 0, -0.06],
                leftLowerLeg: [0.32, 0, 0],
                rightLowerLeg: [0.18, 0, 0],
                rightUpperArm: [-1.25, 0, -0.1],
                rightLowerArm: [-0.35, 0, 0],
                leftUpperArm: [0.45, 0, 0.25],
                leftLowerArm: [-1.6, 0, 0],
                head: [-0.05, 0.05 * Math.sin(t * 0.8), 0],
            };
        case "float":
            return {
                spine: [-0.03, 0, 0],
                leftUpperArm: [0, 0, 0.55 + 0.06 * Math.sin(t * 1.3)],
                rightUpperArm: [0, 0, -0.55 - 0.06 * Math.sin(t * 1.3)],
                leftLowerArm: [-0.25, 0, 0],
                rightLowerArm: [-0.25, 0, 0],
                leftUpperLeg: [-0.12, 0, 0.02],
                rightUpperLeg: [-0.04, 0, -0.02],
                leftLowerLeg: [0.35, 0, 0],
                rightLowerLeg: [0.2, 0, 0],
                leftFoot: [0.45, 0, 0],
                rightFoot: [0.45, 0, 0],
            };
        case "jump": {
            const air = state.lift > 0.02 ? 1 : 0;
            return air
                ? {
                      spine: [0.12, 0, 0],
                      leftUpperLeg: [-0.75, 0, 0.05],
                      rightUpperLeg: [-0.35, 0, -0.05],
                      leftLowerLeg: [1.1, 0, 0],
                      rightLowerLeg: [0.7, 0, 0],
                      leftUpperArm: [-0.4, 0, 0.6],
                      rightUpperArm: [-0.4, 0, -0.6],
                  }
                : null;
        }
        case "dash":
            return { spine: [0.32, 0, 0], chest: [0.08, 0, 0], head: [-0.25, 0, 0] };
        default:
            return null;
    }
}

/** 走 / 跑 / 冲刺强制步态，避免路程短时间长的「跑步」被速度判成走路。 */
export function previsTravelGaitRun(state: PrevisTravelState | null): number | null {
    if (!state) return null;
    if (state.style === "walk") return 0;
    if (state.style === "run" || state.style === "dash") return 1;
    return null;
}

/** 飞行类不走步态。 */
export function previsTravelSuppressesGait(state: PrevisTravelState | null) {
    return Boolean(state && (state.style === "fly" || state.style === "sword_fly" || state.style === "float" || state.style === "jump" || state.style === "teleport"));
}

export function describePrevisTravel(travel: PrevisActorTravel) {
    const style = resolvePrevisTravelStyle(travel.style);
    return `${travel.start.toFixed(1)}–${(travel.start + travel.duration).toFixed(1)}s ${style.label}`;
}
