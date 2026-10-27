import { nanoid } from "nanoid";

import { previsRandom } from "@/lib/canvas/previs/previs-prop-kit";
import { resolvePrevisCatalogProp, resolvePrevisPropParams, resolvePrevisPropSize } from "@/lib/canvas/previs/previs-prop-catalog";
import type { PrevisObject, PrevisPropParams, PrevisVec3 } from "@/types/previs";

/**
 * 批量排布：把一个道具按一排 / 方阵 / 环形 / 散布复制成 N 个独立对象，每个都能单独再改。
 * 「高低错落」会在层数、高度等参数上做确定性浮动，避免一排楼一模一样。
 * 后端 cloud_agent_previs_array.go 用同一套规则展开 object_array_add，两边改动需同步。
 */
export type PrevisArrayPattern = "line" | "grid" | "ring" | "scatter";
export type PrevisArrayFacing = "same" | "center" | "outward";

export type PrevisArraySpec = {
    pattern: PrevisArrayPattern;
    count: number;
    /** 相邻对象中心距（米）；省略时按道具占地 + 2m。 */
    spacing?: number;
    /** 方阵列数；省略时取 ceil(sqrt(count))。 */
    columns?: number;
    facing: PrevisArrayFacing;
    /** 0–1：参数与造型的浮动幅度。 */
    vary: number;
    seed: number;
};

export const PREVIS_ARRAY_PATTERNS: Array<{ value: PrevisArrayPattern; label: string }> = [
    { value: "line", label: "一排" },
    { value: "grid", label: "方阵" },
    { value: "ring", label: "环形" },
    { value: "scatter", label: "散布" },
];

export const PREVIS_ARRAY_MAX = 60;

/** 会随「高低错落」浮动的数值参数。 */
const VARY_KEYS = new Set(["floors", "tiers", "height", "bays", "steps"]);

export function previsArrayDefaultSpacing(object: Pick<PrevisObject, "propId" | "params" | "transform">) {
    const size = resolvePrevisPropSize(object.propId, object.params) ?? [1, 1, 1];
    return Math.max(size[0] * Math.abs(object.transform.scale[0]), size[2] * Math.abs(object.transform.scale[2])) + 2;
}

/** 相对布局中心的偏移（XZ）。 */
export function previsArrayOffsets(spec: PrevisArraySpec, spacing: number): Array<[number, number]> {
    const count = Math.max(1, Math.min(PREVIS_ARRAY_MAX, Math.round(spec.count)));
    const random = previsRandom(spec.seed ^ 0x2545f491);
    if (spec.pattern === "grid") {
        const columns = Math.max(1, Math.min(count, Math.round(spec.columns ?? Math.ceil(Math.sqrt(count)))));
        const rows = Math.ceil(count / columns);
        return Array.from({ length: count }, (_, index) => [((index % columns) - (columns - 1) / 2) * spacing, (Math.floor(index / columns) - (rows - 1) / 2) * spacing]);
    }
    if (spec.pattern === "ring") {
        const radius = count === 1 ? 0 : Math.max(spacing, (count * spacing) / (Math.PI * 2));
        return Array.from({ length: count }, (_, index) => {
            const angle = (index / count) * Math.PI * 2;
            return [Math.sin(angle) * radius, Math.cos(angle) * radius];
        });
    }
    if (spec.pattern === "scatter") {
        const half = (spacing * Math.sqrt(count) * 1.3) / 2;
        const points: Array<[number, number]> = [];
        for (let attempt = 0; points.length < count && attempt < count * 40; attempt++) {
            const candidate: [number, number] = [(random() * 2 - 1) * half, (random() * 2 - 1) * half];
            if (points.every(([x, z]) => Math.hypot(x - candidate[0], z - candidate[1]) >= spacing * 0.85)) points.push(candidate);
        }
        while (points.length < count) points.push([(points.length - count / 2) * spacing, half + spacing]);
        return points;
    }
    return Array.from({ length: count }, (_, index) => [(index - (count - 1) / 2) * spacing, 0]);
}

function variedParams(propId: string | undefined, params: PrevisPropParams | undefined, vary: number, random: () => number): PrevisPropParams | undefined {
    const defs = resolvePrevisCatalogProp(propId)?.params;
    if (!defs || !params) return params;
    const next = { ...params };
    for (const def of defs) {
        if (def.type !== "number" || !VARY_KEYS.has(def.key)) continue;
        const base = Number(next[def.key]);
        const value = base * (1 + (random() * 2 - 1) * 0.45 * vary);
        next[def.key] = Math.min(def.max, Math.max(def.min, def.step >= 1 ? Math.round(value) : Number(value.toFixed(2))));
    }
    return resolvePrevisPropParams(propId, next);
}

/** 展开为独立对象。position 为排布中心；返回对象的 id 都是新的。 */
export function expandPrevisArray(base: PrevisObject, spec: PrevisArraySpec, center: PrevisVec3 = base.transform.position): PrevisObject[] {
    const spacing = spec.spacing && spec.spacing > 0 ? spec.spacing : previsArrayDefaultSpacing(base);
    const offsets = previsArrayOffsets(spec, spacing);
    const random = previsRandom(spec.seed);
    const vary = Math.min(1, Math.max(0, spec.vary));
    const parametric = Boolean(resolvePrevisCatalogProp(base.propId)?.params);
    return offsets.map(([dx, dz], index) => {
        const yaw = spec.facing === "center" ? Math.atan2(-dx, -dz) : spec.facing === "outward" ? Math.atan2(dx, dz) : base.transform.rotation[1];
        const scaleJitter = parametric ? 1 : 1 + (random() * 2 - 1) * 0.18 * vary;
        const [sx, sy, sz] = base.transform.scale;
        return {
            ...base,
            id: nanoid(),
            name: offsets.length > 1 ? `${base.name} ${index + 1}` : base.name,
            variant: vary > 0 && !parametric ? Math.floor(random() * 8) : base.variant,
            params: vary > 0 ? variedParams(base.propId, base.params, vary, random) : base.params,
            transform: {
                position: [center[0] + dx, center[1], center[2] + dz],
                rotation: [base.transform.rotation[0], dx === 0 && dz === 0 && spec.facing !== "same" ? base.transform.rotation[1] : yaw, base.transform.rotation[2]],
                scale: [sx * scaleJitter, sy * scaleJitter, sz * scaleJitter],
            },
            keyframes: [],
        };
    });
}
