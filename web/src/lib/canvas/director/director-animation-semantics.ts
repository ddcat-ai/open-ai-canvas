import { Euler, Quaternion } from "three";

import type { DirectorBoneKeyframe, DirectorCamera, DirectorKeyframe, DirectorQuat, DirectorTransform, DirectorVec3 } from "../../../types/director";
import { interpolateDirectorBoneRotation, interpolateDirectorTransform, upsertDirectorKeyframe } from "./director-scene";

// 缩放为 0 时无法用比例表达增量，改用绝对偏移；阈值同时兼顾数值噪声。
const SCALE_EPSILON = 1e-6;

export type DirectorTransformDelta = {
    position: DirectorVec3;
    rotation: DirectorQuat;
    scaleRatio: DirectorVec3;
    scaleOffset: DirectorVec3;
};

export function directorTransformDelta(from: DirectorTransform, to: DirectorTransform): DirectorTransformDelta {
    const fromQuaternion = new Quaternion().setFromEuler(new Euler(...from.rotation));
    const toQuaternion = new Quaternion().setFromEuler(new Euler(...to.rotation));
    const scaleRatio: DirectorVec3 = [1, 1, 1];
    const scaleOffset: DirectorVec3 = [0, 0, 0];
    from.scale.forEach((value, index) => {
        if (Math.abs(value) > SCALE_EPSILON) {
            scaleRatio[index] = to.scale[index] / value;
            return;
        }
        scaleOffset[index] = to.scale[index] - value;
    });
    return {
        position: [to.position[0] - from.position[0], to.position[1] - from.position[1], to.position[2] - from.position[2]],
        rotation: toQuaternion.multiply(fromQuaternion.invert()).toArray() as DirectorQuat,
        scaleRatio,
        scaleOffset,
    };
}

export function applyDirectorTransformDelta(transform: DirectorTransform, delta: DirectorTransformDelta): DirectorTransform {
    const rotated = new Quaternion(...delta.rotation).multiply(new Quaternion().setFromEuler(new Euler(...transform.rotation)));
    return {
        position: transform.position.map((value, index) => value + delta.position[index]) as DirectorVec3,
        rotation: new Euler().setFromQuaternion(rotated).toArray().slice(0, 3) as DirectorVec3,
        scale: transform.scale.map((value, index) => value * delta.scaleRatio[index] + delta.scaleOffset[index]) as DirectorVec3,
    };
}

export function snapDirectorTime(time: number, fps: number) {
    const safeFps = fps > 0 ? fps : 24;
    return Math.max(0, Math.round(time * safeFps) / safeFps);
}

export type DirectorObjectTransformEdit = {
    transform: DirectorTransform;
    keyframes: DirectorKeyframe[];
};

/**
 * 静态与动画语义的唯一入口。
 * autoKey 打开：只写当前吸附播放头上的关键帧，base 与其他关键帧保持不变。
 * autoKey 关闭：把「渲染值 -> 编辑值」的增量整体搬到 base 和所有已有关键帧，
 * 使编辑在存在关键帧时依然可见，且不改变未被编辑场景的既有渲染结果。
 */
export function resolveDirectorObjectTransformEdit(input: { base: DirectorTransform; keyframes: DirectorKeyframe[]; rendered: DirectorTransform; edited: DirectorTransform; autoKey: boolean; time: number }): DirectorObjectTransformEdit {
    const { base, keyframes, rendered, edited, autoKey, time } = input;
    if (autoKey) return { transform: base, keyframes: upsertDirectorKeyframe(keyframes, time, edited) };
    if (!keyframes.length) return { transform: edited, keyframes };
    const delta = directorTransformDelta(rendered, edited);
    return {
        transform: applyDirectorTransformDelta(base, delta),
        keyframes: keyframes.map((keyframe) => ({ ...keyframe, transform: applyDirectorTransformDelta(keyframe.transform, delta) })),
    };
}

export type DirectorBoneLayerInput = {
    /** 有动作片段时由 mixer 求值的当前旋转；无动作时为空。 */
    motion?: DirectorQuat | null;
    /** 静默姿势下的骨骼静置旋转。 */
    rest?: DirectorQuat | null;
    /** 姿势预设相对静置的增量。 */
    poseDelta?: DirectorQuat | null;
    /** 静态骨骼覆盖值。 */
    override?: DirectorQuat | null;
    /** 骨骼关键帧轨道。 */
    keyframes?: DirectorBoneKeyframe[] | null;
    time: number;
};

/**
 * 骨骼求值优先级（低到高）：静置/姿势或动作片段 -> 静态覆盖 -> 骨骼关键帧。
 * 手指骨骼与主干骨骼共用同一规则。
 */
export function resolveDirectorBoneRotation(input: DirectorBoneLayerInput): DirectorQuat | null {
    const motionOrRest = input.motion ? input.motion : input.rest ? (input.poseDelta ? (new Quaternion(...input.rest).multiply(new Quaternion(...input.poseDelta)).toArray() as DirectorQuat) : input.rest) : null;
    const staged = input.override || motionOrRest;
    const keyframes = input.keyframes || [];
    if (!keyframes.length) return input.override || null;
    if (!staged) return interpolateDirectorBoneRotation([0, 0, 0, 1], keyframes, input.time);
    return interpolateDirectorBoneRotation(staged, keyframes, input.time);
}

export type DirectorGestureState = { active: boolean; committed: boolean; transforming: boolean };
export type DirectorGestureEvent = "start" | "commit" | "cancel";

export const directorGestureIdle: DirectorGestureState = { active: false, committed: false, transforming: false };

/**
 * 一次手势只允许一个终态：commit 恰好提交一次，任何终态都必须清掉 transforming，
 * 否则 OrbitControls 会一直停留在禁用状态。
 */
export function reduceDirectorGesture(state: DirectorGestureState, event: DirectorGestureEvent): DirectorGestureState {
    if (event === "start") return { active: true, committed: false, transforming: true };
    if (!state.active) return { ...directorGestureIdle, committed: false };
    if (event === "commit") return { active: false, committed: true, transforming: false };
    return { active: false, committed: false, transforming: false };
}

/**
 * 记录关键帧：取值时间与写入时间是两个不同的量。
 * 取值用 raw playhead（视口真正渲染的时间），写入用 snapped 目的时间。
 */
export function resolveDirectorKeyframeRecord(input: { base: DirectorTransform; keyframes: DirectorKeyframe[]; rawTime: number; snappedTime: number }) {
    const rendered = interpolateDirectorTransform(input.base, input.keyframes, input.rawTime);
    return { time: input.snappedTime, transform: rendered, keyframes: upsertDirectorKeyframe(input.keyframes, input.snappedTime, rendered) };
}

/**
 * 把自由观察相机显式写回实际摄影机。
 *
 * 没有动画轨道时更新基础 transform；已有轨道时写当前播放头关键帧，否则旧关键帧会
 * 继续接管 CAM 取景，让界面提示“已对齐”但画面立即跳回旧位置。
 */
export function resolveDirectorCameraAlignment(camera: DirectorCamera, transform: DirectorTransform, time: number): DirectorCamera {
    if (!camera.keyframes.length) return { ...camera, transform };
    return { ...camera, keyframes: upsertDirectorKeyframe(camera.keyframes, time, transform) };
}

/** 生成运镜只更新首尾帧；保留用户手工添加的中间帧、帧 id 与 easing。 */
export function resolveDirectorCameraMoveKeyframes(keyframes: DirectorKeyframe[], start: DirectorTransform, end: DirectorTransform, duration: number) {
    const endTime = Number.isFinite(duration) && duration > 0 ? duration : 0;
    return upsertDirectorKeyframe(upsertDirectorKeyframe(keyframes, 0, start), endTime, end);
}

/** 播放头按镜头时长循环；非法输入回落 0，长帧也保留越界余量。 */
export function advanceDirectorPlayhead(playhead: number, elapsed: number, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const current = Number.isFinite(playhead) ? playhead : 0;
    const delta = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    return (((current + delta) % duration) + duration) % duration;
}

/**
 * 暂停且相机没有被关键帧驱动时不写相机，避免与用户 Orbit 操作互相抢夺。
 * key 必须包含该 playhead 上真正解算出的 transform，否则「同一 playhead 改关键帧内容」
 * 不会引起重新同步。
 */
export function directorCameraSyncKey(input: { camera?: { id: string; transform: DirectorTransform; target: DirectorVec3; fov: number; near: number; far: number; keyframes: DirectorKeyframe[] } | null; playhead: number; playing: boolean }) {
    const { camera, playhead, playing } = input;
    if (!camera) return null;
    const animated = playing || camera.keyframes.length > 0;
    const resolved = interpolateDirectorTransform(camera.transform, camera.keyframes, playhead);
    const statics = [camera.id, ...resolved.position, ...resolved.rotation, ...resolved.scale, ...camera.target, camera.fov, camera.near, camera.far].join(":");
    return animated ? `${statics}@${playhead.toFixed(4)}` : statics;
}
