import { expect, test } from "bun:test";

test("wallet link APIs expose user packages and admin configuration", async () => {
    const [payments, plugins] = await Promise.all([Bun.file(new URL("../src/services/api/payments.ts", import.meta.url)).text(), Bun.file(new URL("../src/services/api/plugins.ts", import.meta.url)).text()]);

    expect(payments).toContain('http.get<{ links: WalletLink[] }>("/payments/wallet-links")');
    expect(plugins).toContain("fetchAdminPluginConfiguration");
    expect(plugins).toContain("`/admin/plugins/${encodeURIComponent(id)}/config`");
    expect(plugins).toContain("updateAdminPluginConfiguration");
});

test("plugin management keeps the wallet package settings entry", async () => {
    const [page, settings] = await Promise.all([Bun.file(new URL("../src/pages/admin/plugins/plugins-page.tsx", import.meta.url)).text(), Bun.file(new URL("../src/components/wallet-links-settings.tsx", import.meta.url)).text()]);

    expect(page).toContain("<WalletLinksSettings");
    expect(page).toContain("item.manifest.contributes.walletLinks?.length");
    expect(page).toContain("设置购买入口");
    expect(settings).toContain("添加套餐");
    expect(settings).toContain("购买链接");
    expect(settings).toContain("updateAdminPluginConfiguration");
});

test("wallet shows plugin packages while retaining the official purchase fallback", async () => {
    const wallet = await Bun.file(new URL("../src/components/layout/workspace-wallet-modal.tsx", import.meta.url)).text();

    expect(wallet).toContain("listWalletLinks()");
    expect(wallet).toContain("walletLinks.map((link)");
    expect(wallet).toContain("workspace-wallet-external-product");
    expect(wallet).toContain("redeemPurchaseUrl ? (");
    expect(wallet).toContain("获取兑换码");
});
