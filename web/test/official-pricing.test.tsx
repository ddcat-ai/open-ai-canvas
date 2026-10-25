import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotePrice, QuotePriceDetails } from "../src/components/discount-price";
import { defaultPriceTier, priceTierPayloadFromForm, priceTierToForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import { validateChannelModelPrices } from "../src/pages/admin/components/channel-model-editor-form";
import type { ChannelModelPriceTier } from "../src/services/api/wallet";

test("official price survives admin roundtrip without changing sale or cost", () => {
    const draft = { ...defaultPriceTier(), unitPrice: 8, costConfigured: true, costUnitPrice: 5, officialUnitPrice: 10 };
    const payload = priceTierPayloadFromForm("text", draft, "upstream");
    expect(payload.unitPriceMicrocredits).toBe(8_000_000);
    expect(payload.costPricing.unitPriceMicrocredits).toBe(5_000_000);
    expect(payload.officialPricing.unitPriceMicrocredits).toBe(10_000_000);
    expect(priceTierToForm(payload as ChannelModelPriceTier).officialUnitPrice).toBe(10);
    const removed = priceTierPayloadFromForm("text", { ...draft, officialUnitPrice: null }, "upstream");
    expect(removed.officialPricing.configured).toBe(false);
    expect(removed.unitPriceMicrocredits).toBe(8_000_000);
});

test("enterprise extra 9折 shows final 7.2折, not 9折 or a double-discounted amount", () => {
    const quote = { logicalModelId: "", billingMode: "fixed_request", quantity: 1, estimated: false, originalAmountMicrocredits: 10_000_000, regularAmountMicrocredits: 8_000_000, amountMicrocredits: 7_200_000, multiplierBasisPoints: 9000, multiplierSource: "user" };
    const html = renderToStaticMarkup(<QuotePrice quote={quote} />);
    expect(html).toContain("7.2 积分");
    expect(html).toContain("专属7.2折");
    expect(html).not.toContain("专属9折");
    const regular = renderToStaticMarkup(<QuotePrice quote={{ ...quote, amountMicrocredits: 8_000_000, multiplierBasisPoints: 10000, multiplierSource: "sale" }} />);
    expect(regular).toContain("8折");
    const absent = renderToStaticMarkup(<QuotePrice quote={{ ...quote, originalAmountMicrocredits: undefined }} />);
    expect(absent).not.toContain("<s ");
    expect(renderToStaticMarkup(<QuotePriceDetails quote={{ ...quote, originalAmountMicrocredits: undefined }} />)).toContain("查看费用明细");
});

test("official token prices preserve units and reject incomplete values", () => {
    const tier = { ...defaultPriceTier(), billingMode: "token" as const, officialInputTokenPrice: 10, officialOutputTokenPrice: 20, officialCachedTokenPrice: 0 };
    const values = { capability: "text" as const, protocol: "chat-completion" as const, priceTiers: [tier] };
    const payload = priceTierPayloadFromForm("text", tier, "upstream");
    expect(payload.officialPricing).toEqual({ configured: true, unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 10_000_000, outputTokenPriceMicrocredits: 20_000_000, cachedTokenPriceMicrocredits: 0 });
    expect(() => validateChannelModelPrices({ ...values, priceTiers: [{ ...tier, officialOutputTokenPrice: undefined }] })).toThrow();
    const video = priceTierPayloadFromForm("video", tier, "upstream");
    expect(video.officialPricing.inputTokenPriceMicrocredits).toBe(0);
    expect(video.officialPricing.cachedTokenPriceMicrocredits).toBe(0);
    expect(video.officialPricing.outputTokenPriceMicrocredits).toBe(20_000_000);
});
