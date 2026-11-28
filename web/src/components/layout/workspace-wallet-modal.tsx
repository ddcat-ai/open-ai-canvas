import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton } from "antd";
import { ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, HardDrive, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import { WalletHistoryRow } from "@/components/layout/workspace-wallet-history-row";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { PaymentOrdersPanel, paymentOrdersQueryKey } from "@/components/payment/payment-orders-panel";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { estimatePaymentCharge, paymentOptionsFromProviders, type PaymentOption } from "@/lib/payment-options";
import { getPaymentSettings, listPaymentProviders, listTopupProducts, type PaymentOrder, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { listMyStorageGrants } from "@/services/api/storage-grants";
import { getWallet, redeemCredits, type WalletHistoryType, type WalletSummary } from "@/services/api/wallet";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

type WalletModalTab = "topup" | "redeem" | "income" | "history" | "orders";

const storageGrantsQueryKey = ["account-storage-grants"] as const;

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const loggedIn = useUserStore((state) => Boolean(state.user));
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [openDetail, setOpenDetail] = useState<WorkspaceWalletOpenDetail>({});

    // 积分关闭时仍要能打开充值页购买存储空间，只是隐藏积分余额、兑换和积分记录。
    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        setOpenDetail(detail);
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/wallet") return;
        const params = new URLSearchParams(search);
        openWorkspaceWallet({
            paymentOrderId: params.get("paymentOrder") || undefined,
            paymentInvalid: params.get("payment") === "invalid",
        });
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    if (!loggedIn) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            creditsEnabled={creditsEnabled}
            initialTab={openDetail.tab}
            initialCategory={openDetail.category}
            pendingPaymentOrderId={openDetail.paymentOrderId}
            paymentInvalid={openDetail.paymentInvalid}
            onClose={() => {
                setOpen(false);
                setOpenDetail({});
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    creditsEnabled = true,
    initialTab,
    initialCategory,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    creditsEnabled?: boolean;
    initialTab?: WalletModalTab;
    initialCategory?: TopupCategory;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [walletResult, setWalletResult] = useState<{ type: WalletHistoryType; data: WalletSummary } | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
    const [usdCnyRate, setUsdCnyRate] = useState("");
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedOptionKey, setSelectedOptionKey] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const requestSequence = useRef(0);
    const storageQuery = useAccountFileStorageUsage(open);
    const grantsQuery = useQuery({ queryKey: storageGrantsQueryKey, queryFn: listMyStorageGrants, enabled: open });
    const storageMeter = accountStorageMeter(storageQuery.data);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedOption = useMemo(() => paymentOptions.find((item) => item.key === selectedOptionKey), [paymentOptions, selectedOptionKey]);
    const activeTab: WalletModalTab = creditsEnabled || tab === "orders" ? tab : "topup";
    const historyType = activeTab === "income" ? "income" : "expenses";
    const wallet = walletResult?.data;
    const historyWallet = walletResult?.type === historyType ? wallet : undefined;

    const reloadWallet = async (targetPage = page, targetType: WalletHistoryType = historyType) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, targetType);
            if (sequence === requestSequence.current) setWalletResult({ type: targetType, data: result });
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : t("account.wallet.loadFailed"));
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    const openHistory = (nextTab: "income" | "history") => {
        setTab(nextTab);
        setPage(1);
        void reloadWallet(1, nextTab === "income" ? "income" : "expenses");
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1, initialTab === "income" ? "income" : "expenses");
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders(), getPaymentSettings()])
            .then(([productResult, providerResult, settingsResult]) => {
                const enabledProducts = productResult.products.filter((item) => item.enabled);
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                const options = paymentOptionsFromProviders(usableProviders);
                setProducts(enabledProducts);
                setPaymentOptions(options);
                setUsdCnyRate(settingsResult.settings.usdCnyRate || "");
                // 从容量入口进入时优先选中存储空间套餐。
                const preferred = enabledProducts.filter((item) => !initialCategory || initialCategory === "all" || item.kind === initialCategory);
                setSelectedProductId((current) =>
                    current && enabledProducts.some((item) => item.id === current) && !initialCategory ? current : preferred.find((item) => item.canPurchase)?.id || enabledProducts.find((item) => item.canPurchase)?.id || "",
                );
                setSelectedOptionKey((current) => (current && options.some((item) => item.key === current) ? current : options[0]?.key || ""));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("account.wallet.configLoadFailed")))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error(t("account.wallet.paymentInvalid"));
    }, [open, paymentInvalid]);

    const announceWalletUpdated = async () => {
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    const announceGranted = async (order: PaymentOrder) => {
        if (order.productKind === "storage") {
            await Promise.all([queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey }), queryClient.invalidateQueries({ queryKey: storageGrantsQueryKey })]);
            return;
        }
        await announceWalletUpdated();
    };

    const payment = usePaymentOrderFlow({ onGranted: announceGranted });

    useEffect(() => {
        if (payment.order) void queryClient.invalidateQueries({ queryKey: paymentOrdersQueryKey });
    }, [payment.order, queryClient]);

    useEffect(() => {
        payment.resetIdempotency();
    }, [selectedProductId, selectedOptionKey]);

    // 换了套餐后，当前支付入口可能因币种无法换算而不可用，改选第一个可用入口。
    useEffect(() => {
        if (!selectedProduct || !paymentOptions.length) return;
        const payable = (option: PaymentOption) => Boolean(estimatePaymentCharge(selectedProduct.amountFen, selectedProduct.currency, option.settlementCurrency, usdCnyRate));
        if (selectedOption && payable(selectedOption)) return;
        const next = paymentOptions.find(payable);
        if (next) setSelectedOptionKey(next.key);
    }, [selectedProduct, paymentOptions, selectedOption, usdCnyRate]);

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        void payment.showOrder(pendingPaymentOrderId);
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(t("account.wallet.redeemCodeInvalid"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success(t("account.wallet.redeemSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.wallet.redeemFailed"));
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedOption) {
            message.error(t("account.wallet.selectRequired"));
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error(t("account.wallet.productUnavailable"));
            return;
        }
        await payment.start(selectedProduct.id, selectedOption.providerId, selectedOption.method);
    };

    // 定位到某类套餐：滚动到分组，并在当前选中项不属于该类时改选该类第一个可买套餐。
    const focusProducts = (kind: TopupProductKind) => {
        setTab("topup");
        setFocusKind(kind);
        setFocusToken((value) => value + 1);
        if (selectedProduct?.kind === kind) return;
        const next = products.find((item) => item.kind === kind && item.canPurchase);
        if (next) setSelectedProductId(next.id);
    };

    const account = wallet?.account;
    const available = account ? account.availableMicrocredits + (account.imageAvailableMicrocredits || 0) + (account.videoAvailableMicrocredits || 0) : 0;
    const reserved = account ? account.reservedMicrocredits + (account.imageReservedMicrocredits || 0) + (account.videoReservedMicrocredits || 0) : 0;
    const hasRestrictedCredits = Boolean(account && ((account.imageAvailableMicrocredits || 0) > 0 || (account.videoAvailableMicrocredits || 0) > 0));
    const totalPages = Math.max(1, Math.ceil((historyWallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(920px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker">
                                <Coins />
                                {creditsEnabled ? t("nav.tools.wallet") : t("account.wallet.topupCenter")}
                            </span>
                            <h2>{creditsEnabled ? t("account.wallet.title") : t("account.wallet.titleStorage")}</h2>
                            <p>{creditsEnabled ? t("account.wallet.description") : t("account.wallet.descriptionStorage")}</p>
                        </div>
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <span>{t("shell.account.availableCredits")}</span>
                                    <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                    <small>
                                        {hasRestrictedCredits && account
                                            ? [
                                                  `通用 ${formatCredits(account.availableMicrocredits, 6)}`,
                                                  (account.imageAvailableMicrocredits || 0) > 0 ? `仅图片 ${formatCredits(account.imageAvailableMicrocredits || 0, 6)}` : null,
                                                  (account.videoAvailableMicrocredits || 0) > 0 ? `仅视频 ${formatCredits(account.videoAvailableMicrocredits || 0, 6)}` : null,
                                              ]
                                                  .filter(Boolean)
                                                  .join(" · ")
                                            : t("account.wallet.reserved", { amount: wallet ? formatCredits(reserved, 6) : "--" })}
                                    </small>
                                </div>
                            ) : null}
                            <button type="button" className="workspace-wallet-balance is-storage" aria-label={t("account.wallet.viewStorage")} onClick={() => focusProducts("storage")}>
                                <span>
                                    <HardDrive className="inline size-3 align-[-1px]" aria-hidden="true" /> {t("account.wallet.storage")}
                                </span>
                                <strong>{storageQuery.data ? `${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "--"}</strong>
                                <span className="wallet-topup-storage-track" aria-hidden="true">
                                    <span style={{ width: `${storageMeter.percent}%` }} />
                                </span>
                                <small>
                                    {storageMeter.state === "read_only"
                                        ? t("account.wallet.storageReadOnly")
                                        : storageMeter.state === "grace"
                                          ? t("account.wallet.storageGrace")
                                          : storageMeter.purchasedLabel
                                            ? t("account.wallet.storagePurchased", { size: storageMeter.purchasedLabel })
                                            : t("account.layout.storage.remaining", { size: storageMeter.remainingLabel })}
                                </small>
                            </button>
                        </div>
                    </header>

                    <div className="workspace-wallet-tabs" role="tablist" aria-label={t("nav.tools.wallet")}>
                        <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                            <WalletCards />
                            {t("account.wallet.tabTopup")}
                        </button>
                        <button type="button" role="tab" aria-selected={activeTab === "orders"} onClick={() => setTab("orders")}>
                            <CreditCard />
                            {t("account.payment.ordersTitle")}
                        </button>
                        {creditsEnabled ? (
                            <>
                                <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                    <TicketCheck />
                                    {t("account.wallet.tabRedeem")}
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "income"} onClick={() => openHistory("income")}>
                                    <Coins />
                                    {t("account.wallet.tabIncome")}
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => openHistory("history")}>
                                    <History />
                                    {t("account.wallet.tabHistory")}
                                </button>
                            </>
                        ) : null}
                    </div>

                    {activeTab === "orders" ? (
                        <PaymentOrdersPanel onOpen={(id) => void payment.showOrder(id)} />
                    ) : activeTab === "topup" ? (
                        <WalletTopupPanel
                            loading={paymentsLoading}
                            products={products}
                            paymentOptions={paymentOptions}
                            usdCnyRate={usdCnyRate}
                            focusKind={focusKind}
                            focusToken={focusToken}
                            selectedProduct={selectedProduct}
                            onSelectProduct={setSelectedProductId}
                            selectedOptionKey={selectedOptionKey}
                            onSelectOption={setSelectedOptionKey}
                            creating={payment.creating}
                            onPay={() => void startPayment()}
                            storageUsage={storageQuery.data}
                            storageGrants={grantsQuery.data?.grants || []}
                            onCleanAssets={() => {
                                onClose();
                                navigate("/assets");
                            }}
                        />
                    ) : activeTab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>{t("account.wallet.redeemTitle")}</h3>
                                        <p>
                                            {t("account.wallet.redeemDescription")}
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    {t("account.wallet.redeemGet")}
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder={t("account.wallet.redeemPlaceholder")} onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        {t("account.wallet.redeemSubmit")}
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>{t(activeTab === "income" ? "account.wallet.tabIncome" : "account.wallet.tabHistory")}</h3>
                                    <p>{t(activeTab === "income" ? "account.wallet.incomeDescription" : "account.wallet.historyDescription")}</p>
                                </div>
                                <Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>
                                    {t("common.refresh")}
                                </Button>
                            </div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>{t("account.wallet.historyLoadFailed")}</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>{t("common.retry")}</Button>
                                    </div>
                                ) : walletLoading && !historyWallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : historyWallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {historyWallet.entries.map((entry) => (
                                            <WalletHistoryRow key={`${entry.type}:${entry.id}`} entry={entry} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>{t(activeTab === "income" ? "account.wallet.incomeEmpty" : "account.wallet.historyEmpty")}</strong>
                                        <span>{t(activeTab === "income" ? "account.wallet.incomeEmptyHint" : "account.wallet.historyEmptyHint")}</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>{t("account.wallet.pageOf", { page, total: totalPages })}</span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label={t("account.layout.pagination.prev")}
                                    onClick={() => {
                                        const next = page - 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronLeft />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || walletLoading}
                                    aria-label={t("account.layout.pagination.next")}
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            {payment.dialog}
        </>
    );
}
