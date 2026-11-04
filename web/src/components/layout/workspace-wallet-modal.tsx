import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton } from "antd";
import { ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, HardDrive, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { generationErrorMessage } from "@/lib/generation-error";
import { estimatePaymentCharge, paymentOptionsFromProviders, type PaymentOption } from "@/lib/payment-options";
import { getPaymentSettings, listPaymentProviders, listTopupProducts, type PaymentOrder, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { listMyStorageGrants } from "@/services/api/storage-grants";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

type WalletModalTab = "topup" | "redeem" | "history";

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
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
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
    const activeTab: WalletModalTab = creditsEnabled ? tab : "topup";

    const reloadWallet = async (targetPage = page) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, "all");
            if (sequence === requestSequence.current) setWallet(result);
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : "读取积分账户失败");
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1);
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
            .catch((error) => message.error(error instanceof Error ? error.message : "读取充值配置失败"))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error("支付结果无效，未产生充值");
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
            message.error("请输入完整的 32 位兑换码");
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success("兑换成功，积分已到账");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedOption) {
            message.error("请选择套餐和支付方式");
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error("该套餐当前不可购买，请刷新后重试");
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

    const available = wallet?.account.availableMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(920px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker">
                                <Coins />
                                {creditsEnabled ? "积分中心" : "充值中心"}
                            </span>
                            <h2>{creditsEnabled ? "充值、兑换与消费记录" : "购买存储空间"}</h2>
                            <p>{creditsEnabled ? "补充积分或扩充存储空间，随时查看每一笔收支。" : "扩充素材文件与 Agent 会话附件的总容量。"}</p>
                        </div>
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <span>可用积分</span>
                                    <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                    <small>冻结 {wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--"}</small>
                                </div>
                            ) : null}
                            <button type="button" className="workspace-wallet-balance is-storage" aria-label="查看存储空间套餐" onClick={() => focusProducts("storage")}>
                                <span>
                                    <HardDrive className="inline size-3 align-[-1px]" aria-hidden="true" /> 存储空间
                                </span>
                                <strong>{storageQuery.data ? `${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "--"}</strong>
                                <span className="wallet-topup-storage-track" aria-hidden="true">
                                    <span style={{ width: `${storageMeter.percent}%` }} />
                                </span>
                                <small>
                                    {storageMeter.state === "read_only"
                                        ? "已超额 · 只读"
                                        : storageMeter.state === "grace"
                                          ? "已超额 · 暂停上传"
                                          : storageMeter.purchasedLabel
                                            ? `含已购 ${storageMeter.purchasedLabel}`
                                            : `剩余 ${storageMeter.remainingLabel}`}
                                </small>
                            </button>
                        </div>
                    </header>

                    {creditsEnabled ? (
                        <div className="workspace-wallet-tabs" role="tablist" aria-label="积分中心">
                            <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                                <WalletCards />
                                充值
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                <TicketCheck />
                                兑换
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setTab("history")}>
                                <History />
                                积分消耗历史
                            </button>
                        </div>
                    ) : null}

                    {activeTab === "topup" ? (
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
                                        <h3>兑换码</h3>
                                        <p>
                                            购买后请复制卡密，返回此处兑换。
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    获取兑换码
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder="输入 32 位兑换码" onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        确认兑换
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>积分消耗历史</h3>
                                    <p>包含充值、兑换、生成消费、冻结与退款。</p>
                                </div>
                                <Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>
                                    刷新
                                </Button>
                            </div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>记录加载失败</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>重试</Button>
                                    </div>
                                ) : walletLoading && !wallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : wallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {wallet.entries.map((entry) => (
                                            <WalletLedgerRow key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>还没有积分记录</strong>
                                        <span>完成充值、兑换或生成任务后，记录会显示在这里。</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>
                                    第 {page} / {totalPages} 页
                                </span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label="上一页"
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
                                    aria-label="下一页"
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

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const positive = entry.amountMicrocredits > 0;
    const note = entry.note ? generationErrorMessage(entry.note) : "";
    const title = entry.type === "consume" ? "模型调用" : entry.type === "refund" ? "消费退款" : entry.type === "payment_topup" ? "在线充值" : entry.type === "redeem" ? "兑换码充值" : entry.type === "referral_commission" ? "推广返佣" : note || "积分调整";
    return (
        <article className="workspace-wallet-ledger-row">
            <span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <Coins /> : <CreditCard />}</span>
            <div>
                <strong>{title}</strong>
                <span>{[entry.scene, entry.model, note].filter(Boolean).join(" · ") || "积分账户变动"}</span>
            </div>
            <time>{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
            <b className={positive ? "is-income" : "is-consume"}>
                {positive ? "+" : ""}
                {formatCredits(entry.amountMicrocredits, 6)}
            </b>
        </article>
    );
}
