import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { paymentTypeLabel } from "../src/pages/admin/payments/payment-method";

test("wallet displays payment methods instead of payment channel names", () => {
    const wallet = readFileSync(new URL("../src/components/layout/workspace-wallet-modal.tsx", import.meta.url), "utf8");

    expect(wallet).toContain("{paymentTypeLabel(provider.payType)}");
    expect(wallet).not.toContain("{provider.name}");
    expect(wallet).not.toContain("支付渠道");
    expect(wallet).toContain("providerId: selectedProvider.id");
    expect(wallet).toContain("onClick={() => setSelectedProviderId(provider.id)}");
});

test("channel display names do not determine payment method labels", () => {
    for (const [payType, label] of [["alipay", "支付宝"], ["wechat", "微信支付"], ["qq", "QQ 钱包"], ["usdt", "USDT"], ["", "未确定"]]) {
        const provider = { name: "易支付", payType };
        expect(paymentTypeLabel(provider.payType)).toBe(label);
        expect(paymentTypeLabel(provider.payType)).not.toBe(provider.name);
    }
});
