import type { ChannelModel, ChannelModelPriceTier, ChannelModelRepriceInput } from "@/services/api/wallet";

const validPrice = (value: number | undefined): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function formatModelPrice(value: number | undefined) {
    return validPrice(value) ? (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

export function formatModelMargin(cost: number | undefined, sale: number | undefined) {
    if (!validPrice(cost) || !validPrice(sale) || sale === 0) return "—";
    return `${(((sale - cost) * 100) / sale).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

export function modelPriceFields(tier: ChannelModelPriceTier, capability: ChannelModel["capability"]) {
    if (tier.billingMode !== "token") return [{ key: "unitPriceMicrocredits" as const, label: "", unit: tier.billingMode === "per_second" ? "秒" : "次" }];
    if (capability === "video") return [{ key: "outputTokenPriceMicrocredits" as const, label: "视频", unit: "百万视频 Token" }];
    return [
        { key: "inputTokenPriceMicrocredits" as const, label: "输入", unit: "百万 Token" },
        { key: "outputTokenPriceMicrocredits" as const, label: "输出", unit: "百万 Token" },
        { key: "cachedTokenPriceMicrocredits" as const, label: "缓存", unit: "百万 Token" },
    ];
}

export function previewModelRepricing(items: ChannelModel[], marginPercent: number | null, decimalPlaces = 2): ChannelModel[] {
    if (marginPercent === null || !Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 99.99 || Math.abs(marginPercent * 100 - Math.round(marginPercent * 100)) > 1e-8) {
        throw new Error("请输入 0% 到 99.99% 的目标利润率，最多两位小数");
    }
    if (!items.length || items.length > 100) throw new Error("请选择 1 到 100 个模型");
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) throw new Error("请选择保留 0 到 6 位小数");
    const denominator = BigInt(10_000 - Math.round(marginPercent * 100));
    const quantum = BigInt(10 ** (6 - decimalPlaces));
    return items.map((item) => {
        if (!item.priceTiers.some((tier) => tier.enabled)) throw new Error(`${item.displayName || item.modelKey} 没有已启用规格`);
        return {
            ...item,
            priceTiers: item.priceTiers.map((tier) => {
                if (!tier.enabled) return tier;
                const name = `${item.displayName || item.modelKey}（${tier.selectorKey}）`;
                if (!tier.id || !tier.priceConfigured || !tier.costPricing?.configured) throw new Error(`${name}：请先保存完整的规格成本价和销售价配置`);
                const next = { ...tier };
                for (const { key } of modelPriceFields(tier, item.capability)) {
                    const cost = tier.costPricing[key];
                    if (!validPrice(cost) || cost > 1_000_000_000_000) throw new Error(`${name}：成本价无效`);
                    // Round once at the selected credit precision, with exact half-up ties.
                    const numerator = BigInt(cost) * BigInt(10_000);
                    const divisor = denominator * quantum;
                    const sale = Number(((numerator * BigInt(2) + divisor) / (divisor * BigInt(2))) * quantum);
                    if (!validPrice(sale) || (tier.billingMode === "token" && sale > 1_000_000_000_000)) throw new Error(`${name}：调整后售价超过上限`);
                    next[key] = sale;
                }
                return next;
            }),
        };
    });
}

export function saleInputValue(microcredits: number) {
    if (!validPrice(microcredits)) return null;
    const value = BigInt(microcredits);
    return `${value / BigInt(1_000_000)}.${String(value % BigInt(1_000_000)).padStart(6, "0")}`.replace(/\.?0+$/, "");
}

export function parseSaleInput(value: string | null) {
    if (value === null || !/^\d+(?:\.\d{0,6})?$/.test(value)) throw new Error("销售价须为非负数，最多保留 6 位小数");
    const [integer, fraction = ""] = value.split(".");
    const amount = Number(BigInt(integer) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0")));
    if (!validPrice(amount)) throw new Error("销售价超出有效范围");
    return amount;
}

export type ModelRepriceRow = {
    key: string;
    model: ChannelModel;
    tier: ChannelModelPriceTier;
    field: ReturnType<typeof modelPriceFields>[number];
    sale: string | null;
    manual: boolean;
};

export function modelRepriceRows(items: ChannelModel[]): ModelRepriceRow[] {
    return items.flatMap((model) =>
        model.priceTiers
            .filter((tier) => tier.enabled)
            .flatMap((tier) =>
                modelPriceFields(tier, model.capability).map((field) => ({
                    key: `${tier.id}:${field.key}`,
                    model,
                    tier,
                    field,
                    sale: tier.priceConfigured ? saleInputValue(tier[field.key]) : null,
                    manual: false,
                })),
            ),
    );
}

export function modelRepricePayload(items: ChannelModel[], rows: ModelRepriceRow[]): ChannelModelRepriceInput[] {
    if (!items.length || items.length > 100) throw new Error("请选择 1 到 100 个模型");
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return items.map((item) => {
        const tiers = item.priceTiers.filter((tier) => tier.enabled);
        if (!tiers.length) throw new Error(`${item.displayName || item.modelKey} 没有已启用规格`);
        return {
            modelId: item.id,
            priceVersion: item.priceVersion,
            priceTiers: tiers.map((tier) => {
                if (!tier.id || !tier.priceConfigured || !tier.costPricing?.configured) throw new Error(`${item.displayName || item.modelKey}：请先配置规格成本价和销售价`);
                const prices: ChannelModelRepriceInput["priceTiers"][number]["prices"] = {};
                for (const { key } of modelPriceFields(tier, item.capability)) {
                    const cost = tier.costPricing[key];
                    if (!validPrice(cost) || cost > 1_000_000_000_000) throw new Error(`${item.displayName || item.modelKey}：成本价无效`);
                    const sale = parseSaleInput(byKey.get(`${tier.id}:${key}`)?.sale ?? null);
                    if (tier.billingMode === "token" && sale > 1_000_000_000_000) throw new Error("Token 售价不能超过 1,000,000 积分");
                    prices[key] = sale;
                }
                return { id: tier.id, priceVersion: tier.priceVersion, prices };
            }),
        };
    });
}
