import { App, Button, Input, Skeleton } from "antd";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { closePaymentOrder, createPaymentOrder, getPaymentOrder, listPaymentProviders, listTopupProducts, queryPaymentOrder, refreshPaymentCheckout, type PaymentOrder, type PaymentProvider, type TopupProduct } from "@/services/api/payments";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useUserStore } from "@/stores/use-user-store";

type WalletModalTab = "topup" | "history";

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState("");
    const [paymentInvalid, setPaymentInvalid] = useState(false);

    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        if (!useUserStore.getState().features.creditsEnabled) return;
        setPendingPaymentOrderId(detail.paymentOrderId || "");
        setPaymentInvalid(Boolean(detail.paymentInvalid));
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

    if (!creditsEnabled) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            pendingPaymentOrderId={pendingPaymentOrderId}
            paymentInvalid={paymentInvalid}
            onClose={() => {
                setOpen(false);
                setPendingPaymentOrderId("");
                setPaymentInvalid(false);
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { message } = App.useApp();
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const [paymentCreating, setPaymentCreating] = useState(false);
    const [paymentQuerying, setPaymentQuerying] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const idempotencyKey = useRef("");
    const completedOrderId = useRef("");
    const requestSequence = useRef(0);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedProvider = useMemo(() => providers.find((item) => item.id === selectedProviderId), [providers, selectedProviderId]);

    const reloadWallet = async (targetPage = page) => {
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
        setPage(1);
        void reloadWallet(1);
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders()])
            .then(([productResult, providerResult]) => {
                setProducts(productResult.products.filter((item) => item.enabled));
                setProviders(providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured));
                setSelectedProductId((current) => current || productResult.products.find((item) => item.enabled)?.id || "");
                setSelectedProviderId((current) => current || providerResult.providers.find((item) => item.enabled && item.pluginEnabled && item.configured)?.id || "");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取充值配置失败"))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error("支付结果无效，未产生积分充值");
    }, [open, paymentInvalid]);

    useEffect(() => {
        idempotencyKey.current = "";
    }, [selectedProductId, selectedProviderId]);

    useEffect(() => {
        if (!paymentOpen || !paymentOrder || !["created", "pending", "closing"].includes(paymentOrder.status)) return;
        const interval = window.setInterval(() => {
            void refreshPaymentStatus(paymentOrder.id, true);
        }, 4_000);
        return () => window.clearInterval(interval);
    }, [paymentOpen, paymentOrder?.id, paymentOrder?.status]);

    useEffect(() => {
        if (!paymentOpen) return;
        const interval = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [paymentOpen]);

    const announceWalletUpdated = async (orderId?: string) => {
        if (orderId && completedOrderId.current === orderId) return;
        if (orderId) completedOrderId.current = orderId;
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        getPaymentOrder(pendingPaymentOrderId)
            .then(async ({ order }) => {
                setPaymentOrder(order);
                setPaymentOpen(true);
                if (order.status === "credited") await announceWalletUpdated(order.id);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取支付结果失败"));
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
        if (!selectedProduct || !selectedProvider) {
            message.error("请选择充值商品和支付方式");
            return;
        }
        setPaymentCreating(true);
        try {
            if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
            const result = await createPaymentOrder({ productId: selectedProduct.id, providerId: selectedProvider.id, idempotencyKey: idempotencyKey.current });
            idempotencyKey.current = "";
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await announceWalletUpdated(result.order.id);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            }
            setPaymentOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
        } finally {
            setPaymentCreating(false);
        }
    };

    async function refreshPaymentStatus(orderId = paymentOrder?.id, silent = false) {
        if (!orderId || paymentQuerying) return;
        setPaymentQuerying(true);
        try {
            const result = await queryPaymentOrder(orderId);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") {
                await announceWalletUpdated(result.order.id);
                if (!silent) message.success("支付已确认，积分已到账");
            } else if (!silent && result.order.status === "closed") message.warning("订单已关闭，未产生积分充值");
            else if (!silent) message.info("渠道尚未确认支付，请稍后再试");
        } catch (error) {
            if (!silent) message.error(error instanceof Error ? error.message : "查询支付结果失败");
        } finally {
            setPaymentQuerying(false);
        }
    }

    const cancelPayment = async () => {
        if (!paymentOrder) return;
        setPaymentQuerying(true);
        try {
            const result = await closePaymentOrder(paymentOrder.id);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await announceWalletUpdated(result.order.id);
            else message.success("未支付订单已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭订单失败");
        } finally {
            setPaymentQuerying(false);
        }
    };

    const retryCheckout = async () => {
        if (!paymentOrder) return;
        setPaymentQuerying(true);
        try {
            const result = await refreshPaymentCheckout(paymentOrder.id);
            setPaymentOrder(result.order);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) window.location.assign(result.order.checkout.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新支付入口失败");
        } finally {
            setPaymentQuerying(false);
        }
    };

    const available = wallet?.account.availableMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(880px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker"><Coins />积分中心</span>
                            <h2>充值、兑换与消费记录</h2>
                            <p>为下一次创作补充积分，随时查看每一笔收支。</p>
                        </div>
                        <div className="workspace-wallet-balance">
                            <span>可用积分</span>
                            <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                            <small>冻结 {wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--"}</small>
                        </div>
                    </header>

                    <div className="workspace-wallet-tabs" role="tablist" aria-label="积分中心">
                        <button type="button" role="tab" aria-selected={tab === "topup"} onClick={() => setTab("topup")}><WalletCards />充值 / 兑换</button>
                        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}><History />积分消耗历史</button>
                    </div>

                    {tab === "topup" ? (
                        <div className="workspace-wallet-content is-topup">
                            <section className="workspace-wallet-section">
                                <div className="workspace-wallet-section-heading"><div><h3>在线充值</h3><p>选择积分套餐和支付方式。</p></div><CreditCard /></div>
                                {paymentsLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : products.length && providers.length ? <>
                                    <div className="workspace-wallet-products">
                                        {products.map((product) => <button key={product.id} type="button" className={cn("workspace-wallet-product", selectedProductId === product.id && "is-selected")} aria-pressed={selectedProductId === product.id} onClick={() => setSelectedProductId(product.id)}>
                                            <span>{product.name}</span><strong>{formatCredits(product.creditsMicrocredits, 6)} 积分</strong><small>¥ {(product.amountFen / 100).toFixed(2)}{product.description ? ` · ${product.description}` : ""}</small>{selectedProductId === product.id ? <Check /> : null}
                                        </button>)}
                                    </div>
                                    <div className="workspace-wallet-provider-row">
                                        <div className="workspace-wallet-providers" role="radiogroup" aria-label="支付方式">
                                            {providers.map((provider) => <button key={provider.id} type="button" role="radio" aria-checked={selectedProviderId === provider.id} className={selectedProviderId === provider.id ? "is-selected" : ""} onClick={() => setSelectedProviderId(provider.id)}><CreditCard />{provider.name}</button>)}
                                        </div>
                                        <Button type="primary" size="large" loading={paymentCreating} disabled={!selectedProduct || !selectedProvider} onClick={() => void startPayment()}>立即充值</Button>
                                    </div>
                                </> : <div className="workspace-wallet-inline-state"><CircleAlert /><div><strong>在线充值暂不可用</strong><span>当前没有已启用的充值商品或支付渠道，请使用兑换码或联系管理员。</span></div></div>}
                            </section>

                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading"><div><h3>兑换码</h3><p>输入兑换码，将积分存入当前账户。</p></div><TicketCheck /></div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder="输入 32 位兑换码" onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>确认兑换</Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar"><div><h3>积分消耗历史</h3><p>包含充值、兑换、生成消费、冻结与退款。</p></div><Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>刷新</Button></div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? <div className="workspace-wallet-inline-state is-error"><CircleAlert /><div><strong>记录加载失败</strong><span>{walletError}</span></div><Button onClick={() => void reloadWallet(page)}>重试</Button></div> : walletLoading && !wallet ? <Skeleton active paragraph={{ rows: 6 }} /> : wallet?.entries.length ? <div className="workspace-wallet-ledger">
                                    {wallet.entries.map((entry) => <WalletLedgerRow key={entry.id} entry={entry} />)}
                                </div> : <div className="workspace-wallet-empty"><History /><strong>还没有积分记录</strong><span>完成充值、兑换或生成任务后，记录会显示在这里。</span></div>}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>第 {page} / {totalPages} 页</span>
                                <button type="button" disabled={page <= 1 || walletLoading} aria-label="上一页" onClick={() => { const next = page - 1; setPage(next); void reloadWallet(next); }}><ChevronLeft /></button>
                                <button type="button" disabled={page >= totalPages || walletLoading} aria-label="下一页" onClick={() => { const next = page + 1; setPage(next); void reloadWallet(next); }}><ChevronRight /></button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            <AppModal open={paymentOpen} title={paymentOrder?.status === "credited" ? "充值完成" : paymentOrder?.checkout.mode === "qr_code" ? "扫码支付" : "确认支付结果"} centered width={430} onCancel={() => setPaymentOpen(false)} footer={paymentFooter(paymentOrder, paymentQuerying, () => setPaymentOpen(false), cancelPayment, refreshPaymentStatus, retryCheckout)}>
                {paymentOrder ? <div className="workspace-wallet-payment">
                    <span className="workspace-wallet-payment-icon"><CreditCard /></span>
                    <strong>¥ {(paymentOrder.amountFen / 100).toFixed(2)}</strong>
                    <p>{paymentOrder.productName} · {formatCredits(paymentOrder.creditsMicrocredits, 6)} 积分</p>
                    {paymentOrder.status === "pending" && paymentOrder.checkout.mode === "qr_code" && paymentOrder.checkout.value ? <><PaymentCheckoutCode value={paymentOrder.checkout.value} /><span>请使用支付应用扫码完成支付</span></> : null}
                    <PaymentStatus order={paymentOrder} now={clock} />
                </div> : null}
            </AppModal>
        </>
    );
}

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const positive = entry.amountMicrocredits > 0;
    const title = entry.type === "consume" ? "模型调用" : entry.type === "refund" ? "消费退款" : entry.type === "payment_topup" ? "在线充值" : entry.type === "redeem" ? "兑换码充值" : entry.note || "积分调整";
    return <article className="workspace-wallet-ledger-row"><span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <Coins /> : <CreditCard />}</span><div><strong>{title}</strong><span>{[entry.scene, entry.model, entry.note].filter(Boolean).join(" · ") || "积分账户变动"}</span></div><time>{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</time><b className={positive ? "is-income" : "is-consume"}>{positive ? "+" : ""}{formatCredits(entry.amountMicrocredits, 6)}</b></article>;
}

function PaymentStatus({ order, now }: { order: PaymentOrder; now: number }) {
    if (order.status === "credited") return <div className="workspace-wallet-payment-status is-success">支付已确认，积分已经到账</div>;
    if (order.status === "closed") return <div className="workspace-wallet-payment-status">订单已关闭，未产生积分充值</div>;
    if (order.status === "create_failed") return <div className="workspace-wallet-payment-status is-error">支付入口创建失败，请重新生成支付入口。</div>;
    const remaining = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    return <div className="workspace-wallet-payment-status">订单剩余 {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}，将自动确认支付结果</div>;
}

function paymentFooter(order: PaymentOrder | null, loading: boolean, close: () => void, cancel: () => Promise<void>, query: (id?: string, silent?: boolean) => Promise<void>, retry: () => Promise<void>) {
    if (order?.status === "pending") return [<Button key="cancel" danger disabled={loading} onClick={() => void cancel()}>关闭订单</Button>, <Button key="query" type="primary" loading={loading} onClick={() => void query()}>我已完成支付</Button>];
    if (order?.status === "create_failed") return [<Button key="close" onClick={close}>稍后处理</Button>, <Button key="retry" type="primary" loading={loading} onClick={() => void retry()}>重新生成支付入口</Button>];
    return [<Button key="done" type="primary" onClick={close}>完成</Button>];
}
