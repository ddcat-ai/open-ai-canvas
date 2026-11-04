import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelModelCostSummary } from "../src/pages/admin/components/channel-model-cost-summary";
import type { ChannelModel, ChannelModelPriceTier } from "../src/services/api/wallet";

const tier: ChannelModelPriceTier = {
    id: "tier",
    channelModelId: "model",
    selector: {},
    selectorKey: "{}",
    resolution: "*",
    videoSeconds: 0,
    providerModelKey: "",
    billingMode: "fixed_request",
    unitPriceMicrocredits: 99000000,
    inputTokenPriceMicrocredits: 88000000,
    outputTokenPriceMicrocredits: 77000000,
    cachedTokenPriceMicrocredits: 66000000,
    cacheWriteTokenPriceMicrocredits: 55000000,
    priceConfigured: true,
    enabled: true,
    priceVersion: 1,
    createdAt: "",
    updatedAt: "",
    costPricing: { configured: true, unitPriceMicrocredits: 1250000, inputTokenPriceMicrocredits: 2000000, outputTokenPriceMicrocredits: 3000000, cachedTokenPriceMicrocredits: 500000, cacheWriteTokenPriceMicrocredits: 750000 },
};
const item: ChannelModel = {
    id: "model",
    channelId: "channel",
    modelKey: "model",
    displayName: "model",
    providerModelKey: "",
    icon: "",
    capability: "image",
    billingMode: "fixed_request",
    unitPriceMicrocredits: 99000000,
    inputTokenPriceMicrocredits: 88000000,
    outputTokenPriceMicrocredits: 77000000,
    cachedTokenPriceMicrocredits: 66000000,
    cacheWriteTokenPriceMicrocredits: 55000000,
    priceConfigured: true,
    enabled: true,
    priceVersion: 1,
    priceTiers: [tier],
    createdAt: "",
    updatedAt: "",
};
const render = (tiers: ChannelModelPriceTier[], capability: ChannelModel["capability"] = "image") => renderToStaticMarkup(<ChannelModelCostSummary item={{ ...item, capability, priceTiers: tiers }} />);

test("fixed and per-second specifications show cost, sale and markup", () => {
    const fixed = render([tier]);
    expect(fixed).toContain("默认规格");
    expect(fixed).toContain("1.25 / 99");
    expect(fixed).toContain("积分 / 次 · 加价 7,820%");
    expect(render([{ ...tier, billingMode: "per_second" }])).toContain("积分 / 秒");
});

test("text token costs include input, output, cache hit and cache write tokens", () => {
    const html = render([{ ...tier, billingMode: "token" }], "text");
    expect(html).toContain("输入 2 / 88");
    expect(html).toContain("输出 3 / 77");
    expect(html).toContain("缓存命中 0.5 / 66");
    expect(html).toContain("缓存写入 0.75 / 55");
    expect(html).toContain("积分 / 百万 Token");
});

test("video token costs use only output video tokens", () => {
    const html = render([{ ...tier, billingMode: "token" }], "video");
    expect(html).toContain("视频 3 / 77");
    expect(html).toContain("积分 / 百万视频 Token");
    expect(html).not.toContain("输入");
});

test("missing and unconfigured costs never fall back to sale prices or zero", () => {
    for (const costPricing of [undefined, { ...tier.costPricing!, configured: false }]) {
        const html = render([{ ...tier, costPricing }]);
        expect(html).toContain("未配置成本");
        expect(html).toContain("未配置成本 / 99");
        expect(html).toContain("加价 —");
    }
});

test("explicit free costs remain zero even if sale pricing is unconfigured", () => {
    const html = renderToStaticMarkup(<ChannelModelCostSummary item={{ ...item, priceConfigured: false, priceTiers: [{ ...tier, priceConfigured: false, costPricing: { ...tier.costPricing!, unitPriceMicrocredits: 0 } }] }} />);
    expect(html).toContain("0 / 未配置售价");
    expect(html).toContain("加价 —");
    expect(html).not.toContain("未配置成本");
});

test("invalid or missing numeric costs are not silently displayed as free", () => {
    for (const unitPriceMicrocredits of [NaN, Infinity, -1, undefined]) {
        const html = render([{ ...tier, costPricing: { ...tier.costPricing!, unitPriceMicrocredits: unitPriceMicrocredits as number } }]);
        expect(html).toContain("— / 99");
        expect(html).toContain("加价 —");
    }
});

test("specification labels prefer canonical selectors and additional tiers remain expandable", () => {
    const html = render(Array.from({ length: 4 }, (_, i) => ({ ...tier, id: String(i), selector: { operation: "image_to_video", vquality: "1080p", videoSeconds: "10" }, resolution: "720p", videoSeconds: 5 })));
    expect(html).toContain("图生视频 / 1080P / 10 秒");
    expect(html).not.toContain("720P");
    expect(html).toContain("<details");
    expect(html).toContain("其余 1 个规格价格");
});

test("disabled tiers are excluded and empty costs are explicit", () => {
    expect(render([{ ...tier, enabled: false }])).toContain("无已启用规格");
    expect(render([])).toContain("无已启用规格");
});

test("model list uses the cost component without gating it on user prices", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/channel-model-manager.tsx", import.meta.url)).text();
    expect(source).toContain('title: "规格成本价 / 销售价 / 加价"');
    expect(source).toContain("<ChannelModelCostSummary item={item} />");
    expect(source).not.toContain("billingSummary(item)");
});

test("zero cost is undefined and losses stay negative", () => {
    expect(render([{ ...tier, unitPriceMicrocredits: 0 }])).toContain("加价 -100%");
    expect(render([{ ...tier, unitPriceMicrocredits: 1_000_000 }])).toContain("加价 -20%");
    expect(render([{ ...tier, costPricing: { ...tier.costPricing!, unitPriceMicrocredits: 0 } }])).toContain("加价 —");
});
