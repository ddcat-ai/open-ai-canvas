import { nanoid } from "nanoid";

import {
    expandPrevisCameraRecipe,
    PREVIS_CAMERA_MAX_MOVES,
    previsCameraMoveNumber,
    resolvePrevisCameraFollowShotSize,
    resolvePrevisCameraFollowSide,
    resolvePrevisCameraTechnique,
    sanitizePrevisCameraMoveParams,
    type PrevisCameraRecipe,
} from "@/lib/canvas/previs/previs-camera-techniques";
import { resolvePrevisObjectBox } from "@/lib/canvas/previs/previs-frame-bounds";
import { previsMannequinExtents, resolvePrevisMannequinProfile } from "@/lib/canvas/previs/previs-mannequin";
import { previsPathEase } from "@/lib/canvas/previs/previs-motion-path";
import { PREVIS_AUTO_ASPECT_FALLBACK, previsAspectValue, previsFramingDistance } from "@/lib/canvas/previs/previs-optics";
import { interpolatePrevisKeyframeLift, interpolatePrevisTransform } from "@/lib/canvas/previs/previs-scene";
import { evaluatePrevisTravel } from "@/lib/canvas/previs/previs-travel";
import type { PrevisCamera, PrevisCameraFollowSide, PrevisCameraMoveParams, PrevisCameraMoveSegment, PrevisCameraTechnique, PrevisObject, PrevisScene, PrevisVec3 } from "@/types/previs";

/**
 * 摄影机在镜头时间 t 的取景：先按 transform 关键帧插值出基础机位，再按开始时间依次叠加运镜段。
 *
 * - 每段在 [start, start+duration] 内按缓动从 0 走到 1，结束后保持终点机位，后一段从前一段当时的机位继续；
 *   重叠的段同时生效（例如环绕叠加升降就是螺旋升镜）。
 * - 跟拍、跟摇、带主体的环绕按主体当时的位置求值，飞行 / 御剑的离地高度与渲染一致，机位一起升空。
 * - 手持、震动是叠加层：最后叠加，只在时间窗内生效，用段 id 做种子，录制与预览逐帧一致。
 *
 * 纯数据函数：视口 CAM、截图、录制、第二屏监看都经 resolvePrevisViewFraming 走到这里。
 */
export type PrevisCameraState = {
    position: PrevisVec3;
    target: PrevisVec3;
    /** 基础 transform 的欧拉角，决定 up（含 transform 自带的滚转）。 */
    rotation: PrevisVec3;
    focalLength: number;
    /** 运镜叠加的滚转（弧度），正值画面向右倾。 */
    roll: number;
};

type State = { position: PrevisVec3; target: PrevisVec3; focalLength: number; roll: number };

const UP: PrevisVec3 = [0, 1, 0];
const DEG = Math.PI / 180;
const add = (a: PrevisVec3, b: PrevisVec3): PrevisVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: PrevisVec3, b: PrevisVec3): PrevisVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: PrevisVec3, s: number): PrevisVec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: PrevisVec3, b: PrevisVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: PrevisVec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: PrevisVec3, b: PrevisVec3): PrevisVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: PrevisVec3, b: PrevisVec3, t: number): PrevisVec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (value: number) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};

function normalize(vector: PrevisVec3, fallback: PrevisVec3): PrevisVec3 {
    const size = length(vector);
    return size > 1e-9 ? scale(vector, 1 / size) : fallback;
}

/** 绕世界 Y 轴旋转；正角度把 -Z 视线转向 -X（向左）。 */
function rotateY(vector: PrevisVec3, angle: number): PrevisVec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [vector[0] * c + vector[2] * s, vector[1], -vector[0] * s + vector[2] * c];
}

/** Rodrigues：绕单位轴旋转。 */
export function rotatePrevisVectorAroundAxis(vector: PrevisVec3, axis: PrevisVec3, angle: number): PrevisVec3 {
    const k = normalize(axis, UP);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kv = cross(k, vector);
    const kd = dot(k, vector) * (1 - c);
    return [vector[0] * c + kv[0] * s + k[0] * kd, vector[1] * c + kv[1] * s + k[1] * kd, vector[2] * c + kv[2] * s + k[2] * kd];
}

function basis(state: State) {
    const offset = sub(state.target, state.position);
    const forward = normalize(offset, [0, 0, -1]);
    const right = normalize(cross(forward, UP), [1, 0, 0]);
    return { forward, right, up: cross(right, forward), distance: length(offset) };
}

/** 欧拉角（XYZ）作用在 +Z 上的水平朝向；超过 ±90° 的偏航被欧拉分解翻转时仍然正确。 */
function headingFromEuler(rotation: PrevisVec3): PrevisVec3 {
    const [x, y] = rotation;
    return normalize([Math.sin(y), 0, Math.cos(x) * Math.cos(y)], [0, 0, 1]);
}

/** 稳定的种子噪声：几个不同频率正弦相加，同一段 id 永远得到同一条抖动曲线。 */
function seededNoise(seed: number, channel: number, time: number, frequencies: readonly number[]) {
    let sum = 0;
    let weight = 0;
    frequencies.forEach((frequency, index) => {
        const phase = Math.sin(seed * 12.9898 + channel * 78.233 + index * 37.719) * 43758.5453;
        const amplitude = 1 / (index + 1);
        sum += Math.sin(time * frequency * Math.PI * 2 + (phase - Math.floor(phase)) * Math.PI * 2) * amplitude;
        weight += amplitude;
    });
    return weight ? sum / weight : 0;
}

function hashString(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

export type PrevisSubjectState = {
    /** 脚底世界坐标，含飞行 / 御剑 / 悬浮的离地高度。 */
    root: PrevisVec3;
    /** 水平朝向（单位向量，演员默认面朝 +Z）。 */
    forward: PrevisVec3;
    /** 身高或物体高度（米）。 */
    height: number;
};

function isActor(object: PrevisObject) {
    return object.kind === "actor" || object.primitive === "character";
}

/** 主体在 time 的位置、朝向与高度，和视口渲染同一套规则（离地高度 × 人偶身高比例 × 缩放）。 */
export function resolvePrevisSubjectState(object: PrevisObject, time: number): PrevisSubjectState {
    const t = Math.max(0, Number.isFinite(time) ? time : 0);
    const transform = interpolatePrevisTransform(object.transform, object.keyframes, t);
    // 朝向取前后 0.3 秒的平均：位移段之间转身时机位不会瞬间甩过去。
    let headingX = 0;
    let headingZ = 0;
    for (const offset of [-0.3, -0.15, 0, 0.15, 0.3]) {
        const sample = offset === 0 ? transform : interpolatePrevisTransform(object.transform, object.keyframes, Math.max(0, t + offset));
        const heading = headingFromEuler(sample.rotation);
        headingX += heading[0];
        headingZ += heading[2];
    }
    const forward = normalize([headingX, 0, headingZ], headingFromEuler(transform.rotation));
    if (!isActor(object)) {
        const box = resolvePrevisObjectBox({ ...object, transform });
        return { root: transform.position, forward, height: Math.max(0.2, box.max.y - box.min.y) };
    }
    const profile = resolvePrevisMannequinProfile(object.archetype || "adult", object.actorProfile);
    const scaleY = Math.max(0.1, Math.abs(transform.scale[1]));
    const travel = object.travels?.length ? evaluatePrevisTravel(object, t) : null;
    // 跳跃的起落交给画面本身，机位不跟着上下颠；飞行与路径高度（米）跟着走。
    const travelLift = travel && travel.style !== "jump" ? Math.max(0, travel.lift) : 0;
    const lift = Math.max(travelLift, interpolatePrevisKeyframeLift(object.keyframes, t)) * scaleY;
    const [x, y, z] = transform.position;
    return { root: [x, y + lift, z], forward, height: previsMannequinExtents(profile).height * scaleY };
}

/** aspect：镜头画幅宽高比，跟拍景别按它换算取景距离（自适应画幅固定用 16:9，避免调整窗口时机位跟着变）。 */
type Context = { objects: Map<string, PrevisObject>; aspect: number };

function subjectAt(context: Context, move: PrevisCameraMoveSegment, time: number) {
    const object = move.subjectId ? context.objects.get(move.subjectId) : undefined;
    return object ? resolvePrevisSubjectState(object, time) : null;
}

function aimPoint(subject: PrevisSubjectState, move: PrevisCameraMoveSegment, aimRatio = 0.72): PrevisVec3 {
    const aim = previsCameraMoveNumber(move, "aim") ?? subject.height * aimRatio;
    return add(subject.root, [0, aim, 0]);
}

function moveEnd(move: PrevisCameraMoveSegment) {
    return move.start + move.duration;
}

function progress(move: PrevisCameraMoveSegment, time: number) {
    const raw = clamp((time - move.start) / Math.max(move.duration, 1e-3), 0, 1);
    if (move.technique === "whip_pan_left" || move.technique === "whip_pan_right") {
        // 甩镜：两端极慢、中段极快。
        return raw < 0.5 ? 16 * raw ** 5 : 1 - (-2 * raw + 2) ** 5 / 2;
    }
    return previsPathEase(move.easing ?? "smooth", raw);
}

/**
 * 镜头中途接管机位（跟拍、跟摇、环绕主体）时的切入权重。
 * 跟拍给了 blend 就按 blend 秒过渡；没给时从 0 秒开始的段直接到位，中途开始的段约 0.6 秒内切入。
 */
function entryWeight(move: PrevisCameraMoveSegment, time: number) {
    if (time < move.start) return 0;
    const requested = previsCameraMoveNumber(move, "blend");
    if (requested === undefined && move.start <= 0.05) return 1;
    const blend = requested ?? clamp(move.duration / 3, 0.15, 0.6);
    if (blend <= 1e-3) return 1;
    return smoothstep((time - move.start) / blend);
}

/** 主体右手方向（演员默认面朝 +Z，右手在 -X）。 */
function rightOf(forward: PrevisVec3): PrevisVec3 {
    return [-forward[2], 0, forward[0]];
}

function wrapAngle(angle: number) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
}

/**
 * 跟拍切入的机位过渡：以主体为圆心，方位角、水平半径、高度分别插值。
 * 换方位（过肩→正面、后方→侧面）时机位绕着人物走，不会沿直线从人物身体里穿过去。
 * 两个方位接近正对（例如正后方到正前方）时最短方向不稳定，按 via 指定的一侧绕行：
 * 目标在人物右侧、过肩时从右边绕，在左侧时从左边绕，其余默认右边；整段过渡方向不变，不会中途翻面。
 */
function arcBlend(from: PrevisVec3, to: PrevisVec3, subject: PrevisSubjectState, via: "left" | "right", weight: number): PrevisVec3 {
    if (weight >= 1) return to;
    if (weight <= 0) return from;
    const pivot = subject.root;
    const a: PrevisVec3 = [from[0] - pivot[0], 0, from[2] - pivot[2]];
    const b: PrevisVec3 = [to[0] - pivot[0], 0, to[2] - pivot[2]];
    const ra = Math.hypot(a[0], a[2]);
    const rb = Math.hypot(b[0], b[2]);
    // 机位贴着主体（主观视角）时方位角没有意义，直接插值。
    if (ra < 0.25 || rb < 0.25) return lerp(from, to, weight);
    const angleA = Math.atan2(a[0], a[2]);
    let delta = wrapAngle(Math.atan2(b[0], b[2]) - angleA);
    if (Math.abs(delta) > Math.PI * 0.85) {
        const mid = angleA + delta / 2;
        const side = dot([Math.sin(mid), 0, Math.cos(mid)], rightOf(subject.forward)) >= 0 ? "right" : "left";
        if (side !== via) delta -= Math.sign(delta) * Math.PI * 2;
    }
    const angle = angleA + delta * weight;
    const radius = ra + (rb - ra) * weight;
    return [pivot[0] + Math.sin(angle) * radius, from[1] + (to[1] - from[1]) * weight, pivot[2] + Math.cos(angle) * radius];
}

/**
 * 跟拍切入时的视线：插值视线方向而不是焦点坐标。
 * 机位绕着人物走时，旧焦点（例如过肩镜头看向人物前方 8 米）可能已经在机位身后；直接插值焦点坐标，
 * 镜头会背对人物。这里把方向从旧视线球面插值到「从当前机位看新焦点」，并且方向比机位先转完，
 * 像摄影师一边绕一边先把镜头摇向人物。权重 0 时与上一段机位完全连续，权重 1 时就是新机位的视线。
 */
function blendFollowTarget(state: State, position: PrevisVec3, target: PrevisVec3, weight: number): PrevisVec3 {
    if (weight >= 1) return target;
    if (weight <= 0) return state.target;
    const from = sub(state.target, state.position);
    const to = sub(target, position);
    const fromLength = length(from);
    const toLength = length(to);
    if (fromLength < 1e-6 || toLength < 1e-6) return lerp(state.target, target, weight);
    // 开方让视线比机位先转：权重 0.1 时视线已转过约 45%，人物不会在绕行初段滑出画面边缘。
    const k = smoothstep(Math.min(1, 1.6 * Math.sqrt(weight)));
    const a = scale(from, 1 / fromLength);
    const b = scale(to, 1 / toLength);
    const cosine = clamp(dot(a, b), -1, 1);
    let direction: PrevisVec3;
    if (cosine > 0.9995) {
        direction = normalize(lerp(a, b, k), b);
    } else if (cosine < -0.9995) {
        // 正好反向：绕竖直轴转半圈，避免球面插值没有确定的转动方向。
        direction = rotatePrevisVectorAroundAxis(a, UP, Math.PI * k);
    } else {
        const theta = Math.acos(cosine);
        const sine = Math.sin(theta);
        direction = add(scale(a, Math.sin((1 - k) * theta) / sine), scale(b, Math.sin(k * theta) / sine));
    }
    return add(position, scale(direction, fromLength + (toLength - fromLength) * k));
}

/** 景别只对后方、前方、左右侧生效；俯拍、过肩、主观视角有自己的几何。 */
function framedShotSize(side: PrevisCameraFollowSide, move: PrevisCameraMoveSegment) {
    return side === "behind" || side === "front" || side === "left" || side === "right" ? resolvePrevisCameraFollowShotSize(move.params?.shotSize) : undefined;
}

function followPose(subject: PrevisSubjectState, aimSubject: PrevisSubjectState, move: PrevisCameraMoveSegment, optics: { focalLength: number; aspect: number }) {
    const side = resolvePrevisCameraFollowSide(move.params?.side);
    const size = framedShotSize(side.value, move);
    const focalLength = Number.isFinite(optics.focalLength) && optics.focalLength > 0 ? optics.focalLength : 35;
    const distance = previsCameraMoveNumber(move, "distance") ?? (size ? previsFramingDistance(size.extent * subject.height, focalLength, optics.aspect) : side.distance);
    const height = previsCameraMoveNumber(move, "height") ?? subject.height * (size ? size.eye : side.heightRatio);
    const framedTarget = aimPoint(aimSubject, move, size?.aim);
    const forward = subject.forward;
    const right = rightOf(forward);
    const lifted = (point: PrevisVec3, extra: number): PrevisVec3 => add(point, [0, extra, 0]);
    switch (side.value) {
        case "front": {
            // 倒退跟拍的滞后让人物追近机位；近景、特写距离很短，跑动时人物会撞进镜头。
            // 机位到人物当前位置沿前进方向至少保留 75% 的取景距离。
            const position = add(subject.root, scale(forward, distance));
            const ahead = dot(sub(position, aimSubject.root), forward);
            const guarded = ahead < distance * 0.75 ? add(position, scale(forward, distance * 0.75 - ahead)) : position;
            return { position: lifted(guarded, height), target: framedTarget };
        }
        case "left":
            return { position: lifted(sub(subject.root, scale(right, distance)), height), target: framedTarget };
        case "right":
            return { position: lifted(add(subject.root, scale(right, distance)), height), target: framedTarget };
        case "shoulder": {
            const position = lifted(add(sub(subject.root, scale(forward, distance)), scale(right, 0.45)), height);
            return { position, target: lifted(add(aimSubject.root, scale(aimSubject.forward, 8)), previsCameraMoveNumber(move, "aim") ?? aimSubject.height * 0.8) };
        }
        case "pov": {
            const eye = previsCameraMoveNumber(move, "height") ?? subject.height * side.heightRatio;
            return { position: lifted(add(subject.root, scale(forward, distance)), eye), target: lifted(add(subject.root, scale(forward, 10)), eye) };
        }
        default:
            // behind / above：above 只是高度更高、距离更近的后方机位，画面上方仍是人物前进方向。
            return { position: lifted(sub(subject.root, scale(forward, distance)), height), target: aimPoint(aimSubject, move) };
    }
}

function applyMove(state: State, move: PrevisCameraMoveSegment, time: number, context: Context): State {
    const p = progress(move, time);
    const number = (key: Parameters<typeof previsCameraMoveNumber>[1]) => previsCameraMoveNumber(move, key);
    const hold = Math.min(Math.max(time, move.start), moveEnd(move));
    switch (move.technique) {
        case "push_in":
        case "pull_out": {
            const frame = basis(state);
            const push = move.technique === "push_in";
            const requested = number("distance") ?? frame.distance * (push ? 0.45 : 0.6);
            // 推镜不越过焦点：越过后视线会翻转。
            const amount = push ? Math.min(requested, Math.max(0, frame.distance - 0.3)) : requested;
            return { ...state, position: add(state.position, scale(frame.forward, (push ? amount : -amount) * p)) };
        }
        case "dolly_zoom_in":
        case "dolly_zoom_out": {
            const subject = subjectAt(context, move, hold);
            const pivot = subject ? aimPoint(subject, move) : state.target;
            const toPivot = sub(pivot, state.position);
            const d0 = length(toPivot);
            if (d0 < 0.05) return state;
            const direction = scale(toPivot, 1 / d0);
            const requested = number("distance");
            let d1 = move.technique === "dolly_zoom_out" ? d0 + (requested ?? d0) : Math.max(0.3, d0 - (requested ?? d0 * 0.5));
            const f0 = state.focalLength;
            const optical = Number.isFinite(f0) && f0 > 0;
            // 主体大小 ∝ 焦段 / 距离：焦段到了 8–300mm 的边界就同步收住距离，效果不变形。
            if (optical) d1 = (d0 * clamp((f0 * d1) / d0, 8, 300)) / f0;
            const distance = d0 + (d1 - d0) * p;
            const weight = subject ? entryWeight(move, time) : 1;
            return { ...state, position: sub(pivot, scale(direction, distance)), target: subject ? lerp(state.target, pivot, weight) : state.target, focalLength: optical ? (f0 * distance) / d0 : f0 };
        }
        case "zoom_in":
        case "zoom_out": {
            const f0 = state.focalLength;
            if (!(Number.isFinite(f0) && f0 > 0)) return state;
            const f1 = clamp(number("focalLength") ?? (move.technique === "zoom_in" ? f0 * 2 : f0 * 0.5), 8, 300);
            return { ...state, focalLength: f0 * (f1 / f0) ** p };
        }
        case "pan_left":
        case "pan_right":
        case "whip_pan_left":
        case "whip_pan_right": {
            const whip = move.technique.startsWith("whip");
            const left = move.technique === "pan_left" || move.technique === "whip_pan_left";
            const angle = (number("angle") ?? (whip ? 90 : 30)) * DEG * p * (left ? 1 : -1);
            return { ...state, target: add(state.position, rotateY(sub(state.target, state.position), angle)) };
        }
        case "tilt_up":
        case "tilt_down": {
            const frame = basis(state);
            const elevation = Math.asin(clamp(frame.forward[1], -1, 1));
            const limit = 85 * DEG;
            const requested = (number("angle") ?? 15) * DEG * p * (move.technique === "tilt_up" ? 1 : -1);
            const angle = clamp(elevation + requested, -limit, limit) - elevation;
            return { ...state, target: add(state.position, rotatePrevisVectorAroundAxis(sub(state.target, state.position), frame.right, angle)) };
        }
        case "roll":
            return { ...state, roll: state.roll + (number("angle") ?? 15) * DEG * p };
        case "truck_left":
        case "truck_right": {
            const offset = scale(basis(state).right, (number("distance") ?? 2) * p * (move.technique === "truck_right" ? 1 : -1));
            return { ...state, position: add(state.position, offset), target: add(state.target, offset) };
        }
        case "pedestal_up":
        case "pedestal_down": {
            const offset: PrevisVec3 = [0, (number("distance") ?? 1) * p * (move.technique === "pedestal_up" ? 1 : -1), 0];
            return { ...state, position: add(state.position, offset), target: add(state.target, offset) };
        }
        case "crane_up":
        case "crane_down": {
            const up = move.technique === "crane_up";
            const frame = basis(state);
            const horizontal = normalize([frame.forward[0], 0, frame.forward[2]], [0, 0, -1]);
            const height = (number("height") ?? (up ? 2.5 : 2)) * p * (up ? 1 : -1);
            const travel = (number("distance") ?? 0) * p * (up ? -1 : 1);
            return { ...state, position: add(add(state.position, [0, height, 0]), scale(horizontal, travel)) };
        }
        case "orbit_left":
        case "orbit_right": {
            const subject = subjectAt(context, move, hold);
            const pivot = subject ? aimPoint(subject, move) : state.target;
            const angle = (number("angle") ?? 90) * DEG * p * (move.technique === "orbit_right" ? 1 : -1);
            const rise = (number("rise") ?? 0) * p;
            const position = add(add(pivot, rotateY(sub(state.position, pivot), angle)), [0, rise, 0]);
            return { ...state, position, target: subject ? lerp(state.target, pivot, entryWeight(move, time)) : state.target };
        }
        case "follow": {
            if (time < move.start) return state;
            const object = move.subjectId ? context.objects.get(move.subjectId) : undefined;
            if (!object) return state;
            const side = resolvePrevisCameraFollowSide(move.params?.side).value;
            // 主观与过肩贴着人物，不做滞后；其余方位用时间滞后模拟机位追赶。
            const lag = side === "pov" || side === "shoulder" ? 0 : (number("lag") ?? 0.25);
            const anchor = resolvePrevisSubjectState(object, Math.max(move.start, hold - lag));
            const current = lag ? resolvePrevisSubjectState(object, hold) : anchor;
            const pose = followPose(anchor, current, move, { focalLength: state.focalLength, aspect: context.aspect });
            const weight = entryWeight(move, time);
            const via = side === "left" ? "left" : "right";
            const position = arcBlend(state.position, pose.position, current, via, weight);
            return { ...state, position, target: blendFollowTarget(state, position, pose.target, weight) };
        }
        case "look_at": {
            const subject = subjectAt(context, move, hold);
            if (!subject || time < move.start) return state;
            return { ...state, target: lerp(state.target, aimPoint(subject, move), entryWeight(move, time)) };
        }
        case "handheld":
        case "shake": {
            const local = time - move.start;
            if (local < 0 || local > move.duration) return state;
            const intensity = number("intensity") ?? 1;
            const handheld = move.technique === "handheld";
            const envelope = handheld ? smoothstep(Math.min(local, move.duration - local) / 0.3) : Math.exp((-5 * local) / Math.max(move.duration, 0.05)) * smoothstep(local / 0.04);
            const k = intensity * envelope;
            if (!k) return state;
            const seed = hashString(move.id);
            const frequencies = handheld ? [0.6, 1.3, 2.7] : [11, 17, 23];
            const frame = basis(state);
            const shift = handheld ? 0.012 : 0.05;
            const offset = add(
                add(scale(frame.right, seededNoise(seed, 0, local, frequencies) * shift * k), scale(frame.up, seededNoise(seed, 1, local, frequencies) * shift * 0.8 * k)),
                scale(frame.forward, seededNoise(seed, 2, local, frequencies) * shift * 0.6 * k),
            );
            const turn = (handheld ? 0.35 : 1.2) * DEG * k;
            const look = Math.max(frame.distance, 1);
            const aim = add(scale(frame.right, Math.tan(seededNoise(seed, 3, local, frequencies) * turn) * look), scale(frame.up, Math.tan(seededNoise(seed, 4, local, frequencies) * turn * 0.8) * look));
            return { ...state, position: add(state.position, offset), target: add(add(state.target, offset), aim), roll: state.roll + seededNoise(seed, 5, local, frequencies) * (handheld ? 0.25 : 0.8) * DEG * k };
        }
        default:
            return state;
    }
}

function isLayer(move: PrevisCameraMoveSegment) {
    return Boolean(resolvePrevisCameraTechnique(move.technique)?.layer);
}

/** 求值顺序：主运镜按开始时间，叠加层（手持、震动）最后。未知手法与非法时间直接跳过。 */
export function orderedPrevisCameraMoves(moves: PrevisCameraMoveSegment[] | undefined) {
    return (moves ?? [])
        .filter((move) => resolvePrevisCameraTechnique(move.technique) && Number.isFinite(move.start) && Number.isFinite(move.duration) && move.duration > 0)
        .toSorted((left, right) => Number(isLayer(left)) - Number(isLayer(right)) || left.start - right.start || left.id.localeCompare(right.id));
}

/** 求值时可见的场景字段：对象必需；镜头用于取跟拍景别的画幅（不传时按 16:9）。 */
export type PrevisCameraEvaluationScene = Pick<PrevisScene, "objects"> & Partial<Pick<PrevisScene, "shots" | "activeShotId">>;

/**
 * 跟拍景别换算距离用的画幅：优先当前镜头（用这台摄影机时），否则第一个用这台摄影机的镜头。
 * 自适应画幅固定按 16:9，避免调整窗口大小时机位距离跟着变。
 */
export function resolvePrevisCameraFramingAspect(scene: PrevisCameraEvaluationScene, cameraId: string) {
    const shots = scene.shots ?? [];
    const shot = shots.find((item) => item.id === scene.activeShotId && item.cameraId === cameraId) ?? shots.find((item) => item.cameraId === cameraId);
    return shot ? previsAspectValue(shot.aspectRatio, PREVIS_AUTO_ASPECT_FALLBACK) : PREVIS_AUTO_ASPECT_FALLBACK;
}

export function evaluatePrevisCamera(scene: PrevisCameraEvaluationScene, camera: PrevisCamera, time: number): PrevisCameraState {
    const t = Number.isFinite(time) ? time : 0;
    const transform = interpolatePrevisTransform(camera.transform, camera.keyframes, t);
    const moves = orderedPrevisCameraMoves(camera.moves);
    let state: State = { position: transform.position, target: camera.target, focalLength: camera.focalLength, roll: 0 };
    if (moves.length) {
        const context: Context = { objects: new Map(scene.objects.map((object) => [object.id, object])), aspect: resolvePrevisCameraFramingAspect(scene, camera.id) };
        for (const move of moves) state = applyMove(state, move, t, context);
        // 降镜、摇臂下降不钻到地面以下。
        if (state.position[1] < 0.05) state = { ...state, position: [state.position[0], 0.05, state.position[2]] };
    }
    return { ...state, rotation: transform.rotation };
}

/** 运镜叠加的滚转：把 up 绕视线旋转，正值让画面顶部向右倾。 */
export function rollPrevisUp(up: PrevisVec3, view: PrevisVec3, roll: number): PrevisVec3 {
    if (!roll) return up;
    return rotatePrevisVectorAroundAxis(up, view, roll);
}

/** 镜头内的机位轨迹采样，供视口画运镜路径。 */
export function samplePrevisCameraPath(scene: PrevisCameraEvaluationScene, camera: PrevisCamera, duration: number, samples = 96): PrevisVec3[] {
    const count = Math.max(2, Math.min(240, Math.round(samples)));
    const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
    return Array.from({ length: count }, (_, index) => evaluatePrevisCamera(scene, camera, (total * index) / (count - 1)).position);
}

export type PrevisCameraMoveInput = {
    technique: PrevisCameraTechnique;
    start: number;
    duration?: number;
    easing?: PrevisCameraMoveSegment["easing"];
    subjectId?: string;
    params?: PrevisCameraMoveParams;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 新建一段运镜：时间收进镜头，参数按手法过滤与截断，不需要主体的手法丢掉 subjectId。 */
export function createPrevisCameraMove(input: PrevisCameraMoveInput, shotDuration: number): PrevisCameraMoveSegment {
    const info = resolvePrevisCameraTechnique(input.technique);
    const total = Number.isFinite(shotDuration) && shotDuration > 0 ? shotDuration : 5;
    const start = clamp(Number.isFinite(input.start) ? input.start : 0, 0, Math.max(0, total - 0.1));
    const remaining = Math.max(0.1, total - start);
    const duration = clamp(input.duration ?? info?.duration ?? remaining, 0.1, remaining);
    const move: PrevisCameraMoveSegment = { id: nanoid(), technique: input.technique, start: round(start), duration: round(duration) };
    if (input.easing) move.easing = input.easing;
    if (input.subjectId && info?.subject !== "none") move.subjectId = input.subjectId;
    const params = sanitizePrevisCameraMoveParams(input.technique, input.params);
    if (params) move.params = params;
    return move;
}

/** 追加运镜段并按开始时间排序；超过上限时返回 null，由调用方提示。 */
export function addPrevisCameraMoves(camera: PrevisCamera, moves: PrevisCameraMoveSegment[]): PrevisCamera | null {
    const next = [...(camera.moves ?? []), ...moves];
    if (next.length > PREVIS_CAMERA_MAX_MOVES) return null;
    return { ...camera, moves: next.toSorted((left, right) => left.start - right.start) };
}

export function removePrevisCameraMove(camera: PrevisCamera, moveId: string): PrevisCamera {
    if (!camera.moves?.some((move) => move.id === moveId)) return camera;
    const moves = camera.moves.filter((move) => move.id !== moveId);
    return { ...camera, moves: moves.length ? moves : undefined };
}

/** 把一个大师手法配方展开成运镜段。需要主体却没有主体时返回空数组。 */
export function buildPrevisCameraRecipeMoves(recipe: PrevisCameraRecipe, input: { start: number; duration: number; subjectId?: string; shotDuration: number }): PrevisCameraMoveSegment[] {
    if (recipe.subject === "required" && !input.subjectId) return [];
    return expandPrevisCameraRecipe(recipe, { start: input.start, duration: input.duration, subjectId: input.subjectId }).map((move) => createPrevisCameraMove(move, input.shotDuration));
}
