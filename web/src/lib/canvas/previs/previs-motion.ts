import { Euler, Quaternion } from "three";

import { interpolatePrevisBoneRotation, interpolatePrevisKeyframeLift, interpolatePrevisTransform, resolvePrevisKeyframeProgress } from "@/lib/canvas/previs/previs-scene";
import { evaluatePrevisTravel, previsTravelGaitRun, previsTravelPose, previsTravelSuppressesGait } from "@/lib/canvas/previs/previs-travel";
import type { PrevisActorMotion, PrevisHumanoidBone, PrevisKeyframe, PrevisMotionId, PrevisObject, PrevisPose, PrevisQuat } from "@/types/previs";

/**
 * 标准人偶的姿势、步态与动作片段：全部用代码定义，不依赖外部动画文件。
 *
 * 坐标约定（与 previs-mannequin.ts 的骨架一致）：静置姿态为自然站立，所有骨骼局部旋转为单位四元数，
 * 人物面朝 +Z、左手在 +X。因此旋转值就是「相对站立」的绝对局部旋转：
 * - 手臂/腿 rotX 为负 → 向前抬；小腿 rotX 为正 → 屈膝；脊柱/头 rotX 为正 → 前倾/低头；
 * - 左臂 rotZ 为正、右臂 rotZ 为负 → 向外侧展开；rotY → 转身/转头。
 */
export type PrevisEuler = [number, number, number];
export type PrevisBonePose = Partial<Record<PrevisHumanoidBone, PrevisEuler>>;

export const PREVIS_MANNEQUIN_BONES = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "leftShoulder",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightShoulder",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
    "leftUpperLeg",
    "leftLowerLeg",
    "leftFoot",
    "rightUpperLeg",
    "rightLowerLeg",
    "rightFoot",
] as const satisfies readonly PrevisHumanoidBone[];
export type PrevisMannequinBone = (typeof PREVIS_MANNEQUIN_BONES)[number];

const UPPER_BONES = new Set<PrevisHumanoidBone>(["spine", "chest", "neck", "head", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"]);

const relaxedArms: PrevisBonePose = { leftUpperArm: [0, 0, 0.08], rightUpperArm: [0, 0, -0.08], leftLowerArm: [-0.12, 0, 0], rightLowerArm: [-0.12, 0, 0] };
const sitLegs: PrevisBonePose = { leftUpperLeg: [-1.57, 0, 0.04], rightUpperLeg: [-1.57, 0, -0.04], leftLowerLeg: [1.57, 0, 0], rightLowerLeg: [1.57, 0, 0] };
const fightStance: PrevisBonePose = {
    spine: [0.1, 0.25, 0],
    head: [-0.05, -0.25, 0],
    leftUpperArm: [-0.75, 0, 0.25],
    rightUpperArm: [-0.55, 0, -0.3],
    leftLowerArm: [-1.9, 0, 0],
    rightLowerArm: [-2, 0, 0],
    leftUpperLeg: [-0.35, 0, 0.08],
    leftLowerLeg: [0.45, 0, 0],
    leftFoot: [-0.1, 0, 0],
    rightUpperLeg: [0.25, 0, -0.08],
    rightLowerLeg: [0.35, 0, 0],
    rightFoot: [-0.3, 0, 0],
};

/** 21 个姿势预设在标准人偶上的骨骼旋转。贴地由人偶 FK 自动求解，这里不写身体高度。 */
export const PREVIS_MANNEQUIN_POSES: Record<PrevisPose, PrevisBonePose> = {
    neutral: relaxedArms,
    stand: relaxedArms,
    t_pose: { leftUpperArm: [0, 0, Math.PI / 2], rightUpperArm: [0, 0, -Math.PI / 2] },
    walk: {
        leftUpperLeg: [-0.4, 0, 0],
        leftLowerLeg: [0.15, 0, 0],
        rightUpperLeg: [0.32, 0, 0],
        rightLowerLeg: [0.45, 0, 0],
        rightFoot: [-0.2, 0, 0],
        leftUpperArm: [0.3, 0, 0.08],
        rightUpperArm: [-0.3, 0, -0.08],
        leftLowerArm: [-0.2, 0, 0],
        rightLowerArm: [-0.35, 0, 0],
    },
    run: {
        spine: [0.15, 0, 0],
        leftUpperLeg: [-0.85, 0, 0],
        leftLowerLeg: [0.55, 0, 0],
        rightUpperLeg: [0.45, 0, 0],
        rightLowerLeg: [1.2, 0, 0],
        leftUpperArm: [0.6, 0, 0.1],
        rightUpperArm: [-0.7, 0, -0.1],
        leftLowerArm: [-1.25, 0, 0],
        rightLowerArm: [-1.35, 0, 0],
    },
    sit: { ...sitLegs, spine: [-0.05, 0, 0], leftUpperArm: [-0.35, 0, 0.12], rightUpperArm: [-0.35, 0, -0.12], leftLowerArm: [-0.75, 0, 0], rightLowerArm: [-0.75, 0, 0] },
    squat: {
        spine: [0.45, 0, 0],
        head: [-0.3, 0, 0],
        leftUpperLeg: [-2, 0, 0.2],
        rightUpperLeg: [-2, 0, -0.2],
        leftLowerLeg: [2.3, 0, 0],
        rightLowerLeg: [2.3, 0, 0],
        leftFoot: [-0.3, 0, 0],
        rightFoot: [-0.3, 0, 0],
        leftUpperArm: [-1, 0, 0.1],
        rightUpperArm: [-1, 0, -0.1],
        leftLowerArm: [-0.3, 0, 0],
        rightLowerArm: [-0.3, 0, 0],
    },
    kneel_single: { leftUpperLeg: [-1.57, 0, 0.05], leftLowerLeg: [1.57, 0, 0], rightUpperLeg: [0.05, 0, -0.04], rightLowerLeg: [1.55, 0, 0], rightFoot: [0.4, 0, 0], ...relaxedArms, rightUpperArm: [-0.3, 0, -0.1], rightLowerArm: [-0.6, 0, 0] },
    kneel_double: { leftUpperLeg: [0.05, 0, 0.05], rightUpperLeg: [0.05, 0, -0.05], leftLowerLeg: [1.55, 0, 0], rightLowerLeg: [1.55, 0, 0], leftFoot: [0.4, 0, 0], rightFoot: [0.4, 0, 0], spine: [0.05, 0, 0], ...relaxedArms },
    hands_hips: { leftUpperArm: [0.15, 0, 0.7], rightUpperArm: [0.15, 0, -0.7], leftLowerArm: [-0.2, 0, -1.6], rightLowerArm: [-0.2, 0, 1.6] },
    lean: { spine: [0, 0, 0.1], chest: [0, 0, 0.06], head: [0, 0, -0.08], leftUpperLeg: [0, 0, 0.12], rightUpperLeg: [-0.05, 0, 0.12], rightLowerLeg: [0.1, 0, 0], ...relaxedArms, leftUpperArm: [-0.2, 0, 0.35], leftLowerArm: [-0.9, 0, 0] },
    bow: { spine: [0.55, 0, 0], chest: [0.25, 0, 0], head: [0.15, 0, 0], leftUpperArm: [-0.75, 0, 0.04], rightUpperArm: [-0.75, 0, -0.04] },
    think: { head: [0.15, 0.1, 0], rightUpperArm: [-0.5, 0, -0.15], rightLowerArm: [-2.25, 0, 0], leftUpperArm: [-0.3, 0, 0.15], leftLowerArm: [-1.4, 0, -0.7] },
    fight: fightStance,
    kick: { spine: [-0.15, 0, 0], rightUpperLeg: [-1.35, 0, 0], rightLowerLeg: [0.12, 0, 0], leftLowerLeg: [0.15, 0, 0], leftUpperArm: [0, 0, 0.65], rightUpperArm: [0, 0, -0.65], leftLowerArm: [-0.4, 0, 0], rightLowerArm: [-0.4, 0, 0] },
    throw: { spine: [-0.1, 0.4, 0], rightUpperArm: [-2.6, 0, -0.2], rightLowerArm: [-0.7, 0, 0], leftUpperArm: [-1, 0, 0.2], leftLowerArm: [-0.2, 0, 0], leftUpperLeg: [-0.35, 0, 0], rightUpperLeg: [0.2, 0, 0], rightLowerLeg: [0.2, 0, 0] },
    push: {
        spine: [0.2, 0, 0],
        leftUpperArm: [-1.4, 0, 0.1],
        rightUpperArm: [-1.4, 0, -0.1],
        leftLowerArm: [-0.2, 0, 0],
        rightLowerArm: [-0.2, 0, 0],
        leftUpperLeg: [-0.4, 0, 0],
        leftLowerLeg: [0.35, 0, 0],
        rightUpperLeg: [0.35, 0, 0],
        rightFoot: [-0.3, 0, 0],
    },
    wave: { ...relaxedArms, rightUpperArm: [0, 0, -2.5], rightLowerArm: [-0.6, 0, 0], head: [0, -0.1, 0] },
    reach: { ...relaxedArms, spine: [0.15, 0, 0], rightUpperArm: [-1.45, 0, -0.05], rightLowerArm: [-0.1, 0, 0] },
    arms_crossed: { leftUpperArm: [-0.35, 0, 0.25], rightUpperArm: [-0.35, 0, -0.25], leftLowerArm: [-1.6, 0, -0.9], rightLowerArm: [-1.6, 0, 0.9] },
    phone: { ...relaxedArms, head: [0.4, 0, 0], rightUpperArm: [-0.45, 0, -0.1], rightLowerArm: [-1.9, 0, 0.3] },
};

type MotionSample = { bones: PrevisBonePose; lift?: number };
export type PrevisMotionDefinition = {
    id: PrevisMotionId;
    label: string;
    /** 默认插入时长（秒）。 */
    duration: number;
    loop: boolean;
    /** upper：只覆盖上半身，可与走路叠加；full：整身。 */
    layer: "upper" | "full";
    sample: (time: number) => MotionSample;
};

const wave = (time: number, hz: number) => Math.sin(time * Math.PI * 2 * hz);
const pulse = (time: number, hz: number) => Math.max(0, wave(time, hz)) ** 2;

/** 21 个程序化动作；label 是 UI 与 Agent 摘要共用的中文名。 */
export const PREVIS_MOTIONS: Record<PrevisMotionId, PrevisMotionDefinition> = {
    idle: { id: "idle", label: "待机", duration: 4, loop: true, layer: "upper", sample: (t) => ({ bones: { ...relaxedArms, spine: [0.02 * wave(t, 0.28), 0, 0], chest: [0.015 * wave(t, 0.28), 0, 0], head: [0, 0.05 * wave(t, 0.11), 0] } }) },
    walk: { id: "walk", label: "原地走", duration: 3, loop: true, layer: "full", sample: (t) => ({ bones: previsGaitPose(t, 0) }) },
    run: { id: "run", label: "原地跑", duration: 3, loop: true, layer: "full", sample: (t) => ({ bones: previsGaitPose(t * 1.4, 1) }) },
    talk: {
        id: "talk",
        label: "说话手势",
        duration: 3,
        loop: true,
        layer: "upper",
        sample: (t) => ({
            bones: {
                head: [0.05 * wave(t, 1.1), 0.1 * wave(t, 0.37), 0],
                rightUpperArm: [-0.35 - 0.1 * wave(t, 0.7), 0, -0.15],
                rightLowerArm: [-1.15 + 0.3 * wave(t, 1.3), 0, 0],
                leftUpperArm: [-0.15, 0, 0.12],
                leftLowerArm: [-0.7 + 0.15 * wave(t + 0.4, 0.9), 0, 0],
            },
        }),
    },
    wave: { id: "wave", label: "招手", duration: 2, loop: true, layer: "upper", sample: (t) => ({ bones: { rightUpperArm: [0, 0, -2.5], rightLowerArm: [-0.25, 0, -0.45 * wave(t, 2)], head: [0, -0.1, 0] } }) },
    nod: { id: "nod", label: "点头", duration: 1.5, loop: true, layer: "upper", sample: (t) => ({ bones: { head: [0.28 * pulse(t, 1.6), 0, 0], neck: [0.08 * pulse(t, 1.6), 0, 0] } }) },
    shake_head: { id: "shake_head", label: "摇头", duration: 1.5, loop: true, layer: "upper", sample: (t) => ({ bones: { head: [0, 0.42 * wave(t, 1.8), 0] } }) },
    look_around: { id: "look_around", label: "环顾", duration: 4, loop: true, layer: "upper", sample: (t) => ({ bones: { head: [0.05, 0.7 * wave(t, 0.33), 0], chest: [0, 0.22 * wave(t, 0.33), 0] } }) },
    point: { id: "point", label: "指向", duration: 2, loop: false, layer: "upper", sample: () => ({ bones: { rightUpperArm: [-1.5, 0, -0.15], rightLowerArm: [-0.05, 0, 0], chest: [0, -0.12, 0], head: [0, -0.12, 0] } }) },
    phone_call: { id: "phone_call", label: "打电话", duration: 4, loop: true, layer: "upper", sample: (t) => ({ bones: { rightUpperArm: [-0.25, 0, -0.55], rightLowerArm: [-2.35, 0, 0], head: [0.05, 0.05 * wave(t, 0.4), 0.12] } }) },
    sit_idle: { id: "sit_idle", label: "坐着待机", duration: 4, loop: true, layer: "full", sample: (t) => ({ bones: { ...PREVIS_MANNEQUIN_POSES.sit, spine: [-0.05 + 0.02 * wave(t, 0.28), 0, 0], head: [0, 0.08 * wave(t, 0.13), 0] } }) },
    clap: {
        id: "clap",
        label: "鼓掌",
        duration: 2,
        loop: true,
        layer: "upper",
        sample: (t) => {
            const open = 0.35 * pulse(t, 2.5);
            return { bones: { leftUpperArm: [-1, 0, 0.2], rightUpperArm: [-1, 0, -0.2], leftLowerArm: [-0.9, 0, -0.75 + open], rightLowerArm: [-0.9, 0, 0.75 - open] } };
        },
    },
    fight_idle: { id: "fight_idle", label: "格斗架势", duration: 3, loop: true, layer: "full", sample: (t) => ({ bones: { ...fightStance, chest: [0.04 * wave(t, 1.2), 0, 0] } }) },
    punch: {
        id: "punch",
        label: "出拳",
        duration: 2,
        loop: true,
        layer: "full",
        sample: (t) => {
            const hit = pulse(t, 1.2);
            return { bones: { ...fightStance, rightUpperArm: [-0.55 - 0.95 * hit, 0, -0.3 + 0.25 * hit], rightLowerArm: [-2 + 1.9 * hit, 0, 0], spine: [0.1, 0.25 - 0.5 * hit, 0] } };
        },
    },
    jump: { id: "jump", label: "跳起", duration: 1.2, loop: false, layer: "full", sample: (t) => previsJumpSample(t) },
    fall: {
        id: "fall",
        label: "倒地",
        duration: 1.6,
        loop: false,
        layer: "full",
        sample: (t) => {
            const k = resolvePrevisKeyframeProgress(Math.min(1, t / 1.1), "smooth");
            return {
                bones: {
                    hips: [-1.5 * k, 0, 0],
                    spine: [0.2 * k, 0, 0],
                    head: [0.3 * k, 0, 0],
                    leftUpperArm: [0, 0, 0.08 + 1.1 * k],
                    rightUpperArm: [0, 0, -0.08 - 1.1 * k],
                    leftUpperLeg: [-0.3 * k, 0, 0.1 * k],
                    rightUpperLeg: [-0.1 * k, 0, -0.1 * k],
                    leftLowerLeg: [0.5 * k, 0, 0],
                },
            };
        },
    },
    cry: {
        id: "cry",
        label: "掩面哭",
        duration: 3,
        loop: true,
        layer: "upper",
        sample: (t) => ({ bones: { head: [0.4, 0, 0], chest: [0.12 + 0.04 * wave(t, 3), 0, 0], leftUpperArm: [-0.55, 0, 0.12], rightUpperArm: [-0.55, 0, -0.12], leftLowerArm: [-2.3, 0, -0.15], rightLowerArm: [-2.3, 0, 0.15] } }),
    },
    cheer: {
        id: "cheer",
        label: "欢呼",
        duration: 2,
        loop: true,
        layer: "upper",
        sample: (t) => ({ bones: { leftUpperArm: [0, 0, 2.6 + 0.15 * wave(t, 2)], rightUpperArm: [0, 0, -2.6 - 0.15 * wave(t, 2)], leftLowerArm: [-0.2, 0, 0], rightLowerArm: [-0.2, 0, 0], head: [-0.2, 0, 0] }, lift: 0.04 * pulse(t, 1) }),
    },
    // 扇巴掌：0~0.45s 右臂向外上方蓄力，0.45~0.62s 横扫到身前，之后慢慢收回。
    slap: {
        id: "slap",
        label: "扇巴掌",
        duration: 1.4,
        loop: false,
        layer: "upper",
        sample: (t) => {
            const wind = resolvePrevisKeyframeProgress(Math.min(1, t / 0.45), "smooth");
            const hit = resolvePrevisKeyframeProgress(Math.max(0, Math.min(1, (t - 0.45) / 0.17)), "smooth");
            const back = resolvePrevisKeyframeProgress(Math.max(0, Math.min(1, (t - 0.8) / 0.6)), "smooth");
            const k = (a: number, b: number, c: number) => a + (b - a) * wind + (c - b) * hit - c * back;
            return { bones: { rightUpperArm: [k(0, -0.7, -1.35), k(0, 0.7, -0.55), k(0, -1.45, -0.35)], rightLowerArm: [k(0, -0.7, -0.15), 0, 0], chest: [0, k(0, 0.3, -0.35), 0], spine: [0, k(0, 0.12, -0.15), 0] } };
        },
    },
    // 牵手：靠近对方一侧的手自然垂向斜前方；成人与儿童共用，手臂角度由体型差异自然吻合。
    hold_hand: { id: "hold_hand", label: "牵手", duration: 3, loop: true, layer: "upper", sample: (t) => ({ bones: { rightUpperArm: [-0.32 + 0.04 * wave(t, 0.9), 0, -0.32], rightLowerArm: [-0.25, 0, 0] } }) },
    // 被打：头和胸被扇向一侧后缓缓回正，手下意识抬到脸边。
    hit_react: {
        id: "hit_react",
        label: "被打",
        duration: 1.4,
        loop: false,
        layer: "upper",
        sample: (t) => {
            const snap = resolvePrevisKeyframeProgress(Math.min(1, t / 0.12), "smooth");
            const recover = resolvePrevisKeyframeProgress(Math.max(0, Math.min(1, (t - 0.35) / 1)), "smooth");
            const k = snap * (1 - 0.65 * recover);
            return { bones: { head: [0.08 * k, 0.75 * k, -0.2 * k], neck: [0, 0.25 * k, 0], chest: [0, 0.22 * k, 0], leftUpperArm: [-0.9 * recover * snap, 0, 0.35 * recover * snap], leftLowerArm: [-2 * recover * snap, 0, 0] } };
        },
    },
};

export const PREVIS_MOTION_IDS = Object.keys(PREVIS_MOTIONS) as PrevisMotionId[];

export function previsMotionLabel(id: PrevisMotionId) {
    return PREVIS_MOTIONS[id]?.label ?? id;
}

/**
 * 步态：phase 以「一个完整步幅周期」为 1。run=0 走、1 跑，中间线性过渡。
 * 左腿 rotX = -A·sin(2πp) → p=0.25 时左腿在前；摆动期（大腿向前）屈膝。
 */
export function previsGaitPose(phase: number, run: number): PrevisBonePose {
    const r = Math.max(0, Math.min(1, run));
    const angle = phase * Math.PI * 2;
    const thigh = 0.42 + 0.4 * r;
    const knee = 0.6 + 0.65 * r;
    const arm = 0.32 + 0.4 * r;
    const leftSwing = Math.max(0, Math.cos(angle));
    const rightSwing = Math.max(0, -Math.cos(angle));
    const leftThigh = -thigh * Math.sin(angle);
    const rightThigh = thigh * Math.sin(angle);
    const leftKnee = 0.08 + knee * leftSwing;
    const rightKnee = 0.08 + knee * rightSwing;
    return {
        spine: [0.04 + 0.12 * r, 0.07 * Math.sin(angle), 0],
        chest: [0, -0.06 * Math.sin(angle), 0],
        leftUpperLeg: [leftThigh, 0, 0.02],
        rightUpperLeg: [rightThigh, 0, -0.02],
        leftLowerLeg: [leftKnee, 0, 0],
        rightLowerLeg: [rightKnee, 0, 0],
        // 脚掌大体保持水平，摆动期略勾脚。
        leftFoot: [-0.55 * (leftThigh + leftKnee) * 0.6, 0, 0],
        rightFoot: [-0.55 * (rightThigh + rightKnee) * 0.6, 0, 0],
        leftUpperArm: [arm * Math.sin(angle), 0, 0.08],
        rightUpperArm: [-arm * Math.sin(angle), 0, -0.08],
        leftLowerArm: [-0.25 - 1.05 * r - 0.12 * Math.max(0, Math.sin(angle)), 0, 0],
        rightLowerArm: [-0.25 - 1.05 * r - 0.12 * Math.max(0, -Math.sin(angle)), 0, 0],
    };
}

function previsJumpSample(t: number): MotionSample {
    const crouch = t < 0.3 ? resolvePrevisKeyframeProgress(t / 0.3, "smooth") : t > 0.8 ? 1 - resolvePrevisKeyframeProgress(Math.min(1, (t - 0.8) / 0.4), "smooth") : 0;
    const air = t >= 0.3 && t <= 0.8 ? Math.sin((Math.PI * (t - 0.3)) / 0.5) : 0;
    return {
        bones: {
            spine: [0.3 * crouch, 0, 0],
            leftUpperLeg: [-0.9 * crouch - 0.3 * air, 0, 0.05],
            rightUpperLeg: [-0.9 * crouch - 0.3 * air, 0, -0.05],
            leftLowerLeg: [1.5 * crouch + 0.5 * air, 0, 0],
            rightLowerLeg: [1.5 * crouch + 0.5 * air, 0, 0],
            leftFoot: [-0.5 * crouch, 0, 0],
            rightFoot: [-0.5 * crouch, 0, 0],
            leftUpperArm: [0.4 * crouch, 0, 0.08 + 2.2 * air],
            rightUpperArm: [0.4 * crouch, 0, -0.08 - 2.2 * air],
        },
        lift: 0.45 * air,
    };
}

const MOTION_FADE = 0.2;

/** 动作片段在 time 的权重：前后各 0.2s 淡入淡出；非循环片段播放完停在末帧直到片段结束。 */
export function previsMotionWeight(motion: Pick<PrevisActorMotion, "start" | "duration">, time: number) {
    const local = time - motion.start;
    if (!(motion.duration > 0) || local < 0 || local > motion.duration) return 0;
    const fade = Math.min(MOTION_FADE, motion.duration / 2);
    return Math.min(1, local / fade, (motion.duration - local) / fade);
}

/**
 * 按位移累计路程：关键帧之间位置是 lerp(a, b, easing(progress))，
 * 段内路程 = |b-a|·easing(progress)，因此可以精确累计，不需要逐帧积分。
 */
export function previsTravelledDistance(keyframes: PrevisKeyframe[], time: number) {
    const sorted = keyframes.filter((item) => Number.isFinite(item.time)).toSorted((a, b) => a.time - b.time);
    let distance = 0;
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const next = sorted[index];
        const [ax, , az] = previous.transform.position;
        const [bx, , bz] = next.transform.position;
        const length = Math.hypot(bx - ax, bz - az);
        if (time >= next.time) {
            distance += length;
            continue;
        }
        if (time > previous.time) distance += length * resolvePrevisKeyframeProgress((time - previous.time) / Math.max(next.time - previous.time, 1e-3), previous.easing);
        break;
    }
    return distance;
}

/** 瞬时水平速度（m/s）。 */
export function previsHorizontalSpeed(keyframes: PrevisKeyframe[], time: number) {
    if (keyframes.length < 2) return 0;
    const h = 0.05;
    return Math.max(0, (previsTravelledDistance(keyframes, time + h) - previsTravelledDistance(keyframes, time - h)) / (2 * h));
}

export type PrevisEvaluatedPose = {
    rotations: Record<PrevisMannequinBone, PrevisQuat>;
    /** 动作片段（跳跃、欢呼）的抬起高度，按身高比例。 */
    lift: number;
    /** 位移段（飞行、御剑、悬浮、跳跃）与路径高度的离地高度（米，地面为 0）。 */
    worldLift: number;
    /** 当前步态信息，供 UI/提示词展示。 */
    locomotion: "still" | "walk" | "run";
};

const tmpEuler = new Euler();
function eulerToQuat(value: PrevisEuler, scale = 1): Quaternion {
    return new Quaternion().setFromEuler(tmpEuler.set(value[0] * scale, value[1] * scale, value[2] * scale));
}

/**
 * 标准人偶在 time 的完整姿态。层叠顺序（低 → 高）：
 * 1. 姿势预设；2. 移动步态（按位移速度自动选走/跑，步频与路程同步，避免滑步）；
 * 3. 动作片段（upper 只覆盖上半身，可叠在走路上）；4. 骨骼静态覆盖；5. 骨骼关键帧。
 * 截图、录制、第二屏与视口共用这一个函数，保证所见即所得。
 */
export function evaluatePrevisActorPose(object: Pick<PrevisObject, "pose" | "keyframes" | "motions" | "boneOverrides" | "boneTracks"> & Partial<Pick<PrevisObject, "travels" | "transform">>, time: number): PrevisEvaluatedPose {
    const base = PREVIS_MANNEQUIN_POSES[object.pose || "stand"] ?? PREVIS_MANNEQUIN_POSES.stand;
    const current = new Map<PrevisMannequinBone, Quaternion>();
    for (const bone of PREVIS_MANNEQUIN_BONES) current.set(bone, base[bone] ? eulerToQuat(base[bone]!) : new Quaternion());

    // 位移段（飞行、御剑、悬浮、跳跃、闪现）：飞行类不迈步，走/跑/冲刺强制对应步态。
    const travel = object.travels?.length ? evaluatePrevisTravel({ travels: object.travels, keyframes: object.keyframes || [], transform: object.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, time) : null;
    const speed = previsHorizontalSpeed(object.keyframes || [], time);
    // 路径高度（关键帧 lift）：离地超过 0.2 米就不再迈步，改为悬空姿态。
    const pathLift = interpolatePrevisKeyframeLift(object.keyframes || [], time);
    const airborne = smoothstep(0.2, 0.6, pathLift);
    const moveWeight = previsTravelSuppressesGait(travel) ? 0 : smoothstep(0.08, 0.45, speed) * (1 - airborne);
    let locomotion: PrevisEvaluatedPose["locomotion"] = "still";
    if (moveWeight > 0) {
        const run = previsTravelGaitRun(travel) ?? smoothstep(2, 2.8, speed);
        locomotion = run > 0.5 ? "run" : "walk";
        // 步幅：走约 1.35m/周期，跑约 2.3m/周期。
        const stride = 1.35 + 0.95 * run;
        const gait = previsGaitPose(previsTravelledDistance(object.keyframes, time) / stride, run);
        for (const bone of PREVIS_MANNEQUIN_BONES) {
            const target = gait[bone];
            if (target) current.get(bone)!.slerp(eulerToQuat(target), moveWeight);
        }
    }

    let lift = 0;
    let worldLift = pathLift;
    if (airborne > 0 && !travel) {
        const floatPose = previsTravelPose({ style: "float", weight: airborne, lift: pathLift, progress: 0, local: time, distance: 0 });
        for (const bone of PREVIS_MANNEQUIN_BONES) {
            const target = floatPose?.[bone];
            if (target) current.get(bone)!.slerp(eulerToQuat(target), airborne);
        }
    }
    if (travel) {
        const travelPose = previsTravelPose(travel);
        if (travelPose && travel.weight > 0) {
            for (const bone of PREVIS_MANNEQUIN_BONES) {
                const target = travelPose[bone];
                if (target) current.get(bone)!.slerp(eulerToQuat(target), travel.weight);
            }
        }
        worldLift = Math.max(worldLift, travel.lift);
    }
    for (const motion of object.motions || []) {
        const definition = PREVIS_MOTIONS[motion.motion];
        const weight = definition ? previsMotionWeight(motion, time) : 0;
        if (!definition || weight <= 0) continue;
        const local = time - motion.start;
        const sample = definition.sample(definition.loop ? local : Math.min(local, definition.duration));
        const intensity = Number.isFinite(motion.intensity) ? Math.max(0, Math.min(2, motion.intensity!)) : 1;
        for (const bone of PREVIS_MANNEQUIN_BONES) {
            const target = sample.bones[bone];
            if (!target || (definition.layer === "upper" && !UPPER_BONES.has(bone))) continue;
            current.get(bone)!.slerp(eulerToQuat(target, intensity), weight);
        }
        lift = Math.max(lift, (sample.lift ?? 0) * weight * intensity);
    }

    const rotations = {} as Record<PrevisMannequinBone, PrevisQuat>;
    for (const bone of PREVIS_MANNEQUIN_BONES) {
        const staged = object.boneOverrides?.[bone] || (current.get(bone)!.toArray() as PrevisQuat);
        const keyframes = object.boneTracks?.find((item) => item.bone === bone)?.keyframes;
        rotations[bone] = keyframes?.length ? interpolatePrevisBoneRotation(staged, keyframes, time) : staged;
    }
    return { rotations, lift, worldLift, locomotion };
}

function smoothstep(edge0: number, edge1: number, value: number) {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** 镜头内的动作是否互相重叠（同层）：UI 用来提示冲突。 */
export function previsMotionsOverlap(motions: PrevisActorMotion[], candidate: Pick<PrevisActorMotion, "start" | "duration" | "motion">, ignoreId?: string) {
    const layer = PREVIS_MOTIONS[candidate.motion]?.layer;
    return motions.some((item) => item.id !== ignoreId && PREVIS_MOTIONS[item.motion]?.layer === layer && item.start < candidate.start + candidate.duration && candidate.start < item.start + item.duration);
}

/** 便于调用方在位移关键帧上判断「此刻是否在移动」，例如提示词里描述走/跑。 */
export function previsActorLocomotionAt(object: Pick<PrevisObject, "transform" | "keyframes">, time: number) {
    const speed = previsHorizontalSpeed(object.keyframes || [], time);
    return { speed, position: interpolatePrevisTransform(object.transform, object.keyframes || [], time).position };
}
