import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";
import { AdminStatusBadge } from "./admin-ui";
import { formatModelMargin, formatModelPrice, modelPriceFields } from "./channel-model-pricing";

export function ChannelModelCostSummary({ item }: { item: ChannelModel }) {
    const tiers = item.priceTiers?.filter((tier) => tier.enabled) || [];
    if (!tiers.length) return <AdminStatusBadge label="无已启用规格" tone="warning" />;
    const renderTier = (tier: ChannelModelPriceTier) => (
        <div className="admin-model-cost-tier" key={tier.id}>
            <div className="admin-model-cost-spec">{specificationLabel(tier)}</div>
            <div className="admin-model-cost-value">{priceLabel(tier, item.capability)}</div>
        </div>
    );
    return (
        <div className="admin-model-cost-summary">
            {tiers.slice(0, 3).map(renderTier)}
            {tiers.length > 3 ? (
                <details className="admin-model-cost-more">
                    <summary>其余 {tiers.length - 3} 个规格价格</summary>
                    {tiers.slice(3).map(renderTier)}
                </details>
            ) : null}
        </div>
    );
}

function priceLabel(tier: ChannelModelPriceTier, capability: ChannelModel["capability"]) {
    return modelPriceFields(tier, capability).map(({ key, label, unit }) => {
        const cost = tier.costPricing?.configured ? tier.costPricing[key] : undefined;
        const sale = tier.priceConfigured ? tier[key] : undefined;
        return (
            <div key={key}>
                <span>{label ? `${label} ` : ""}{tier.costPricing?.configured ? formatModelPrice(cost) : "未配置成本"} / {tier.priceConfigured ? formatModelPrice(sale) : "未配置售价"}</span>
                <span className="admin-model-cost-unit">积分 / {unit} · 利润率 {formatModelMargin(cost, sale)}</span>
            </div>
        );
    });
}

export function specificationLabel(tier: ChannelModelPriceTier) {
    const selector = tier.selector || {};
    const specific = (value?: string) => (value && value !== "*" ? value : "");
    const operation = specific(selector.operation);
    const resolution = specific(selector.vquality) || specific(tier.resolution);
    const duration = specific(selector.videoSeconds) || (tier.videoSeconds ? String(tier.videoSeconds) : "");
    const operations: Record<string, string> = { text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", video_to_video: "视频生视频", text_generation: "文本生成" };
    return (
        [
            operation ? operations[operation] || operation : "",
            specific(selector.quality).toUpperCase(),
            specific(selector.size),
            resolution.toUpperCase(),
            duration ? `${duration} 秒` : "",
            specific(selector.imageCount) ? `${selector.imageCount} 张参考图` : "",
            selector.videoGenerateAudio === "true" ? "有声" : selector.videoGenerateAudio === "false" ? "无声" : "",
        ]
            .filter(Boolean)
            .join(" / ") || "默认规格"
    );
}
