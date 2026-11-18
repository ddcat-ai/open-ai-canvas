import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { WalletHistoryRow } from "@/components/layout/workspace-wallet-history-row";
import type { WalletBillingEntry } from "@/services/api/wallet";

const settled: WalletBillingEntry = {
    id: "order-1",
    type: "billing",
    billingOrderId: "order-1",
    billingStatus: "settled",
    reservedMicrocredits: 11_666,
    chargedMicrocredits: 3_904,
    refundedMicrocredits: 7_762,
    model: "deepseek-v4.1-flash-1017",
    scene: "text",
    createdAt: "2026-11-17T10:47:32+08:00",
};

describe("wallet order history", () => {
    test("shows the actual charge and released reservation in one real row", () => {
        const html = renderToStaticMarkup(<WalletHistoryRow entry={settled} />);
        expect(html).toContain("模型调用 · 实际消耗 0.003904 积分");
        expect(html).toContain("原预留 0.011666，未使用的 0.007762 已释放。");
        expect(html).toContain(settled.model!);
        expect(html).not.toContain("消费退款");
        expect(html).not.toContain("+0.007762");
        expect(html.match(/<article/g)).toHaveLength(1);
    });

    test("keeps microcredit precision and zero-cost settlements", () => {
        const tiny = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, reservedMicrocredits: 55, chargedMicrocredits: 5, refundedMicrocredits: 50 }} />);
        expect(tiny).toContain("实际消耗 0.000005 积分");
        expect(tiny).toContain("原预留 0.000055，未使用的 0.00005 已释放。");
        const free = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, reservedMicrocredits: 0, chargedMicrocredits: 0, refundedMicrocredits: 0 }} />);
        expect(free).toContain("实际消耗 0 积分");
        expect(free).not.toContain("待结算");
    });

    test("shows supplemental charges without treating the reservation as final cost", () => {
        const html = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, reservedMicrocredits: 10, chargedMicrocredits: 25, refundedMicrocredits: 0 }} />);
        expect(html).toContain("实际消耗 0.000025 积分");
        expect(html).toContain("原预留 0.00001，另补扣 0.000015 积分。");
    });

    test("distinguishes full returns, pending settlement and review", () => {
        const refunded = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, billingStatus: "refunded", chargedMicrocredits: 0, refundedMicrocredits: 11_666, note: "任务取消" }} />);
        expect(refunded).toContain("已退回 · 未扣费");
        expect(refunded).toContain("未使用的 0.011666 已释放");
        expect(refunded).not.toContain("实际消耗");
        for (const billingStatus of ["reserved", "running", "uncertain"] as const) {
            const html = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, billingStatus, chargedMicrocredits: 0, refundedMicrocredits: 0 }} />);
            expect(html).toContain(billingStatus === "uncertain" ? "费用待核对" : "待结算");
            expect(html).toContain("冻结 0.011666 积分");
            expect(html).not.toContain("实际消耗 0 积分");
            expect(html).not.toContain("已释放");
        }
    });

    test("preserves standalone income and scene-specific titles", () => {
        const income = renderToStaticMarkup(<WalletHistoryRow entry={{ id: "topup", type: "payment_topup", amountMicrocredits: 1_000_000, createdAt: settled.createdAt }} />);
        expect(income).toContain("在线充值");
        expect(income).toContain("+1");
        expect(income).not.toContain("原预留");
        const ark = renderToStaticMarkup(<WalletHistoryRow entry={{ ...settled, scene: "ark_asset_group", note: "角色素材组" }} />);
        expect(ark).toContain("方舟素材组 · 实际消耗");
        expect(ark).toContain("角色素材组");
        expect(ark).not.toContain("模型调用");
    });

    test("identifies the payment channel, redemption and signed admin adjustments", () => {
        const base = { id: "income", createdAt: settled.createdAt, amountMicrocredits: 1_000_000 };
        const topup = renderToStaticMarkup(<WalletHistoryRow entry={{ ...base, type: "payment_topup", paymentProviderId: "wechat-native", paymentProviderName: "微信支付" }} />);
        expect(topup).toContain("在线充值");
        expect(topup).toContain("充值渠道：微信支付");
        expect(topup).toContain("+1");
        const retired = renderToStaticMarkup(<WalletHistoryRow entry={{ ...base, type: "payment_topup", paymentProviderId: "retired-channel" }} />);
        expect(retired).toContain("充值渠道：retired-channel");
        const redeem = renderToStaticMarkup(<WalletHistoryRow entry={{ ...base, type: "redeem" }} />);
        expect(redeem).toContain("兑换码充值");
        for (const type of ["admin_grant", "admin_adjustment"] as const) {
            const amountMicrocredits = type === "admin_grant" ? 1_000_000 : -1_000_000;
            const adjustment = renderToStaticMarkup(<WalletHistoryRow entry={{ ...base, type, amountMicrocredits, note: "人工调整原因" }} />);
            expect(adjustment).toContain("<strong>后台调整</strong>");
            expect(adjustment).toContain("人工调整原因");
            expect(adjustment).toContain(type === "admin_grant" ? "+1" : "-1");
        }
    });
});

test("the real wallet modal separates income and expense histories", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-wallet-modal.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("2 pass");
    expect(output).toContain("0 fail");
}, 30000);
