import type { DirectorObject, DirectorVec3 } from "../../../types/director";

export type DirectorFootprint = { width: number; depth: number };
export type DirectorPlacementCandidate = { footprint: DirectorFootprint; position: DirectorVec3 };

/** 摆放最小间隙，保证新对象与既有对象之间肉眼可分。 */
export const DIRECTOR_PLACEMENT_MARGIN = 0.25;
const SEARCH_STEP = 0.75;
const MAX_RINGS = 24;
const SAMPLES_PER_RING = 12;
// 模型导入后被 normalizeModel 缩放到最大边 2，未知尺寸时按此保守占位。
const MODEL_FOOTPRINT = 2;

function baseFootprint(object: Pick<DirectorObject, "kind" | "primitive">): DirectorFootprint {
    if (object.kind === "actor" || object.primitive === "character") return { width: 0.8, depth: 0.8 };
    if (object.kind === "model") return { width: MODEL_FOOTPRINT, depth: MODEL_FOOTPRINT };
    if (object.kind === "billboard" || object.primitive === "plane") return { width: 1.6, depth: 0.3 };
    if (object.primitive === "sphere") return { width: 1.2, depth: 1.2 };
    if (object.primitive === "cylinder") return { width: 1, depth: 1 };
    return { width: 1, depth: 1 };
}

/** XZ 平面占位：只用 scale 的 x/z，取绝对值以容忍负缩放；不参与 Y 判断。 */
export function directorObjectFootprint(object: Pick<DirectorObject, "kind" | "primitive" | "transform">): DirectorFootprint {
    const base = baseFootprint(object);
    const scaleX = Math.abs(object.transform?.scale?.[0] ?? 1);
    const scaleZ = Math.abs(object.transform?.scale?.[2] ?? 1);
    return {
        width: Math.max(0.05, base.width * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1)),
        depth: Math.max(0.05, base.depth * (Number.isFinite(scaleZ) && scaleZ > 0 ? scaleZ : 1)),
    };
}

function overlaps(a: DirectorPlacementCandidate, b: DirectorPlacementCandidate, margin: number) {
    const halfX = (a.footprint.width + b.footprint.width) / 2 + margin;
    const halfZ = (a.footprint.depth + b.footprint.depth) / 2 + margin;
    return Math.abs(a.position[0] - b.position[0]) < halfX && Math.abs(a.position[2] - b.position[2]) < halfZ;
}

/** 确定性 ring 采样：先原位，再逐环外扩；索引顺序固定，便于测试与复现。 */
function candidateOffsets() {
    const offsets: Array<[number, number]> = [[0, 0]];
    for (let ring = 1; ring <= MAX_RINGS; ring += 1) {
        const radius = ring * SEARCH_STEP;
        for (let sample = 0; sample < SAMPLES_PER_RING; sample += 1) {
            const angle = (sample / SAMPLES_PER_RING) * Math.PI * 2;
            offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
        }
    }
    return offsets;
}

/**
 * 为新对象求不与任何既有对象 XZ 占位相交的位置。
 * 只改 X/Z，保留调用方给定的 Y（actor/model 的地面 y、primitive 的 0.5、billboard 的 1.1）。
 * 隐藏对象同样占位；ring 采样耗尽时回退到「所有占位最右边界之外」的确定性位置，
 * 该位置在有限 existing 集合下必然不与任何 AABB 相交。
 */
export function resolveDirectorPlacement(input: { object: Pick<DirectorObject, "kind" | "primitive" | "transform">; existing: Array<Pick<DirectorObject, "kind" | "primitive" | "transform">>; margin?: number }): DirectorVec3 {
    const { object, existing } = input;
    const margin = input.margin ?? DIRECTOR_PLACEMENT_MARGIN;
    const desired = object.transform?.position ?? [0, 0, 0];
    const safeY = Number.isFinite(desired[1]) ? desired[1] : 0;
    const originX = Number.isFinite(desired[0]) ? desired[0] : 0;
    const originZ = Number.isFinite(desired[2]) ? desired[2] : 0;
    const footprint = directorObjectFootprint(object);
    const occupied = existing.flatMap((item) => {
        const position = item.transform?.position;
        const x = Number.isFinite(position?.[0]) ? position![0] : 0;
        const z = Number.isFinite(position?.[2]) ? position![2] : 0;
        return [{ footprint: directorObjectFootprint(item), position: [x, safeY, z] as DirectorVec3 }];
    });
    for (const [offsetX, offsetZ] of candidateOffsets()) {
        const position: DirectorVec3 = [originX + offsetX, safeY, originZ + offsetZ];
        if (!occupied.some((item) => overlaps({ footprint, position }, item, margin))) return position;
    }
    return [clearRightOfAll(occupied, footprint, margin, originX), safeY, originZ];
}

/**
 * 取所有占位的最右边界，再让新对象整体位于其右侧。
 * 因为 |dx| >= halfX + margin 恒成立，overlaps 的 X 条件必然为假，故一定不相交。
 */
function clearRightOfAll(occupied: DirectorPlacementCandidate[], footprint: DirectorFootprint, margin: number, originX: number) {
    const maxRight = occupied.reduce((rightmost, item) => Math.max(rightmost, item.position[0] + item.footprint.width / 2), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(maxRight)) return originX;
    // 额外加一个 margin 抵消浮点误差，保证严格大于 overlaps 的阈值。
    return maxRight + footprint.width / 2 + margin * 2;
}

/** 地面锚点：只有 XZ，Y 恒由构造器决定，绝不从这里流入。 */
export type DirectorGroundPoint = { x: number; z: number };

/**
 * 新增对象时的空间意图。两个来源都可能缺失（尚未移动过 pointer、上下文不可用）。
 * 顺序固定：pointer > orbit target > 对象自身默认 XZ。
 */
export type DirectorPlacementIntent = {
    pointer: DirectorGroundPoint | null;
    orbitTarget: DirectorGroundPoint | null;
};

export const emptyDirectorPlacementIntent: DirectorPlacementIntent = { pointer: null, orbitTarget: null };

/**
 * 归一化任意数值来源为合法地面点：非有限（NaN / ±Infinity）一律判为不可用。
 * 射线与地面平行、相机在平面内、上下文半失效时都会产出这类值，必须在入口挡掉。
 */
export function finiteDirectorGroundPoint(x: unknown, z: unknown): DirectorGroundPoint | null {
    if (typeof x !== "number" || typeof z !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z };
}

/**
 * 按固定优先级选出锚点 XZ，并严格保留 fallback 的 Y。
 * fallback 来自构造器（primitive 0.5 / actor 0 / model 0 / billboard 1.1），
 * 因此「贴地对象不悬空、billboard 不落地」这一语义只依赖构造器，不受指针高度影响。
 *
 * 两个来源都在选择时重新归一化：intent 可能携带结构完整但数值非法的点
 * （NaN / ±Infinity）。若只用 `??` 判空，非法 pointer 会遮蔽合法 orbitTarget，
 * 两者都非法时也无法可靠回退 fallback。
 */
export function resolveDirectorPlacementAnchor(input: { intent: DirectorPlacementIntent | null; fallback: DirectorVec3 }): DirectorVec3 {
    const { intent, fallback } = input;
    const fallbackY = Number.isFinite(fallback?.[1]) ? fallback[1] : 0;
    const pointer = finiteDirectorGroundPoint(intent?.pointer?.x, intent?.pointer?.z);
    const orbitTarget = finiteDirectorGroundPoint(intent?.orbitTarget?.x, intent?.orbitTarget?.z);
    const fallbackPoint = finiteDirectorGroundPoint(fallback?.[0], fallback?.[2]);
    const chosen = pointer ?? orbitTarget ?? fallbackPoint ?? { x: 0, z: 0 };
    return [chosen.x, fallbackY, chosen.z];
}
