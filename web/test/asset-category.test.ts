import { describe, expect, test } from "bun:test";

import { ASSET_ASSIGNABLE_CATEGORY_OPTIONS, assetCategoryLabel, defaultAssetCategoryForKind, normalizeAssetCategory, parseAssetCategory } from "@/lib/asset-category";

describe("asset category contract", () => {
    test("服饰与配饰保留独立分类，旧武器仍归入道具", () => {
        expect(normalizeAssetCategory("wardrobe")).toBe("clothing");
        expect(normalizeAssetCategory("weapon")).toBe("prop");
        expect(normalizeAssetCategory("accessory")).toBe("accessory");
    });

    test("六类梳妆素材可以手动分类并往返解析", () => {
        for (const category of ["clothing", "expression", "pose", "accessory", "hairstyle", "facial_features"]) {
            expect(parseAssetCategory(category)).toBe(category);
            expect(ASSET_ASSIGNABLE_CATEGORY_OPTIONS.some((option) => option.value === category)).toBe(true);
        }
        expect(() => parseAssetCategory("invalid")).toThrow();
    });

    test("旧画风迁移为素材，未知值归入其他", () => {
        expect(normalizeAssetCategory("style")).toBe("material");
        expect(normalizeAssetCategory("unknown")).toBe("other");
        expect(assetCategoryLabel("material")).toBe("素材");
    });

    test("未分类媒体默认归入素材", () => {
        expect(defaultAssetCategoryForKind("image")).toBe("material");
        expect(defaultAssetCategoryForKind("video")).toBe("material");
        expect(defaultAssetCategoryForKind("audio")).toBe("material");
        expect(defaultAssetCategoryForKind("text")).toBe("other");
    });
});
