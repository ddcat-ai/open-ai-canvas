import { previsPrimitiveHalfHeight } from "@/lib/canvas/previs/previs-prop-library";
import type { PrevisKeyframe, PrevisObject, PrevisScene, PrevisTransform } from "@/types/previs";

/**
 * 落地规则（演员与道具共用）：
 * - 演员永远站在地面上：位置 Y 锁为 0，身体高度由人偶自身贴地求解；跳跃等腾空由动作片段的 lift 表达。
 * - 其他对象允许手动抬高（放在桌面、挂墙），但底面不允许低于地面（几何体按半高计算）。
 * - 修正同时作用于静态 transform 与 transform 关键帧，避免播放时又掉下去。
 */
export const PREVIS_GROUND_Y = 0;
/** 低于这个高度视为误操作；只校正明显穿地，不干扰贴地小误差。 */
const PREVIS_GROUND_TOLERANCE = 0.005;

export function isPrevisGroundLockedObject(object: Pick<PrevisObject, "kind" | "primitive">) {
    return object.kind === "actor" || object.primitive === "character";
}

/**
 * 对象原点允许的最低高度：中心原点的几何体（box/sphere/cylinder）是半高，
 * 底面正好贴地；模型、背板等原点在底部或无法推断的对象是 0。
 */
function previsGroundFloor(object: Pick<PrevisObject, "kind" | "primitive">, transform: PrevisTransform) {
    return PREVIS_GROUND_Y + (previsPrimitiveHalfHeight({ kind: object.kind, primitive: object.primitive, transform }) ?? 0);
}

function groundTransform(transform: PrevisTransform, locked: boolean, floor: number): PrevisTransform {
    const y = transform.position[1];
    const next = locked ? PREVIS_GROUND_Y : Number.isFinite(y) && y >= floor - PREVIS_GROUND_TOLERANCE ? y : floor;
    if (next === y) return transform;
    return { ...transform, position: [transform.position[0], next, transform.position[2]] };
}

/** 对单个对象应用落地规则；没有变化时返回原引用，便于调用方跳过无意义提交。 */
export function groundPrevisObject(object: PrevisObject): PrevisObject {
    const locked = isPrevisGroundLockedObject(object);
    const transform = groundTransform(object.transform, locked, previsGroundFloor(object, object.transform));
    let keyframesChanged = false;
    const keyframes = object.keyframes.map((keyframe): PrevisKeyframe => {
        const grounded = groundTransform(keyframe.transform, locked, previsGroundFloor(object, keyframe.transform));
        if (grounded === keyframe.transform) return keyframe;
        keyframesChanged = true;
        return { ...keyframe, transform: grounded };
    });
    // 路径点的 Y 是离地高度（演员悬空移动时写进关键帧 lift），只拉回地下的点，不压平。
    const pathChanged = locked && object.motionPath?.points.some((point) => !(point[1] >= PREVIS_GROUND_Y));
    if (transform === object.transform && !keyframesChanged && !pathChanged) return object;
    return {
        ...object,
        transform,
        keyframes: keyframesChanged ? keyframes : object.keyframes,
        motionPath: pathChanged && object.motionPath ? { ...object.motionPath, points: object.motionPath.points.map((point) => [point[0], point[1] >= PREVIS_GROUND_Y ? point[1] : PREVIS_GROUND_Y, point[2]]) } : object.motionPath,
    };
}

/** 打开旧场景时一次性修复：返回修复后的场景与被修正的对象名，便于提示用户。 */
export function groundPrevisScene(scene: PrevisScene): { scene: PrevisScene; fixed: string[] } {
    const fixed: string[] = [];
    const objects = scene.objects.map((object) => {
        const grounded = groundPrevisObject(object);
        if (grounded !== object) fixed.push(object.name);
        return grounded;
    });
    return fixed.length ? { scene: { ...scene, objects }, fixed } : { scene, fixed };
}

/** 「贴地」操作：把对象（任意类型）的底面放回地面。 */
export function dropPrevisObjectToGround(object: PrevisObject): PrevisObject {
    const locked = isPrevisGroundLockedObject(object);
    const drop = (transform: PrevisTransform): PrevisTransform => ({ ...transform, position: [transform.position[0], locked ? PREVIS_GROUND_Y : previsGroundFloor(object, transform), transform.position[2]] });
    return { ...object, transform: drop(object.transform), keyframes: object.keyframes.map((keyframe) => ({ ...keyframe, transform: drop(keyframe.transform) })) };
}
