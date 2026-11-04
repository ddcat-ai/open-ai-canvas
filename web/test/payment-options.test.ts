import { describe, expect, test } from "bun:test";

import { estimatePaymentCharge, parsePaymentRateMicros, paymentOptionsFromProviders } from "@/lib/payment-options";
import type { PaymentProvider } from "@/services/api/payments";

const provider = (overrides: Partial<PaymentProvider>): PaymentProvider => ({
    id: "epay",
    pluginId: "official-payment-epay",
    name: "易支付",
    icon: "assets/icon.svg",
    checkoutMode: "redirect",
    enabled: true,
    pluginEnabled: true,
    configured: true,
    closeAfterMinutes: 10,
    ...overrides,
});

describe("paymentOptionsFromProviders", () => {
    test("expands provider methods into individual options", () => {
        const options = paymentOptionsFromProviders([
            provider({
                settlementCurrency: "CNY",
                methods: [
                    { id: "alipay", name: "支付宝", icon: "brand:alipay" },
                    { id: "wxpay", name: "微信支付" },
                ],
            }),
            provider({ id: "wechat-native", name: "微信支付 Native", icon: "brand:wechat-pay" }),
        ]);
        expect(options.map((item) => item.key)).toEqual(["epay:alipay", "epay:wxpay", "wechat-native"]);
        expect(options[0]).toMatchObject({ providerId: "epay", method: "alipay", name: "支付宝", icon: "brand:alipay", settlementCurrency: "CNY" });
        expect(options[2]).toMatchObject({ providerId: "wechat-native", settlementCurrency: "CNY" });
        expect(options[2].method).toBeUndefined();
    });
});

describe("estimatePaymentCharge", () => {
    test("mirrors backend rounding", () => {
        expect(estimatePaymentCharge(999, "USD", "CNY", "7.2")).toEqual({ amountFen: 7193, currency: "CNY" });
        expect(estimatePaymentCharge(1000, "CNY", "USD", "7.2")).toEqual({ amountFen: 139, currency: "USD" });
        expect(estimatePaymentCharge(100_000_000, "USD", "CNY", "10000")).toEqual({ amountFen: 1_000_000_000_000, currency: "CNY" });
        expect(estimatePaymentCharge(500, "CNY", "CNY")).toEqual({ amountFen: 500, currency: "CNY" });
    });

    test("returns null when conversion is impossible", () => {
        expect(estimatePaymentCharge(999, "USD", "CNY", "")).toBeNull();
        expect(estimatePaymentCharge(1, "CNY", "USD", "10000")).toBeNull();
        expect(estimatePaymentCharge(100, "USD", "EUR", "7")).toBeNull();
    });

    test("parses rates like the backend", () => {
        expect(parsePaymentRateMicros("7.123456")).toBe(BigInt(7_123_456));
        expect(parsePaymentRateMicros("0.000001")).toBe(BigInt(1));
        for (const value of ["0", "1e3", "7.1234567", "10000.1", ".5", "-1"]) expect(parsePaymentRateMicros(value)).toBeNull();
    });
});
