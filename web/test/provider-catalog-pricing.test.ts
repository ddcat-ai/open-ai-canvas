import { describe, expect, test } from "bun:test";

import { applyMarkup, matchesProvider, tierPriceLines, tierSpecLabel, validMarkup } from "../src/pages/admin/channels/provider-catalog-pricing";

test("catalog displays separate prices for videos with references", () => {
    const lines = tierPriceLines("video", { billingMode: "per_second", costUnitMicrocredits: 140000, costReferenceVideoMicrocredits: 90000, costInputMicrocredits: 0, costOutputMicrocredits: 0, costCachedMicrocredits: 0 }, 30);
    expect(lines.map((line) => line.sale)).toEqual([182000, 117000]);
    expect(lines[1].label).toContain("参考");
});

describe("provider catalog pricing", () => {
    test("applies markup with ceil like the backend", () => {
        expect(applyMarkup(1_200_000, 30)).toBe(1_560_000);
        expect(applyMarkup(1, 30)).toBe(2);
        expect(applyMarkup(0, 30)).toBe(0);
        expect(applyMarkup(2_000_000, 0)).toBe(2_000_000);
    });

    test("validates markup range and precision", () => {
        expect(validMarkup(30)).toBe(true);
        expect(validMarkup(12.34)).toBe(true);
        expect(validMarkup(12.345)).toBe(false);
        expect(validMarkup(-1)).toBe(false);
        expect(validMarkup(1000.5)).toBe(false);
        expect(validMarkup(null)).toBe(false);
    });

    test("lists token lines per capability", () => {
        const tier = { billingMode: "token" as const, costUnitMicrocredits: 0, costInputMicrocredits: 2_000_000, costOutputMicrocredits: 8_000_000, costCachedMicrocredits: 0 };
        expect(tierPriceLines("text", tier, 50).map((line) => line.sale)).toEqual([3_000_000, 12_000_000]);
        expect(tierPriceLines("video", tier, 0)).toHaveLength(1);
    });

    test("labels selectors and matches search", () => {
        expect(tierSpecLabel({ billingMode: "fixed_request", selector: { operation: "text_to_video", vquality: "1080p", videoSeconds: "5" }, costUnitMicrocredits: 1, costInputMicrocredits: 0, costOutputMicrocredits: 0, costCachedMicrocredits: 0 })).toBe(
            "文生 · 1080p · 5s",
        );
        const provider = { name: "Acme", baseUrl: "https://api.acme.example", models: [{ displayName: "Seedance Pro", modelKey: "seedance-pro" }] } as never;
        expect(matchesProvider(provider, "seedance")).toBe(true);
        expect(matchesProvider(provider, "kimi")).toBe(false);
    });
});
