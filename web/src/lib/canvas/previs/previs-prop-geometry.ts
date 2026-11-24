import { Box3, Color, DoubleSide, MeshStandardMaterial, type Material } from "three";

import { previsHashString, previsRandom, PrevisPropKit, type PrevisPropMaterialKey, type PrevisPropParams, type PrevisPropPart } from "@/lib/canvas/previs/previs-prop-kit";
import { PREVIS_BASE_PROP_BUILDERS } from "@/lib/canvas/previs/previs-props-base";
import { PREVIS_ANCIENT_PROP_BUILDERS } from "@/lib/canvas/previs/previs-props-ancient";
import { PREVIS_ANCIENT_EXTRA_PROP_BUILDERS } from "@/lib/canvas/previs/previs-props-ancient-2";
import { PREVIS_MODERN_PROP_BUILDERS } from "@/lib/canvas/previs/previs-props-modern";
import { PREVIS_NATURE_PROP_BUILDERS, type PrevisPropBuilder } from "@/lib/canvas/previs/previs-props-nature";

const BUILDERS: Record<string, PrevisPropBuilder> = {
    ...PREVIS_NATURE_PROP_BUILDERS,
    ...PREVIS_ANCIENT_PROP_BUILDERS,
    ...PREVIS_ANCIENT_EXTRA_PROP_BUILDERS,
    ...PREVIS_MODERN_PROP_BUILDERS,
    ...PREVIS_BASE_PROP_BUILDERS,
};

export function hasPrevisPropBuilder(propId: string) {
    return Boolean(BUILDERS[propId]);
}

/** 布景里每种道具最多用这么多种变体，控制实例化的 draw call 数。 */
export const PREVIS_LAYOUT_VARIANTS = 4;

const partsCache = new Map<string, PrevisPropPart[]>();

/** 参数的稳定序列化：键排序，数值保留两位，作为缓存键的一部分。 */
export function previsPropParamsKey(params?: PrevisPropParams) {
    if (!params) return "";
    return Object.keys(params)
        .sort()
        .map((key) => `${key}=${typeof params[key] === "number" ? Number((params[key] as number).toFixed(2)) : params[key]}`)
        .join(",");
}

/**
 * 道具几何体（按材质合并），按 propId+variant+params 缓存，整个会话共享；调用方不得 dispose。
 * 参数化组件拖动滑杆会产生很多中间值，缓存按最近使用淘汰，避免无限增长。
 */
export function buildPrevisPropParts(propId: string, variant = 0, params?: PrevisPropParams): PrevisPropPart[] {
    const key = `${propId}:${variant}:${previsPropParamsKey(params)}`;
    const cached = partsCache.get(key);
    if (cached) {
        partsCache.delete(key);
        partsCache.set(key, cached);
        return cached;
    }
    if (partsCache.size > 400) {
        const oldest = partsCache.keys().next().value as string;
        partsCache.get(oldest)?.forEach((part) => part.geometry.dispose());
        partsCache.delete(oldest);
    }
    const kit = new PrevisPropKit(previsRandom(previsHashString(propId) ^ Math.imul(variant + 1, 0x9e3779b1)), params);
    const builder = BUILDERS[propId];
    if (builder) builder(kit);
    else kit.box("concrete", 1, 1, 1);
    const parts = kit.build();
    partsCache.set(key, parts);
    return parts;
}

export function previsPropPartsBounds(parts: PrevisPropPart[]) {
    const box = new Box3();
    parts.forEach((part) => {
        if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
    });
    return box;
}

type MaterialSpec = { color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; opacity?: number; doubleSide?: boolean };

/** 低饱和的白膜调色：近看有材质区分，远看接近 TapNow 式的灰白模型。 */
const PALETTE: Record<PrevisPropMaterialKey, MaterialSpec> = {
    wall: { color: "#ebe5d9", roughness: 0.92 },
    plaster: { color: "#d9d3c7", roughness: 0.92 },
    wood: { color: "#8a5f42", roughness: 0.8 },
    wood_dark: { color: "#5a3c2b", roughness: 0.82 },
    roof: { color: "#4d5661", roughness: 0.78, doubleSide: true },
    stone: { color: "#9ea2a6", roughness: 0.95 },
    stone_light: { color: "#c9c5bc", roughness: 0.95 },
    brick: { color: "#8f8a84", roughness: 0.95 },
    foliage: { color: "#5f8f4e", roughness: 0.9 },
    foliage_light: { color: "#86ad5f", roughness: 0.9 },
    foliage_dark: { color: "#3f6b44", roughness: 0.9 },
    trunk: { color: "#6b4a33", roughness: 0.9 },
    bloom: { color: "#f2c94c", roughness: 0.8 },
    bloom2: { color: "#fbf7f0", roughness: 0.8 },
    bloom3: { color: "#d9534f", roughness: 0.8 },
    grass: { color: "#7aa65a", roughness: 0.95 },
    soil: { color: "#6e5a45", roughness: 1 },
    water: { color: "#5b8fb0", roughness: 0.12, metalness: 0.1, opacity: 0.88 },
    glass: { color: "#8fa9bd", roughness: 0.12, metalness: 0.55 },
    concrete: { color: "#cdd0d3", roughness: 0.9 },
    concrete_dark: { color: "#8d939a", roughness: 0.88 },
    metal: { color: "#6f767d", roughness: 0.4, metalness: 0.6 },
    accent: { color: "#ffffff", roughness: 0.75 },
    rubber: { color: "#26282b", roughness: 0.85 },
    lamp: { color: "#fff2c4", roughness: 0.4, emissive: "#ffe9b0", emissiveIntensity: 1.1 },
    lantern: { color: "#d23b2a", roughness: 0.6, emissive: "#ff4a2a", emissiveIntensity: 0.7 },
    signal_green: { color: "#3fbf6a", roughness: 0.5, emissive: "#3fbf6a", emissiveIntensity: 0.8 },
    gold: { color: "#c9a24a", roughness: 0.45, metalness: 0.5 },
    red: { color: "#9e3a30", roughness: 0.75 },
    fabric: { color: "#8b6e55", roughness: 0.95 },
    white: { color: "#f4f4f2", roughness: 0.85 },
    asphalt: { color: "#5d6168", roughness: 0.95 },
    sand: { color: "#ddcfae", roughness: 1 },
    road_line: { color: "#f3f1ea", roughness: 0.8 },
    brick_red: { color: "#a8644c", roughness: 0.95 },
};

const materialCache = new Map<string, MeshStandardMaterial>();

/**
 * 共享材质。accent 按颜色区分缓存；instanced=true 时 accent 为白色底，由 instanceColor 着色。
 * 材质随会话常驻（种类有限），不随单个对象卸载释放。
 */
export function previsPropMaterial(key: PrevisPropMaterialKey, accentColor?: string, selected = false): Material {
    const color = key === "accent" ? accentColor || PALETTE.accent.color : PALETTE[key].color;
    const cacheKey = `${key}:${color}:${selected ? 1 : 0}`;
    const cached = materialCache.get(cacheKey);
    if (cached) return cached;
    const spec = PALETTE[key];
    const material = new MeshStandardMaterial({
        color: new Color(color),
        roughness: spec.roughness ?? 0.85,
        metalness: spec.metalness ?? 0,
        emissive: new Color(selected ? "#ffaa00" : spec.emissive || "#000000"),
        emissiveIntensity: selected ? 0.32 : (spec.emissiveIntensity ?? 0),
        transparent: spec.opacity !== undefined,
        opacity: spec.opacity ?? 1,
        side: spec.doubleSide ? DoubleSide : undefined,
    });
    materialCache.set(cacheKey, material);
    return material;
}

const DEFAULT_ACCENT: Record<string, string> = {
    building: "#eeebe5",
    chinese_hall: "#ece4d4",
    room: "#ece8e1",
    tree_cherry: "#f4a7c3",
    flowers: "#e85d8a",
    flower_bed: "#e85d8a",
    potted_plant: "#b5653f",
    lotus_pond: "#f4a7c3",
    ancient_house: "#ece4d4",
    ancient_shop: "#b8392c",
    ancient_courtyard: "#ece4d4",
    paifang: "#9e3a30",
    market_stall: "#d9a441",
    modern_house: "#f1f1ee",
    villa: "#7a3e33",
    apartment: "#e3ddd3",
    shop_front: "#2f7de1",
    bench: "#a0714f",
    bus_stop: "#2f7de1",
    trash_bin: "#3f7f5f",
    car: "#c0392b",
    bus: "#2f7de1",
    bicycle: "#d84949",
    sofa: "#7d8ca3",
    chair: "#a0714f",
    bed: "#c9d6e3",
};

export function defaultPrevisPropColor(propId: string) {
    return DEFAULT_ACCENT[propId] || "#8795a5";
}
