import { describe, expect, test } from "bun:test";

import { assetCategoryLabel, defaultAssetCategoryForKind, normalizeAssetCategory } from "@/lib/asset-category";

describe("asset category contract", () => {
    test("旧服饰、武器和配饰统一迁移为道具", () => {
        expect(normalizeAssetCategory("wardrobe")).toBe("prop");
        expect(normalizeAssetCategory("weapon")).toBe("prop");
        expect(normalizeAssetCategory("accessory")).toBe("prop");
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
