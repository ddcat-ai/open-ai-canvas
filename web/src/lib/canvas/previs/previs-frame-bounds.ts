import { Vector3 } from "three";

import { previsMannequinExtents, resolvePrevisMannequinProfile } from "@/lib/canvas/previs/previs-mannequin";
import { resolvePrevisPropSize } from "@/lib/canvas/previs/previs-prop-catalog";
import type { PrevisObject } from "@/types/previs";

export type PrevisFrameBounds = {
    min: Vector3;
    max: Vector3;
    span: Vector3;
    target: Vector3;
    fitDistance: number;
};

/** Smallest orbit distance allowed regardless of scene contents. */
export const PREVIS_MIN_ORBIT_DISTANCE = 0.7;

/** 单个对象的近似世界包围盒；演员按体积而不是原点计算，避免相机推进到身体内部。 */
export function resolvePrevisObjectBox(object: PrevisObject): { min: Vector3; max: Vector3 } {
    const [x, y, z] = object.transform.position;
    const [sx, sy, sz] = object.transform.scale;
    const actor = object.kind === "actor" || object.primitive === "character";
    if (actor) {
        // 与标准人偶实际尺寸一致（成人约 1.83m）；坐/蹲降低，留出手臂伸展的余量。
        const profile = resolvePrevisMannequinProfile(object.archetype || "adult", object.actorProfile);
        const extents = previsMannequinExtents(profile);
        const lowered = object.pose === "sit" || object.pose === "squat" || object.pose === "kneel_double" ? 0.68 : 1;
        const height = extents.height * lowered * Math.max(0.1, Math.abs(sy));
        const halfWidth = Math.max(extents.halfWidth, 0.35 * profile.height) * Math.max(0.1, Math.abs(sx));
        const halfDepth = Math.max(extents.halfDepth, 0.3 * profile.height) * Math.max(0.1, Math.abs(sz));
        return { min: new Vector3(x - halfWidth, y, z - halfDepth), max: new Vector3(x + halfWidth, y + height, z + halfDepth) };
    }
    // 目录道具与布景的原点在底面中心，按目录尺寸 / 布景边长求包围盒。
    const catalogSize = object.kind === "prop" ? resolvePrevisPropSize(object.propId, object.params) : object.kind === "layout" && object.layout ? ([object.layout.size, 18, object.layout.size] as const) : undefined;
    if (catalogSize) {
        const halfX = (catalogSize[0] / 2) * Math.max(0.1, Math.abs(sx));
        const halfZ = (catalogSize[2] / 2) * Math.max(0.1, Math.abs(sz));
        // 布景按地面范围取景，高度只取较矮的参考值，避免整城取景距离被高楼拉得过远。
        return { min: new Vector3(x - halfX, y, z - halfZ), max: new Vector3(x + halfX, y + catalogSize[1] * Math.max(0.1, Math.abs(sy)), z + halfZ) };
    }
    const primitiveBounds: [number, number, number] = object.primitive === "sphere" ? [0.6, 0.6, 0.6] : object.primitive === "cylinder" ? [0.55, 0.8, 0.55] : object.primitive === "plane" ? [1.2, 0.05, 1.2] : [0.6, 0.6, 0.6];
    const half = new Vector3(primitiveBounds[0] * Math.max(0.1, Math.abs(sx)), primitiveBounds[1] * Math.max(0.1, Math.abs(sy)), primitiveBounds[2] * Math.max(0.1, Math.abs(sz)));
    return { min: new Vector3(x, y, z).sub(half), max: new Vector3(x, y, z).add(half) };
}

/**
 * 缩放的最近距离：相机不得进入包含环绕目标的对象体积（否则背面剔除让身体消失、只剩地面阴影）。
 * 只看包含目标的对象，大场景里推近其它区域不受整体尺寸限制。
 */
export function resolvePrevisZoomMinDistance(objects: PrevisObject[], target: Vector3): number {
    let minDistance = PREVIS_MIN_ORBIT_DISTANCE;
    const margin = 0.15;
    objects.forEach((object) => {
        // 布景是一整片地面区域，相机本来就要进到里面去拍。
        if (!object.visible || object.primitive === "plane" || object.kind === "layout") return;
        const box = resolvePrevisObjectBox(object);
        const contains = target.x >= box.min.x - margin && target.x <= box.max.x + margin && target.y >= box.min.y - margin && target.y <= box.max.y + margin && target.z >= box.min.z - margin && target.z <= box.max.z + margin;
        if (!contains) return;
        // 目标到盒子最远角的距离 + 近裁剪余量，保证整个体积都在相机前方。
        const farthest = new Vector3(Math.max(target.x - box.min.x, box.max.x - target.x), Math.max(target.y - box.min.y, box.max.y - target.y), Math.max(target.z - box.min.z, box.max.z - target.z));
        minDistance = Math.max(minDistance, farthest.length() + 0.35);
    });
    return minDistance;
}

/** 首次取景的默认留白倍数；只框一个非演员主体时收紧一些，主体不至于显得太小。 */
export const PREVIS_INITIAL_FRAME_PADDING = 1.18;
export const PREVIS_INITIAL_SINGLE_SUBJECT_PADDING = 1.05;

/**
 * 首次取景对准谁：有可见演员时只框演员；没有演员时排除背景板、地面这类平面（它们会撑大包围盒，
 * 让产品主体显得很小），排除后为空则框全部可见对象（ids 为 undefined）。
 */
export function resolvePrevisInitialFrame(objects: PrevisObject[]): { ids?: Set<string>; padding: number } {
    const visible = objects.filter((object) => object.visible);
    const actors = visible.filter((object) => object.kind === "actor" || object.primitive === "character");
    if (actors.length) return { ids: new Set(actors.map((object) => object.id)), padding: PREVIS_INITIAL_FRAME_PADDING };
    const subjects = visible.filter((object) => object.primitive !== "plane");
    if (!subjects.length) return { padding: PREVIS_INITIAL_FRAME_PADDING };
    return { ids: new Set(subjects.map((object) => object.id)), padding: subjects.length === 1 ? PREVIS_INITIAL_SINGLE_SUBJECT_PADDING : PREVIS_INITIAL_FRAME_PADDING };
}

/** 可见对象（可选限定 ids）的联合包围盒，以及在给定 aspect/fov 下完整入画所需的距离。 */
export function resolvePrevisFrameBounds(objects: PrevisObject[], ids?: Set<string>, aspect = 1, fov = 50): PrevisFrameBounds | null {
    const visible = objects.filter((object) => object.visible && (!ids || ids.has(object.id)));
    if (!visible.length) return null;

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    visible.forEach((object) => {
        const box = resolvePrevisObjectBox(object);
        min.min(box.min);
        max.max(box.max);
    });

    const target = min.clone().add(max).multiplyScalar(0.5);
    const span = max.clone().sub(min);
    const verticalHalfFov = (Math.max(1, fov) * Math.PI) / 360;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.1, aspect));
    const fitDistance = Math.max(span.y / 2 / Math.tan(verticalHalfFov), Math.max(span.x, span.z) / 2 / Math.tan(horizontalHalfFov)) * 1.08;
    return { min, max, span, target, fitDistance };
}
