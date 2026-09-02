import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlipayCircleFilled, WechatFilled } from "@ant-design/icons";
import { App, Button, Grid, Input, Modal, QRCode, Segmented, Skeleton, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, Coins, CreditCard, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, TicketCheck } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { PaginationBar, TableSurface } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { checkinCredits, getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { closePaymentOrder, createPaymentOrder, getPaymentOrder, listPaymentProviders, listTopupProducts, queryPaymentOrder, refreshPaymentCheckout, type PaymentOrder, type PaymentProvider, type TopupProduct } from "@/services/api/payments";
import { modelDisplayName, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";

type LedgerFilter = "all" | "income" | "consume" | "refund";

const ledgerFilterOptions = [
    { label: "全部", value: "all" },
    { label: "充值与调整", value: "income" },
    { label: "模型消费", value: "consume" },
    { label: "退款", value: "refund" },
];

export default function WalletPage() {
    const { message } = App.useApp();
    const screens = Grid.useBreakpoint();
    const reducedMotion = useReducedMotion();
    const config = useEffectiveConfig();
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [code, setCode] = useState("");
    const [filter, setFilter] = useState<LedgerFilter>("all");
    const [loading, setLoading] = useState(false);
    const [redeeming, setRedeeming] = useState(false);
    const [checkingIn, setCheckingIn] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [paymentProducts, setPaymentProducts] = useState<TopupProduct[]>([]);
    const [paymentProviders, setPaymentProviders] = useState<PaymentProvider[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(true);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [paymentCreating, setPaymentCreating] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [paymentQuerying, setPaymentQuerying] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const requestSequence = useRef(0);
    const paymentPollSequence = useRef(0);
    const paymentRefreshInFlight = useRef(false);
    const nextPaymentRefreshAt = useRef(0);
    const paymentIdempotencyKey = useRef("");
    const completedPaymentOrderId = useRef("");

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        try {
            const nextWallet = await getWallet(targetPage, targetPageSize, filter);
            if (sequence === requestSequence.current) setWallet(nextWallet);
        } catch (error) {
            if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : "读取积分记录失败");
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload(page, pageSize);
    }, [filter, page, pageSize]);

    useEffect(() => {
        let active = true;
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders()])
            .then(([productsResult, providersResult]) => {
                if (!active) return;
                setPaymentProducts(productsResult.products);
                setPaymentProviders(providersResult.providers);
                setSelectedProductId((current) => current || productsResult.products[0]?.id || "");
                setSelectedProviderId((current) => current || providersResult.providers[0]?.id || "");
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "读取在线充值配置失败");
            })
            .finally(() => {
                if (active) setPaymentsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const returnedOrderId = new URLSearchParams(window.location.search).get("paymentOrder");
        if (!returnedOrderId) return;
        getPaymentOrder(returnedOrderId)
            .then(({ order }) => {
                setPaymentOrder(order);
                nextPaymentRefreshAt.current = 0;
                setPaymentModalOpen(true);
                if (order.status === "pending") void confirmPayment(order.id);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取支付结果失败"));
        window.history.replaceState(null, "", window.location.pathname);
    }, []);

    useEffect(() => {
        if (!paymentModalOpen || !paymentOrder || !["created", "pending", "closing"].includes(paymentOrder.status)) return;
        const interval = window.setInterval(() => {
            setClock(Date.now());
            const sequence = ++paymentPollSequence.current;
            void getPaymentOrder(paymentOrder.id)
                .then(({ order }) => {
                    if (sequence !== paymentPollSequence.current) return;
                    setPaymentOrder(order);
                    if (order.status === "credited") {
                        void paymentCompleted(order.id);
                        return;
                    }
                    const checkoutExpired = order.checkout.mode === "qr_code" && order.checkout.expiresAt && new Date(order.checkout.expiresAt).getTime() <= Date.now();
                    if (checkoutExpired && new Date(order.expiresAt).getTime() > Date.now() && !paymentRefreshInFlight.current && Date.now() >= nextPaymentRefreshAt.current) {
                        paymentRefreshInFlight.current = true;
                        nextPaymentRefreshAt.current = Date.now() + 15 * 60_000;
                        void refreshPaymentCheckout(order.id)
                            .then(async (result) => {
                                setPaymentOrder(result.order);
                                if (result.order.status === "credited") await paymentCompleted(result.order.id);
                            })
                            .catch(() => undefined)
                            .finally(() => {
                                paymentRefreshInFlight.current = false;
                            });
                    }
                })
                .catch(() => undefined);
        }, 2_000);
        return () => window.clearInterval(interval);
    }, [paymentModalOpen, paymentOrder?.id, paymentOrder?.status]);

    const selectedProduct = useMemo(() => paymentProducts.find((item) => item.id === selectedProductId), [paymentProducts, selectedProductId]);
    const selectedProvider = useMemo(() => paymentProviders.find((item) => item.id === selectedProviderId), [paymentProviders, selectedProviderId]);

    useEffect(() => {
        paymentIdempotencyKey.current = "";
    }, [selectedProductId, selectedProviderId]);

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
            setPage(1);
            await reload(1, pageSize);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success("兑换成功，积分已到账");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    const checkin = async () => {
        setCheckingIn(true);
        try {
            await checkinCredits();
            await reload(page, pageSize);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success("签到成功，积分已到账");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "签到失败");
        } finally {
            setCheckingIn(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedProvider) {
            message.error("请选择充值商品和支付方式");
            return;
        }
        setPaymentCreating(true);
        try {
            if (!paymentIdempotencyKey.current) paymentIdempotencyKey.current = crypto.randomUUID();
            const result = await createPaymentOrder({ productId: selectedProduct.id, providerId: selectedProvider.id, idempotencyKey: paymentIdempotencyKey.current });
            paymentIdempotencyKey.current = "";
            setPaymentOrder(result.order);
            nextPaymentRefreshAt.current = 0;
            if (result.order.status === "credited") {
                setPaymentModalOpen(true);
                await paymentCompleted(result.order.id);
                return;
            }
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            }
            setPaymentModalOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
        } finally {
            setPaymentCreating(false);
        }
    };

    async function confirmPayment(orderId = paymentOrder?.id) {
        if (!orderId) return;
        setPaymentQuerying(true);
        try {
            const result = await queryPaymentOrder(orderId);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await paymentCompleted(result.order.id);
            else if (result.order.status === "closed") message.warning("订单已关闭，未产生积分充值");
            else message.info("渠道尚未确认支付，请稍后再试");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "查询支付结果失败");
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
            if (result.order.status === "credited") await paymentCompleted(result.order.id);
            else message.success("未支付订单已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭订单失败");
        } finally {
            setPaymentQuerying(false);
        }
    };

    const retryPaymentCheckout = async () => {
        if (!paymentOrder) return;
        setPaymentQuerying(true);
        try {
            const result = await refreshPaymentCheckout(paymentOrder.id);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await paymentCompleted(result.order.id);
            else if (result.order.status === "closed") message.warning("订单已关闭，未产生积分充值");
            else if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            } else message.success("支付二维码已重新生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重新生成支付收银台失败");
        } finally {
            setPaymentQuerying(false);
        }
    };

    async function paymentCompleted(orderId: string) {
        if (completedPaymentOrderId.current === orderId) return;
        completedPaymentOrderId.current = orderId;
        await reload(1, pageSize);
        setPage(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        message.success("支付成功，积分已到账");
    }

    const entries = wallet?.entries || [];
    const account = wallet?.account;
    const totalMicrocredits = (account?.availableMicrocredits || 0) + (account?.reservedMicrocredits || 0);

    const columns: ColumnsType<CreditLedgerEntry> = [
        { title: "发生时间", dataIndex: "createdAt", width: 180, render: formatTime },
        { title: "类型", dataIndex: "type", width: 120, render: (type) => <LedgerTypeTag type={type} /> },
        {
            title: "明细",
            width: 400,
            ellipsis: true,
            render: (_, entry) => (
                <div className="min-w-0 max-w-full overflow-hidden" title={[ledgerModelName(config, entry), [sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ")].filter(Boolean).join("\n")}>
                    <div className="truncate font-medium">{ledgerModelName(config, entry)}</div>
                    <div className="mt-1 truncate text-xs text-foreground/50">{[sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ") || "无补充说明"}</div>
                </div>
            ),
        },
        {
            title: "积分变化",
            dataIndex: "amountMicrocredits",
            width: 145,
            align: "right",
            render: (value: number) => <CreditDelta value={value} />,
        },
        { title: "变更后余额", dataIndex: "availableAfterMicrocredits", width: 145, align: "right", render: (value) => <span className="tabular-nums">{formatCredits(value)}</span> },
    ];

    return (
        <main className="app-user-content app-workspace-scroll library-page wallet-library-page relative h-full overflow-y-auto text-foreground">
            <div className="relative w-full px-4 py-6 sm:px-6 lg:px-8">
                <div className="studio-band">
                    <motion.header
                        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="app-page-header flex flex-wrap items-start justify-between gap-4"
                    >
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="min-w-0">
                                <h1 className="text-[var(--fs-heading-lg)] font-semibold leading-7">积分中心</h1>
                                <p className="mt-1 text-xs leading-5 text-foreground/58">模型调用、冻结与退款都在同一条可追溯流水中。</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="app-projects-header-meta wallet-credit-meta">
                                <Coins className="size-3" />
                                可用 {formatCredits(account?.availableMicrocredits || 0, 6)}
                            </span>
                            <Button
                                className="library-primary-action"
                                icon={<CalendarCheck className="size-4" />}
                                type={wallet?.policy.checkedInToday ? "default" : "primary"}
                                loading={checkingIn}
                                disabled={wallet?.policy.checkedInToday}
                                onClick={() => void checkin()}
                            >
                                {wallet?.policy.checkedInToday ? "今日已签到" : `签到 +${formatCredits(wallet?.policy.checkinBonusMicrocredits || 0)}`}
                            </Button>
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                                刷新余额
                            </Button>
                        </div>
                    </motion.header>
                </div>

                <section className="library-feature-grid mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
                    <section className="credit-balance-card">
                        <div className="wallet-balance-inner">
                            <div className="wallet-balance-primary">
                                <div className="wallet-balance-heading">
                                    <span className="library-icon-tile wallet-balance-icon">
                                        <Coins />
                                    </span>
                                    <div>
                                        <strong>可用创作积分</strong>
                                        <span>最近更新 {formatTime(account?.updatedAt)}</span>
                                    </div>
                                </div>
                                <div className="wallet-balance-number">
                                    <strong>{formatCredits(account?.availableMicrocredits || 0, 6)}</strong>
                                    <span>积分</span>
                                </div>
                            </div>
                            <div className="wallet-balance-details">
                                <span className="wallet-account-status">
                                    <ShieldCheck />
                                    账户正常
                                </span>
                                <BalanceMetric label="冻结积分" description="调用中或待核对" value={account?.reservedMicrocredits || 0} icon={<TicketCheck className="size-4" />} />
                                <BalanceMetric label="账户总额" description="可用与冻结合计" value={totalMicrocredits} icon={<Coins className="size-4" />} />
                            </div>
                        </div>
                    </section>

                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="wallet-redeem-panel app-workspace-surface flex flex-col rounded-lg p-5 backdrop-blur-xl sm:p-6"
                    >
                        <div className="flex items-start gap-3">
                            <span className="wallet-redeem-icon grid size-9 shrink-0 place-items-center rounded-lg">
                                <TicketCheck className="size-4" />
                            </span>
                            <div>
                                <h2 className="text-base font-semibold">兑换积分</h2>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">输入管理员发放的 32 位兑换码。</p>
                            </div>
                        </div>
                        <label className="mt-6 block">
                            <span className="text-xs font-medium text-foreground/70">兑换码</span>
                            <Input
                                className="mt-2 font-mono"
                                size="large"
                                value={code}
                                maxLength={32}
                                spellCheck={false}
                                autoComplete="off"
                                onChange={(event) => setCode(event.target.value.replace(/[-\s]/g, ""))}
                                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                onPressEnter={() => void redeem()}
                            />
                        </label>
                        <div className="mt-2 flex items-center justify-between text-xs text-foreground/45">
                            <span>兑换成功后立即到账</span>
                            <span className="tabular-nums">{code.length} / 32</span>
                        </div>
                        <Button className="mt-5" type="primary" size="large" block loading={redeeming} disabled={code.length !== 32} onClick={() => void redeem()}>
                            兑换积分
                        </Button>
                    </motion.div>
                </section>

                <section className="app-workspace-surface mt-6 rounded-lg p-5 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="flex items-start gap-3">
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground/6 text-foreground/70">
                                    <CreditCard className="size-4" />
                                </span>
                                <div>
                                    <h2 className="text-base font-semibold">在线充值</h2>
                                    <p className="mt-1 text-xs leading-5 text-foreground/55">支付成功后自动充值积分。平台不提供退款，请确认商品和金额后付款。</p>
                                </div>
                            </div>
                        </div>
                        {selectedProduct ? (
                            <div className="text-right">
                                <div className="text-xs text-foreground/45">应付金额</div>
                                <div className="mt-1 text-2xl font-semibold tabular-nums">¥ {(selectedProduct.amountFen / 100).toFixed(2)}</div>
                            </div>
                        ) : null}
                    </div>
                    {paymentsLoading ? (
                        <Skeleton className="mt-6" active paragraph={{ rows: 2 }} />
                    ) : paymentProducts.length && paymentProviders.length ? (
                        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                            <div>
                                <div className="mb-2 text-xs font-medium text-foreground/65">选择充值商品</div>
                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                    {paymentProducts.map((product) => (
                                        <button
                                            key={product.id}
                                            type="button"
                                            className={`rounded-lg border px-4 py-3 text-left transition-colors ${selectedProductId === product.id ? "border-primary bg-primary/5" : "border-border/70 bg-background/35 hover:border-foreground/25"}`}
                                            onClick={() => setSelectedProductId(product.id)}
                                        >
                                            <div className="font-medium">{product.name}</div>
                                            <div className="mt-1 text-xs text-foreground/48">
                                                {formatCredits(product.creditsMicrocredits, 6)} 积分 · ¥ {(product.amountFen / 100).toFixed(2)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="mb-2 text-xs font-medium text-foreground/65">选择支付方式</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {paymentProviders.map((provider) => (
                                        <button
                                            key={provider.id}
                                            type="button"
                                            className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left transition-colors ${selectedProviderId === provider.id ? "border-primary bg-primary/5" : "border-border/70 bg-background/35 hover:border-foreground/25"}`}
                                            onClick={() => setSelectedProviderId(provider.id)}
                                        >
                                            <PaymentBrandIcon providerId={provider.id} />
                                            <span className="min-w-0 truncate text-sm font-medium">{provider.name}</span>
                                        </button>
                                    ))}
                                </div>
                                <Button className="mt-3" type="primary" size="large" block loading={paymentCreating} disabled={!selectedProduct || !selectedProvider} onClick={() => void startPayment()}>
                                    {selectedProvider?.checkoutMode === "qr_code" ? "生成支付二维码" : `前往${selectedProvider?.name || "支付"}`}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <WorkspaceState compact icon="wallet" title="在线充值暂未开放" description="管理员配置充值商品和支付渠道后即可使用。" />
                    )}
                </section>

                <section className="wallet-ledger-panel app-workspace-surface mt-9 rounded-lg p-4 backdrop-blur-xl sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="text-base font-semibold">积分流水</h2>
                            <p className="mt-1 text-xs text-foreground/55">当前展示最近 {wallet?.entries.length || 0} 条记录。</p>
                        </div>
                        <Segmented
                            block={!screens.sm}
                            value={filter}
                            options={ledgerFilterOptions}
                            onChange={(value) => {
                                setFilter(value as LedgerFilter);
                                setPage(1);
                            }}
                        />
                    </div>

                    {screens.md ? (
                        <TableSurface className="mt-0 rounded-xl border-border/70 bg-transparent">
                            <Table className="app-data-table wallet-ledger-table" rowKey="id" size="middle" loading={loading} columns={columns} dataSource={entries} pagination={false} tableLayout="fixed" scroll={{ x: 990 }} />
                        </TableSurface>
                    ) : (
                        <div className="grid gap-1 overflow-hidden rounded-md bg-transparent">
                            {entries.length ? (
                                entries.map((entry) => <LedgerMobileRow key={entry.id} config={config} entry={entry} />)
                            ) : (
                                <WorkspaceState compact icon="wallet" title="没有匹配的积分记录" description="切换流水类型，或完成一次生成后再回来查看。" />
                            )}
                        </div>
                    )}
                    <PaginationBar
                        current={page}
                        pageSize={pageSize}
                        total={wallet?.total || 0}
                        pageSizeOptions={[20, 50, 100]}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                </section>
            </div>

            <Modal
                open={paymentModalOpen}
                title={paymentOrder?.status === "credited" ? "充值完成" : paymentOrder?.checkout.mode === "qr_code" ? "扫码支付" : "确认支付结果"}
                onCancel={() => setPaymentModalOpen(false)}
                footer={
                    paymentOrder?.status === "pending"
                        ? [
                              <Button key="close" danger disabled={paymentQuerying} onClick={() => void cancelPayment()}>
                                  关闭订单
                              </Button>,
                              <Button key="query" type="primary" loading={paymentQuerying} onClick={() => void confirmPayment()}>
                                  我已完成支付
                              </Button>,
                          ]
                        : paymentOrder?.status === "create_failed"
                          ? [
                                <Button key="done" onClick={() => setPaymentModalOpen(false)}>
                                    稍后处理
                                </Button>,
                                <Button key="retry" type="primary" loading={paymentQuerying} onClick={() => void retryPaymentCheckout()}>
                                    {paymentOrder.checkout.mode === "redirect" ? "重新打开收银台" : "重新生成二维码"}
                                </Button>,
                            ]
                          : [
                                <Button key="done" type="primary" onClick={() => setPaymentModalOpen(false)}>
                                    完成
                                </Button>,
                            ]
                }
                destroyOnHidden
            >
                {paymentOrder ? (
                    <div className="py-2 text-center">
                        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-foreground/5">
                            <PaymentBrandIcon providerId={paymentOrder.providerId} size="large" />
                        </div>
                        <div className="mt-3 text-lg font-semibold">¥ {(paymentOrder.amountFen / 100).toFixed(2)}</div>
                        <div className="mt-1 text-xs text-foreground/48">
                            {paymentOrder.productName} · {formatCredits(paymentOrder.creditsMicrocredits, 6)} 积分
                        </div>
                        {paymentOrder.status === "pending" && paymentOrder.checkout.mode === "qr_code" && paymentOrder.checkout.value ? (
                            <div className="mt-5 flex flex-col items-center">
                                <QRCode value={paymentOrder.checkout.value} size={208} bordered={false} />
                                <p className="mt-3 text-sm font-medium">请使用支付应用扫码完成支付</p>
                                <p className="mt-1 text-xs text-foreground/45">请勿保存二维码后长按识别</p>
                            </div>
                        ) : null}
                        <PaymentOrderStatus order={paymentOrder} now={clock} />
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}

function BalanceMetric({ label, description, value, icon }: { label: string; description: string; value: number; icon: ReactNode }) {
    return (
        <div className="wallet-balance-metric">
            <span className="wallet-balance-metric-icon">{icon}</span>
            <div>
                <span>{label}</span>
                <strong>{formatCredits(value, 6)}</strong>
                <small>{description}</small>
            </div>
        </div>
    );
}

function LedgerMobileRow({ config, entry }: { config: AiConfig; entry: CreditLedgerEntry }) {
    const meta = ledgerTypeMeta(entry.type);
    return (
        <article className="flex items-start gap-3 rounded-md bg-foreground/[.025] px-4 py-4">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${meta.iconClass}`}>{meta.icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{ledgerModelName(config, entry)}</div>
                        <div className="mt-1 text-xs text-foreground/45">{formatTime(entry.createdAt)}</div>
                    </div>
                    <CreditDelta value={entry.amountMicrocredits} />
                </div>
                <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-foreground/55">{[sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ") || meta.label}</div>
            </div>
        </article>
    );
}

function CreditDelta({ value }: { value: number }) {
    const colorClass = value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground/60";
    return (
        <span className={`shrink-0 font-medium tabular-nums ${colorClass}`}>
            {value > 0 ? "+" : ""}
            {formatCredits(value, 6)}
        </span>
    );
}

function LedgerTypeTag({ type }: { type: CreditLedgerEntry["type"] }) {
    const meta = ledgerTypeMeta(type);
    return (
        <Tag variant="filled" color={meta.tagColor}>
            {meta.label}
        </Tag>
    );
}

function ledgerTypeMeta(type: CreditLedgerEntry["type"]) {
    const values = {
        redeem: { label: "兑换充值", tagColor: "default", icon: <ArrowDownLeft className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        payment_topup: { label: "在线充值", tagColor: "success", icon: <CreditCard className="size-4" />, iconClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
        admin_grant: { label: "管理员充值", tagColor: "default", icon: <ArrowDownLeft className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        consume: { label: "模型消费", tagColor: "error", icon: <Sparkles className="size-4" />, iconClass: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
        reserve: { label: "积分冻结", tagColor: "warning", icon: <ArrowUpRight className="size-4" />, iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
        refund: { label: "消费退款", tagColor: "warning", icon: <RotateCcw className="size-4" />, iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
        admin_adjustment: { label: "管理员调账", tagColor: "default", icon: <SlidersHorizontal className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        signup_bonus: { label: "注册奖励", tagColor: "default", icon: <Sparkles className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        checkin_bonus: { label: "签到奖励", tagColor: "default", icon: <CalendarCheck className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
    } as const;
    return values[type] || { label: "其他积分变动", tagColor: "default", icon: <ArrowUpRight className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" };
}

function ledgerTitle(entry: CreditLedgerEntry) {
    if (entry.type === "redeem") return "兑换码充值";
    if (entry.type === "payment_topup") return "在线支付充值";
    if (entry.type === "refund") return "模型消费退款";
    if (entry.type === "consume") return "模型调用";
    if (entry.type === "signup_bonus") return "新用户注册奖励";
    if (entry.type === "checkin_bonus") return "每日签到奖励";
    return entry.note || "积分调整";
}

function PaymentBrandIcon({ providerId, size = "normal" }: { providerId: string; size?: "normal" | "large" }) {
    const className = size === "large" ? "text-3xl" : "text-xl";
    if (providerId === "wechat-native") return <WechatFilled className={`${className} text-[#07C160]`} aria-label="微信支付" />;
    return <CreditCard className={`${className} text-foreground/60`} aria-label="支付" />;
}

function PaymentOrderStatus({ order, now }: { order: PaymentOrder; now: number }) {
    const remainingSeconds = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000));
    if (order.status === "credited") return <div className="mt-5 rounded-lg bg-emerald-500/8 px-4 py-3 text-sm font-medium text-emerald-600 dark:text-emerald-300">支付已确认，积分已经到账</div>;
    if (order.status === "closed") return <div className="mt-5 rounded-lg bg-foreground/5 px-4 py-3 text-sm text-foreground/60">订单已关闭，未产生积分充值</div>;
    if (order.status === "create_failed") {
        const action = order.checkout.mode === "redirect" ? "重新打开收银台" : "重新生成支付二维码";
        return <div className="mt-5 rounded-lg bg-rose-500/8 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">创建渠道订单失败，可使用下方按钮{action}</div>;
    }
    return <div className="mt-5 text-xs text-foreground/48">订单剩余支付时间 {formatCountdown(remainingSeconds)}，页面将自动确认支付结果</div>;
}

function formatCountdown(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

function ledgerModelName(config: AiConfig, entry: CreditLedgerEntry) {
    return entry.model ? modelDisplayName(config, entry.model) : ledgerTitle(entry);
}

function sceneLabel(scene?: string) {
    const labels: Record<string, string> = { image: "图片生成", text: "文本生成", video: "视频生成", audio: "音频生成", storyboard: "分镜生成" };
    return scene ? labels[scene] || "其他场景" : "";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
