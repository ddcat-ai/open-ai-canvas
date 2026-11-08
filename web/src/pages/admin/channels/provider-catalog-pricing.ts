import type { ProviderCatalogModel, ProviderCatalogPriceTier, ProviderCatalogProvider } from "@/services/api/provider-catalog";

// 与后端 providercatalog.ApplyMarkup 保持一致：售价 = 成本 × (1 + 加价率)，向上取整到 microcredit。
export function applyMarkup(cost: number, markupPercent: number) {
    if (!Number.isSafeInteger(cost) || cost <= 0) return 0;
    const basisPoints = BigInt(Math.round(markupPercent * 100));
    const numerator = BigInt(cost) * (BigInt(10_000) + basisPoints);
    const quotient = numerator / BigInt(10_000);
    return Number(numerator % BigInt(10_000) === BigInt(0) ? quotient : quotient + BigInt(1));
}

export function validMarkup(value: number | null | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

export function formatCredits(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export type TierPriceLine = { label: string; cost: number; sale: number };

// 列出一个规格档需要展示的价格项；视频 token 只有输出价。
export function tierPriceLines(capability: ProviderCatalogModel["capability"], tier: ProviderCatalogPriceTier, markupPercent: number): TierPriceLine[] {
    if (tier.billingMode !== "token") {
        const unit = tier.billingMode === "per_second" ? "每秒" : "每次";
        const lines = [{ label: unit, cost: tier.costUnitMicrocredits, sale: applyMarkup(tier.costUnitMicrocredits, markupPercent) }];
        if (capability === "video" && tier.billingMode === "per_second" && (tier.costReferenceVideoMicrocredits ?? 0) > 0) {
            const cost = tier.costReferenceVideoMicrocredits!;
            lines[0].label = "无参考视频 / 每秒";
            lines.push({ label: "有参考视频 / 每秒（参考 + 生成时长）", cost, sale: applyMarkup(cost, markupPercent) });
        }
        return lines;
    }
    if (capability === "video") return [{ label: "每百万视频 Token", cost: tier.costOutputMicrocredits, sale: applyMarkup(tier.costOutputMicrocredits, markupPercent) }];
    const lines = [
        { label: "输入 / 百万 Token", cost: tier.costInputMicrocredits },
        { label: "输出 / 百万 Token", cost: tier.costOutputMicrocredits },
    ];
    if (tier.costCachedMicrocredits > 0) lines.push({ label: "缓存 / 百万 Token", cost: tier.costCachedMicrocredits });
    return lines.map((line) => ({ ...line, sale: applyMarkup(line.cost, markupPercent) }));
}

const selectorLabels: Record<string, (value: string) => string> = {
    operation: (value) => ({ text_to_video: "文生", image_to_video: "图生", text_to_image: "文生图", image_to_image: "图生图" })[value] || value,
    vquality: (value) => value,
    videoSeconds: (value) => `${value}s`,
    quality: (value) => value.toUpperCase(),
    resolution: (value) => value.toUpperCase(),
    size: (value) => value,
    videoGenerateAudio: (value) => (value === "true" ? "含音频" : "无音频"),
};

export function tierSpecLabel(tier: ProviderCatalogPriceTier) {
    const parts = Object.entries(tier.selector || {})
        .filter(([, value]) => value && value !== "*")
        .map(([key, value]) => (selectorLabels[key] ? selectorLabels[key](value) : `${key}=${value}`));
    return parts.length ? parts.join(" · ") : "默认规格";
}

export function formatWindow(provider: Pick<ProviderCatalogProvider, "startsAt" | "endsAt" | "permanent">) {
    if (provider.permanent) return "长期推广 · 无到期日";
    const format = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
    return `${format(provider.startsAt)} 至 ${format(provider.endsAt)}`;
}

export function promotionExpiry(provider: Pick<ProviderCatalogProvider, "endsAt" | "permanent">, now = Date.now()) {
    if (provider.permanent) return "持续展示";
    const end = new Date(provider.endsAt);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(end);
    const days = Math.ceil((end.getTime() - now) / 86_400_000);
    return `${date} 到期 · ${days > 0 ? `剩余 ${days} 天` : "已到期"}（北京时间）`;
}

export function matchesProvider(provider: ProviderCatalogProvider, keyword: string) {
    const query = keyword.trim().toLowerCase();
    if (!query) return true;
    const haystack = [provider.name, provider.summary, provider.baseUrl, provider.website, ...provider.models.flatMap((item) => [item.displayName, item.modelKey])].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
}
