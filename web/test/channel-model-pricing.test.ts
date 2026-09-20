import { expect, test } from "bun:test";
import { formatModelMargin, previewModelRepricing, modelRepriceRows, modelRepricePayload, parseSaleInput, saleInputValue } from "../src/pages/admin/components/channel-model-pricing";
import type { ChannelModel } from "../src/services/api/wallet";

const item = {
    id: "m",
    displayName: "Model",
    capability: "text",
    priceTiers: [
        {
            id: "t",
            selectorKey: "{}",
            enabled: true,
            priceConfigured: true,
            billingMode: "fixed_request",
            unitPriceMicrocredits: 9,
            inputTokenPriceMicrocredits: 0,
            outputTokenPriceMicrocredits: 0,
            cachedTokenPriceMicrocredits: 0,
            costPricing: { configured: true, unitPriceMicrocredits: 1_000_000, inputTokenPriceMicrocredits: 2_000_000, outputTokenPriceMicrocredits: 4_000_000, cachedTokenPriceMicrocredits: 0 },
        },
    ],
} as ChannelModel;

test("20% margin uses cost / 0.8, not markup, and leaves inputs unchanged", () => {
    const result = previewModelRepricing([item], 20);
    expect(result[0]!.priceTiers[0]!.unitPriceMicrocredits).toBe(1_250_000);
    expect(item.priceTiers[0]!.unitPriceMicrocredits).toBe(9);
    expect(result[0]!.priceTiers[0]!.costPricing).toEqual(item.priceTiers[0]!.costPricing);
});

test("token prices are independent and zero costs remain free", () => {
    const token = { ...item, priceTiers: [{ ...item.priceTiers[0]!, billingMode: "token" as const }] };
    const tier = previewModelRepricing([token], 20)[0]!.priceTiers[0]!;
    expect(tier.inputTokenPriceMicrocredits).toBe(2_500_000);
    expect(tier.outputTokenPriceMicrocredits).toBe(5_000_000);
    expect(tier.cachedTokenPriceMicrocredits).toBe(0);
    expect(formatModelMargin(0, 0)).toBe("—");
});

test("video token adjusts only output; per-second adjusts unit price", () => {
    const video = { ...item, capability: "video" as const, priceTiers: [{ ...item.priceTiers[0]!, billingMode: "token" as const }] };
    const tier = previewModelRepricing([video], 20)[0]!.priceTiers[0]!;
    expect(tier.outputTokenPriceMicrocredits).toBe(5_000_000);
    expect(tier.inputTokenPriceMicrocredits).toBe(0);
    video.priceTiers[0]!.billingMode = "per_second";
    expect(previewModelRepricing([video], 20)[0]!.priceTiers[0]!.unitPriceMicrocredits).toBe(1_250_000);
});

test("half-up rounding at microcredit precision and disabled tiers stay untouched", () => {
    const tiny = {
        ...item,
        priceTiers: [
            { ...item.priceTiers[0]!, costPricing: { ...item.priceTiers[0]!.costPricing!, unitPriceMicrocredits: 1 } },
            { ...item.priceTiers[0]!, id: "disabled", enabled: false },
        ],
    };
    const result = previewModelRepricing([tiny], 20, 6)[0]!;
    expect(result.priceTiers[0]!.unitPriceMicrocredits).toBe(1);
    expect(result.priceTiers[1]).toBe(tiny.priceTiers[1]);
    expect(previewModelRepricing([tiny], 0, 6)[0]!.priceTiers[0]!.unitPriceMicrocredits).toBe(1);
});

test("selected decimals round half up exactly, including binary floating point ties", () => {
    for (const [cost, places, expected] of [
        [1_005_000, 2, 1_010_000],
        [1_004_999, 2, 1_000_000],
        [1_500_000, 0, 2_000_000],
        [1_234_500, 3, 1_235_000],
        [5_000, 2, 10_000],
        [4_999, 2, 0],
    ]) {
        const input = { ...item, priceTiers: [{ ...item.priceTiers[0]!, costPricing: { ...item.priceTiers[0]!.costPricing!, unitPriceMicrocredits: cost! } }] };
        expect(previewModelRepricing([input], 0, places)[0]!.priceTiers[0]!.unitPriceMicrocredits).toBe(expected);
    }
    for (const places of [-1, 7, 1.5]) expect(() => previewModelRepricing([item], 20, places)).toThrow();
});

test("rows are present before a percentage is set and final manual prices survive payload creation", () => {
    const input = { ...item, priceVersion: 4, priceTiers: [{ ...item.priceTiers[0]!, priceVersion: 8 }] };
    const initial = modelRepriceRows([input]);
    expect(initial).toHaveLength(1);
    expect(initial[0]!.sale).toBe("0.000009");
    const recalculated = modelRepriceRows(previewModelRepricing([input], 20));
    expect(recalculated[0]!.sale).toBe("1.25");
    recalculated[0]!.sale = "1.37";
    recalculated[0]!.manual = true;
    expect(modelRepricePayload([input], recalculated)).toEqual([{ modelId: "m", priceVersion: 4, priceTiers: [{ id: "t", priceVersion: 8, prices: { unitPriceMicrocredits: 1_370_000 } }] }]);
    expect(modelRepriceRows(previewModelRepricing([input], 50, 2))[0]!.sale).toBe("2");
    expect(modelRepriceRows(previewModelRepricing([input], 20, 0))[0]!.sale).toBe("1");
});

test("manual token edits affect only their own field and invalid input never silently becomes zero", () => {
    const token = { ...item, priceTiers: [{ ...item.priceTiers[0]!, billingMode: "token" as const }] };
    const rows = modelRepriceRows(previewModelRepricing([token], 20));
    rows[1]!.sale = "7.123456";
    const prices = modelRepricePayload([token], rows)[0]!.priceTiers[0]!.prices;
    expect(prices).toEqual({ inputTokenPriceMicrocredits: 2_500_000, outputTokenPriceMicrocredits: 7_123_456, cachedTokenPriceMicrocredits: 0 });
    for (const invalid of [null, "", "-1", "1.1234567", "1e3", "NaN", "9007199254.740992"]) expect(() => parseSaleInput(invalid)).toThrow();
    for (const value of [0, 1, 10_000_000, Number.MAX_SAFE_INTEGER]) expect(parseSaleInput(saleInputValue(value))).toBe(value);
    rows[1]!.sale = null;
    expect(() => modelRepricePayload([token], rows)).toThrow();
});

test("reject invalid rates, incomplete costs, invalid amounts and overflow", () => {
    for (const margin of [null, NaN, Infinity, -1, 100, 20.001]) expect(() => previewModelRepricing([item], margin)).toThrow();
    for (const cost of [undefined, NaN, -1, 1_000_000_000_001]) {
        const invalid = { ...item, priceTiers: [{ ...item.priceTiers[0]!, costPricing: { ...item.priceTiers[0]!.costPricing!, unitPriceMicrocredits: cost as number } }] };
        expect(() => previewModelRepricing([item, invalid], 20)).toThrow();
    }
    expect(() => previewModelRepricing([{ ...item, priceTiers: [] }], 20)).toThrow();
    expect(() => previewModelRepricing([{ ...item, priceTiers: [{ ...item.priceTiers[0]!, costPricing: undefined }] }], 20)).toThrow();
    expect(() => previewModelRepricing([{ ...item, priceTiers: [{ ...item.priceTiers[0]!, priceConfigured: false }] }], 20)).toThrow();
    const huge = { ...item, priceTiers: [{ ...item.priceTiers[0]!, costPricing: { ...item.priceTiers[0]!.costPricing!, unitPriceMicrocredits: 1_000_000_000_000 } }] };
    expect(() => previewModelRepricing([huge], 99.99)).toThrow();
});

test("manager preserves cross-page selection and API uses one atomic request", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/channel-model-manager.tsx", import.meta.url)).text();
    const api = await Bun.file(new URL("../src/services/api/wallet.ts", import.meta.url)).text();
    expect(source).toContain("preserveSelectedRowKeys: true");
    expect(source).toContain("items.filter((item) => selectedModelIds.includes(item.id))");
    expect(source).toContain("统一调价");
    expect(api).toContain("/models/batch-reprice");
});
