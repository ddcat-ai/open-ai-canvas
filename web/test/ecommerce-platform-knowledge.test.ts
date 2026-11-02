import { describe, expect, test } from "bun:test";
import { commercePlatformGroups, platforms, commerceAutoRatio } from "../src/pages/ecommerce/catalog";
import { commerceKnowledgeFor, commerceKnowledgePrompt, commercePlatformKnowledge, commercePlatformNoText, commerceRestrictedPhrase } from "../src/pages/ecommerce/platform-knowledge";
import { commercePlatformImageRule, commercePlatformListingMain } from "../src/pages/ecommerce/platform-style";

describe("platform knowledge and listing assets", () => {
    test("every selectable marketplace has a distinct profile", () => {
        expect(commercePlatformKnowledge.profiles).toHaveLength(platforms.length);
        for (const [id] of platforms) expect(commerceKnowledgeFor(id)?.style).toBeTruthy();
        expect(new Set(commercePlatformKnowledge.profiles.map((p) => p.style)).size).toBe(platforms.length);
        expect(commercePlatformGroups.crossBorder).toContain("shein");
        expect(commerceAutoRatio("shein", "main")).toBe("3:4");
    });
    test("main, secondary and social assets have different text constraints", () => {
        expect(commercePlatformNoText("shein", "main")).toBe(true);
        expect(commercePlatformNoText("shein", "secondary")).toBe(false);
        expect(commercePlatformNoText("ebay", "secondary")).toBe(true);
        expect(commercePlatformNoText("tiktok", "main")).toBe(true);
        expect(commercePlatformNoText("tiktok", "social")).toBe(false);
        expect(commercePlatformListingMain("mercado-libre", "main")).toBe(false);
        expect(commercePlatformListingMain("amazon", "main")).toBe(true);
        expect(commercePlatformImageRule("etsy", "main")).toContain("未经编辑");
        expect(commerceKnowledgePrompt("emag", "main")).toContain("待官方后台核实");
    });
    test("risk phrases tolerate fullwidth, separators and invisible characters", () => {
        for (const copy of ["Ｂｅｓｔ　Ｓｅｌｌｅｒ", "FDA\u200b Approved", "全 网 最 低", "No.1"]) expect(commerceRestrictedPhrase(copy)).toBeTruthy();
        expect(commerceRestrictedPhrase("清爽日常穿搭")).toBeUndefined();
        expect(commerceRestrictedPhrase("Model No.10")).toBeUndefined();
    });
});
