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
    priceConfigured: true,
    enabled: true,
    priceVersion: 1,
    createdAt: "",
    updatedAt: "",
    costPricing: { configured: true, unitPriceMicrocredits: 1250000, inputTokenPriceMicrocredits: 2000000, outputTokenPriceMicrocredits: 3000000, cachedTokenPriceMicrocredits: 500000 },
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
    priceConfigured: true,
    enabled: true,
    priceVersion: 1,
    priceTiers: [tier],
    createdAt: "",
    updatedAt: "",
};
const render = (tiers: ChannelModelPriceTier[], capability: ChannelModel["capability"] = "image") => renderToStaticMarkup(<ChannelModelCostSummary item={{ ...item, capability, priceTiers: tiers }} />);

test("fixed and per-second costs use costPricing, not the sale price", () => {
    const fixed = render([tier]);
    expect(fixed).toContain("默认规格");
    expect(fixed).toContain("1.25 积分 / 次");
    expect(fixed).not.toContain("99 积分");
    expect(render([{ ...tier, billingMode: "per_second" }])).toContain("1.25 积分 / 秒");
});

test("text token costs include input, output and cached tokens", () => {
    const html = render([{ ...tier, billingMode: "token" }], "text");
    expect(html).toContain("输入 2 · 输出 3 · 缓存 0.5");
    expect(html).toContain("积分 / 百万 Token");
    expect(html).not.toContain("77");
});

test("video token costs use only output video tokens", () => {
    const html = render([{ ...tier, billingMode: "token" }], "video");
    expect(html).toContain("3 积分 / 百万视频 Token");
    expect(html).not.toContain("输入");
});

test("missing and unconfigured costs never fall back to sale prices or zero", () => {
    for (const costPricing of [undefined, { ...tier.costPricing!, configured: false }]) {
        const html = render([{ ...tier, costPricing }]);
        expect(html).toContain("未配置成本");
        expect(html).not.toContain("积分 /");
    }
});

test("explicit free costs remain zero even if sale pricing is unconfigured", () => {
    const html = renderToStaticMarkup(<ChannelModelCostSummary item={{ ...item, priceConfigured: false, priceTiers: [{ ...tier, priceConfigured: false, costPricing: { ...tier.costPricing!, unitPriceMicrocredits: 0 } }] }} />);
    expect(html).toContain("0 积分 / 次");
    expect(html).not.toContain("未配置成本");
});

test("invalid or missing numeric costs are not silently displayed as free", () => {
    for (const unitPriceMicrocredits of [NaN, Infinity, -1, undefined]) {
        const html = render([{ ...tier, costPricing: { ...tier.costPricing!, unitPriceMicrocredits: unitPriceMicrocredits as number } }]);
        expect(html).toContain("— 积分 / 次");
        expect(html).not.toContain("0 积分");
    }
});

test("specification labels prefer canonical selectors and additional tiers remain expandable", () => {
    const html = render(Array.from({ length: 4 }, (_, i) => ({ ...tier, id: String(i), selector: { operation: "image_to_video", vquality: "1080p", videoSeconds: "10" }, resolution: "720p", videoSeconds: 5 })));
    expect(html).toContain("图生视频 / 1080P / 10 秒");
    expect(html).not.toContain("720P");
    expect(html).toContain("<details");
    expect(html).toContain("其余 1 个规格成本");
});

test("disabled tiers are excluded and empty costs are explicit", () => {
    expect(render([{ ...tier, enabled: false }])).toContain("未配置成本");
    expect(render([])).toContain("未配置成本");
});

test("model list uses the cost component without gating it on user prices", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/channel-model-manager.tsx", import.meta.url)).text();
    expect(source).toContain('title: "规格成本价"');
    expect(source).toContain("<ChannelModelCostSummary item={item} />");
    expect(source).not.toContain("billingSummary(item)");
});
