import type { PaymentProvider } from "@/services/api/payments";

/** 充值面板中的一个可选支付入口：渠道本身，或渠道内的一种支付方式。 */
export type PaymentOption = {
    key: string;
    providerId: string;
    method?: string;
    name: string;
    icon?: string;
    settlementCurrency: string;
};

/** 把渠道列表展开成按钮：声明了支付方式的渠道每种方式一个入口，其余渠道一个入口。 */
export function paymentOptionsFromProviders(providers: PaymentProvider[]): PaymentOption[] {
    return providers.flatMap((provider): PaymentOption[] => {
        const settlementCurrency = provider.settlementCurrency || "CNY";
        const methods = provider.methods || [];
        if (!methods.length) return [{ key: provider.id, providerId: provider.id, name: provider.name, icon: provider.icon, settlementCurrency }];
        // 只有一种方式时按钮仍显示方式名称（如“支付宝”），渠道名放在 title 里，避免用户看不出走的是哪种方式。
        return methods.map((method) => ({ key: `${provider.id}:${method.id}`, providerId: provider.id, method: method.id, name: method.name, icon: method.icon, settlementCurrency }));
    });
}

const RATE_SCALE = BigInt(1_000_000);
const ZERO = BigInt(0);
const TWO = BigInt(2);
const MAX_RATE_MICROS = BigInt(10_000) * RATE_SCALE;

/** 与后端 parsePaymentRate 一致：最多 6 位小数、0 < rate ≤ 10000；无效或为空返回 null。 */
export function parsePaymentRateMicros(rate?: string): bigint | null {
    const text = (rate || "").trim();
    const match = /^(\d{1,5})(?:\.(\d{1,6}))?$/.exec(text);
    if (!match) return null;
    const micros = BigInt(match[1]) * RATE_SCALE + BigInt((match[2] || "").padEnd(6, "0") || "0");
    if (micros <= ZERO || micros > MAX_RATE_MICROS) return null;
    return micros;
}

/**
 * 预估渠道实收金额，换算与后端 convertPaymentAmount 相同（四舍五入到分）。
 * 不能换算（缺汇率或币种不支持）时返回 null，调用方应禁用该支付入口；最终金额以订单返回为准。
 */
export function estimatePaymentCharge(amountFen: number, from: string, to: string, rate?: string): { amountFen: number; currency: string } | null {
    if (from === to) return { amountFen, currency: to };
    const micros = parsePaymentRateMicros(rate);
    if (!micros) return null;
    const amount = BigInt(Math.trunc(amountFen));
    let numerator: bigint;
    let denominator: bigint;
    if (from === "USD" && to === "CNY") {
        numerator = amount * micros;
        denominator = RATE_SCALE;
    } else if (from === "CNY" && to === "USD") {
        numerator = amount * RATE_SCALE;
        denominator = micros;
    } else {
        return null;
    }
    const charge = (numerator + denominator / TWO) / denominator;
    if (charge <= ZERO) return null;
    return { amountFen: Number(charge), currency: to };
}
