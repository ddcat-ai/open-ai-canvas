import { previsPrimitiveHalfHeight } from "@/lib/canvas/previs/previs-prop-library";
import type { PrevisKeyframe, PrevisObject, PrevisScene, PrevisTransform, PrevisVec3 } from "@/types/previs";

/**
 * 落地规则（演员与道具共用）：
 * - 所有对象都允许手动抬高（演员站上桌面、台阶、屋顶，道具放在桌面、挂墙），但不允许低于地面。
 * - 演员原点在脚底，Y 就是脚底离地高度；人偶在自身原点上贴地求解，跳跃等腾空由动作片段的 lift 叠加。
 * - 中心原点的几何体（box/sphere/cylinder）按半高计算下限，底面正好贴地。
 * - 修正同时作用于静态 transform、transform 关键帧和演员走位路径，避免播放时又掉下去。
 */
export const PREVIS_GROUND_Y = 0;
/** 低于这个高度视为误操作；只校正明显穿地，不干扰贴地小误差。 */
const PREVIS_GROUND_TOLERANCE = 0.005;

/** 演员（含旧 character）保持直立：gizmo 旋转只允许绕 Y 转身，高度不受限制。 */
export function isPrevisUprightObject(object: Pick<PrevisObject, "kind" | "primitive">) {
    return object.kind === "actor" || object.primitive === "character";
}

/**
 * 对象原点允许的最低高度：中心原点的几何体（box/sphere/cylinder）是半高，
 * 底面正好贴地；演员、模型、背板等原点在底部或无法推断的对象是 0。
 */
function previsGroundFloor(object: Pick<PrevisObject, "kind" | "primitive">, transform: PrevisTransform) {
    return PREVIS_GROUND_Y + (previsPrimitiveHalfHeight({ kind: object.kind, primitive: object.primitive, transform }) ?? 0);
}

function clampAboveFloor(y: number, floor: number) {
    return Number.isFinite(y) && y >= floor - PREVIS_GROUND_TOLERANCE ? y : floor;
}

function groundTransform(transform: PrevisTransform, floor: number): PrevisTransform {
    const y = transform.position[1];
    const next = clampAboveFloor(y, floor);
    if (next === y) return transform;
    return { ...transform, position: [transform.position[0], next, transform.position[2]] };
}

/** 对单个对象应用落地规则；没有变化时返回原引用，便于调用方跳过无意义提交。 */
export function groundPrevisObject(object: PrevisObject): PrevisObject {
    const transform = groundTransform(object.transform, previsGroundFloor(object, object.transform));
    let keyframesChanged = false;
    const keyframes = object.keyframes.map((keyframe): PrevisKeyframe => {
        const grounded = groundTransform(keyframe.transform, previsGroundFloor(object, keyframe.transform));
        if (grounded === keyframe.transform) return keyframe;
        keyframesChanged = true;
        return { ...keyframe, transform: grounded };
    });
    // 走位路径点就是演员脚底位置，下限同样是地面；道具路径保持原样。
    const groundPath = isPrevisUprightObject(object) && object.motionPath;
    const pathChanged = Boolean(groundPath && groundPath.points.some((point) => clampAboveFloor(point[1], PREVIS_GROUND_Y) !== point[1]));
    if (transform === object.transform && !keyframesChanged && !pathChanged) return object;
    return {
        ...object,
        transform,
        keyframes: keyframesChanged ? keyframes : object.keyframes,
        motionPath: pathChanged && object.motionPath ? { ...object.motionPath, points: object.motionPath.points.map((point): PrevisVec3 => [point[0], clampAboveFloor(point[1], PREVIS_GROUND_Y), point[2]]) } : object.motionPath,
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
    const drop = (transform: PrevisTransform): PrevisTransform => ({ ...transform, position: [transform.position[0], previsGroundFloor(object, transform), transform.position[2]] });
    return { ...object, transform: drop(object.transform), keyframes: object.keyframes.map((keyframe) => ({ ...keyframe, transform: drop(keyframe.transform) })) };
}

/** 对象当前底面是否已在地面上，供「贴地」按钮判断是否可点。 */
export function isPrevisObjectOnGround(object: Pick<PrevisObject, "kind" | "primitive">, transform: PrevisTransform) {
    return Math.abs(transform.position[1] - previsGroundFloor(object, transform)) < 0.001;
}
