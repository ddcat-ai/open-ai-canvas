import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";
import { AdminStatusBadge } from "./admin-ui";

export function ChannelModelCostSummary({ item }: { item: ChannelModel }) {
    // Cost configuration is independent of the user-facing sale price.
    const tiers = item.priceTiers?.filter((tier) => tier.enabled) || [];
    if (!tiers.length) return <AdminStatusBadge label="未配置成本" tone="warning" />;
    const renderTier = (tier: ChannelModelPriceTier) => (
        <div className="admin-model-cost-tier" key={tier.id}>
            <div className="admin-model-cost-spec">{specificationLabel(tier)}</div>
            <div className="admin-model-cost-value">{costLabel(tier, item.capability)}</div>
        </div>
    );
    return (
        <div className="admin-model-cost-summary">
            {tiers.slice(0, 3).map(renderTier)}
            {tiers.length > 3 ? (
                <details className="admin-model-cost-more">
                    <summary>其余 {tiers.length - 3} 个规格成本</summary>
                    {tiers.slice(3).map(renderTier)}
                </details>
            ) : null}
        </div>
    );
}

function costLabel(tier: ChannelModelPriceTier, capability: ChannelModel["capability"]) {
    const cost = tier.costPricing;
    if (!cost?.configured) return <span className="admin-model-cost-missing">未配置成本</span>;
    const format = (value: number) => (Number.isFinite(value) && value >= 0 ? (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—");
    if (tier.billingMode === "token") {
        if (capability === "video") return `${format(cost.outputTokenPriceMicrocredits)} 积分 / 百万视频 Token`;
        return (
            <>
                <span>
                    输入 {format(cost.inputTokenPriceMicrocredits)} · 输出 {format(cost.outputTokenPriceMicrocredits)} · 缓存 {format(cost.cachedTokenPriceMicrocredits)}
                </span>
                <span className="admin-model-cost-unit">积分 / 百万 Token</span>
            </>
        );
    }
    return `${format(cost.unitPriceMicrocredits)} 积分 / ${tier.billingMode === "per_second" ? "秒" : "次"}`;
}

function specificationLabel(tier: ChannelModelPriceTier) {
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
