export const ASSET_CATEGORIES = ["character", "environment", "prop", "material", "other", "ark"] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
    character: "角色",
    environment: "场景",
    prop: "道具",
    material: "素材",
    other: "其他",
    ark: "方舟认证",
};

/** 方舟认证分类只由认证结果写入（服务端同样拒绝手动设置），不出现在手动选择列表里。 */
export const ARK_ASSET_CATEGORY: AssetCategory = "ark";

/** 全部业务分类，用于筛选与展示。 */
export const ASSET_CATEGORY_OPTIONS = ASSET_CATEGORIES.map((value) => ({
    value,
    label: ASSET_CATEGORY_LABELS[value],
}));

/** 用户可以手动选择的业务分类（不含方舟认证）。 */
export const ASSET_ASSIGNABLE_CATEGORY_OPTIONS = ASSET_CATEGORY_OPTIONS.filter((option) => option.value !== ARK_ASSET_CATEGORY);

const LEGACY_ASSET_CATEGORY_MAP: Record<string, AssetCategory> = {
    wardrobe: "prop",
    weapon: "prop",
    accessory: "prop",
    style: "material",
};

export function normalizeAssetCategory(value: unknown, fallback: AssetCategory = "other"): AssetCategory {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    if ((ASSET_CATEGORIES as readonly string[]).includes(normalized)) return normalized as AssetCategory;
    return LEGACY_ASSET_CATEGORY_MAP[normalized] || fallback;
}

export function parseAssetCategory(value: unknown): AssetCategory {
    if (typeof value !== "string") throw new Error("素材 category 必须是字符串");
    const normalized = value.trim().toLowerCase();
    if ((ASSET_CATEGORIES as readonly string[]).includes(normalized)) return normalized as AssetCategory;
    const mapped = LEGACY_ASSET_CATEGORY_MAP[normalized];
    if (!mapped) throw new Error("素材 category 无效");
    return mapped;
}

export function defaultAssetCategoryForKind(kind: string): AssetCategory {
    if (kind === "entity") return "character";
    if (kind === "image" || kind === "video" || kind === "audio" || kind === "model") return "material";
    return "other";
}

export function assetCategoryLabel(value: unknown) {
    return ASSET_CATEGORY_LABELS[normalizeAssetCategory(value)];
}
