import { App, Button, Empty, Modal, QRCode, Segmented, Spin, Tag } from "antd";
import { CheckCircle2, Clock3, Coins, CreditCard, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatCredits } from "@/constant/credits";
import { closeRechargeOrder, createRechargeOrder, listPublicPaymentChannels, listRechargeOrders, listRechargeProducts, syncRechargeOrder, type PaymentOrder, type PublicPaymentChannel, type RechargeProduct } from "@/services/api/payment";

const terminalStatuses = new Set<PaymentOrder["status"]>(["succeeded", "closed", "failed"]);

export function RechargePanel({ onPaid }: { onPaid: () => Promise<void> | void }) {
    const { message } = App.useApp();
    const [products, setProducts] = useState<RechargeProduct[]>([]);
    const [channels, setChannels] = useState<PublicPaymentChannel[]>([]);
    const [selectedChannelId, setSelectedChannelId] = useState("");
    const [orders, setOrders] = useState<PaymentOrder[]>([]);
    const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null);
    const [serverOffset, setServerOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [creatingProductId, setCreatingProductId] = useState("");
    const [closing, setClosing] = useState(false);
    const [now, setNow] = useState(Date.now());

    const reload = async () => {
        setLoading(true);
        try {
            const [productResult, channelResult, orderResult] = await Promise.all([listRechargeProducts(), listPublicPaymentChannels(), listRechargeOrders(1, 5)]);
            setProducts(productResult.products);
            setChannels(channelResult.channels);
            setSelectedChannelId((current) => {
                if (current && channelResult.channels.some((channel) => channel.id === current)) return current;
                return channelResult.channels.find((channel) => channel.isDefault)?.id || channelResult.channels[0]?.id || "";
            });
            setOrders(orderResult.orders);
            setServerOffset(new Date(orderResult.serverTime).getTime() - Date.now());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取充值套餐失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    useEffect(() => {
        if (!activeOrder || terminalStatuses.has(activeOrder.status)) return;
        const timer = window.setInterval(async () => {
            try {
                const result = await syncRechargeOrder(activeOrder.id);
                setServerOffset(new Date(result.serverTime).getTime() - Date.now());
                setActiveOrder(result.order);
                if (result.order.status === "succeeded") {
                    message.success("支付成功，积分已到账");
                    await onPaid();
                    await reload();
                }
            } catch {
                // 短暂查单失败由下一轮轮询和后端恢复任务继续处理。
            }
        }, 3_000);
        return () => window.clearInterval(timer);
    }, [activeOrder?.id, activeOrder?.status]);

    useEffect(() => {
        if (!activeOrder || terminalStatuses.has(activeOrder.status)) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [activeOrder?.id, activeOrder?.status]);

    const remainingSeconds = useMemo(() => {
        if (!activeOrder) return 0;
        return Math.max(0, Math.ceil((new Date(activeOrder.expiresAt).getTime() - (now + serverOffset)) / 1_000));
    }, [activeOrder?.expiresAt, now, serverOffset]);

    const activeOrderChannel = useMemo(() => channels.find((channel) => channel.id === activeOrder?.channelId), [activeOrder?.channelId, channels]);

    const startRecharge = async (product: RechargeProduct) => {
        if (!selectedChannelId) {
            message.warning("请选择支付方式");
            return;
        }
        setCreatingProductId(product.id);
        try {
            const result = await createRechargeOrder(product.id, selectedChannelId, crypto.randomUUID());
            setServerOffset(new Date(result.serverTime).getTime() - Date.now());
            setNow(Date.now());
            setActiveOrder(result.order);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
        } finally {
            setCreatingProductId("");
        }
    };

    const closeOrder = async () => {
        if (!activeOrder) return;
        if (terminalStatuses.has(activeOrder.status) || activeOrder.status === "exception") {
            setActiveOrder(null);
            return;
        }
        setClosing(true);
        try {
            const result = await closeRechargeOrder(activeOrder.id);
            setActiveOrder(result.order);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭订单失败");
        } finally {
            setClosing(false);
        }
    };

    return (
        <section className="app-workspace-surface mt-5 rounded-lg p-4 backdrop-blur-xl sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                            <CreditCard className="size-4" />
                        </span>
                        <h2 className="text-base font-semibold">积分充值</h2>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-foreground/55">选择充值套餐和支付方式，支付成功后积分自动到账；充值不支持退款。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                    刷新
                </Button>
            </div>

            <Spin spinning={loading}>
                {channels.length ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                        <span className="text-xs font-medium text-foreground/55">支付方式</span>
                        <Segmented value={selectedChannelId} options={channels.map((channel) => ({ label: paymentChannelLabel(channel), value: channel.id }))} onChange={(value) => setSelectedChannelId(String(value))} />
                    </div>
                ) : null}
                {products.length && channels.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {products.map((product) => (
                            <article key={product.id} className="rounded-lg border border-border/70 bg-foreground/[.025] p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="truncate font-medium">{product.name}</h3>
                                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/50">{product.description || "在线支付充值"}</p>
                                    </div>
                                    <Coins className="mt-0.5 size-4 shrink-0 text-amber-500" />
                                </div>
                                <div className="mt-5 text-2xl font-semibold tabular-nums">
                                    {formatCredits(product.creditsMicrocredits, 6)}
                                    <span className="ml-1 text-xs font-normal text-foreground/50">积分</span>
                                </div>
                                <Button className="mt-4" type="primary" block loading={creatingProductId === product.id} onClick={() => void startRecharge(product)}>
                                    ¥ {(product.amountFen / 100).toFixed(2)} 充值
                                </Button>
                            </article>
                        ))}
                    </div>
                ) : !loading ? (
                    <div className="py-8">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={products.length ? "暂无可用支付方式" : "暂无可用充值套餐"} />
                    </div>
                ) : null}
            </Spin>

            {orders.length ? (
                <div className="mt-5 border-t border-border/60 pt-4">
                    <div className="mb-2 text-xs font-medium text-foreground/60">最近充值订单</div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {orders.map((order) => (
                            <button
                                key={order.id}
                                type="button"
                                className="flex items-center justify-between rounded-md bg-foreground/[.025] px-3 py-2 text-left hover:bg-foreground/[.045]"
                                onClick={() => order.status === "pending" && setActiveOrder(order)}
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-medium">{order.productName}</span>
                                    <span className="mt-0.5 block text-[11px] text-foreground/45">{new Date(order.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                                </span>
                                <OrderStatusTag status={order.status} />
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <Modal
                open={Boolean(activeOrder)}
                title={activeOrderChannel?.name || "支付订单"}
                centered
                maskClosable={false}
                closable={false}
                footer={
                    activeOrder
                        ? [
                              <Button key="close" loading={closing} onClick={() => void closeOrder()}>
                                  {terminalStatuses.has(activeOrder.status) || activeOrder.status === "exception" ? "完成" : "关闭订单"}
                              </Button>,
                          ]
                        : null
                }
            >
                {activeOrder ? (
                    <div className="flex flex-col items-center py-3 text-center">
                        {activeOrder.status === "succeeded" ? (
                            <CheckCircle2 className="size-14 text-emerald-500" />
                        ) : activeOrder.status === "closed" || activeOrder.status === "failed" ? (
                            <XCircle className="size-14 text-foreground/35" />
                        ) : activeOrder.codeUrl ? (
                            <QRCode value={activeOrder.codeUrl} size={220} status={remainingSeconds > 0 ? "active" : "expired"} />
                        ) : (
                            <Spin size="large" />
                        )}
                        <h3 className="mt-4 text-base font-semibold">{activeOrder.productName}</h3>
                        <div className="mt-1 text-sm text-foreground/60">
                            ¥ {(activeOrder.amountFen / 100).toFixed(2)} · {formatCredits(activeOrder.creditsMicrocredits, 6)} 积分
                        </div>
                        <div className="mt-2 text-xs text-foreground/50">{paymentMethodHint(activeOrderChannel)}</div>
                        <div className="mt-4 flex items-center gap-1.5 text-xs text-foreground/50">
                            <Clock3 className="size-3.5" />
                            {paymentHint(activeOrder, remainingSeconds)}
                        </div>
                        <div className="mt-2 font-mono text-[10px] text-foreground/35">{activeOrder.outTradeNo}</div>
                    </div>
                ) : null}
            </Modal>
        </section>
    );
}

function paymentChannelLabel(channel: PublicPaymentChannel) {
    if (channel.provider === "wechatpay") return channel.name || "微信支付";
    return channel.name || channel.code;
}

function paymentMethodHint(channel?: PublicPaymentChannel) {
    if (channel?.provider === "wechatpay" && channel.paymentMethod === "native") return "请使用微信扫描二维码完成支付";
    if (channel?.paymentMethod === "native") return "请使用对应支付应用扫描二维码完成支付";
    return "请按照支付页面提示完成付款";
}

function OrderStatusTag({ status }: { status: PaymentOrder["status"] }) {
    const values: Record<PaymentOrder["status"], { label: string; color: string }> = {
        created: { label: "创建中", color: "default" },
        pending: { label: "待支付", color: "processing" },
        closing: { label: "核对中", color: "warning" },
        succeeded: { label: "已到账", color: "success" },
        closed: { label: "已关闭", color: "default" },
        failed: { label: "创建失败", color: "error" },
        exception: { label: "待核对", color: "warning" },
    };
    const value = values[status];
    return <Tag color={value.color}>{value.label}</Tag>;
}

function paymentHint(order: PaymentOrder, remainingSeconds: number) {
    if (order.status === "succeeded") return "积分已到账";
    if (order.status === "closed") return "订单已关闭";
    if (order.status === "failed") return "订单创建失败";
    if (order.status === "exception") return "系统正在核对支付结果";
    if (remainingSeconds <= 0) return "支付时间已结束，系统正在查单并关单";
    const minutes = Math.floor(remainingSeconds / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
    return `请在 ${minutes}:${seconds} 内完成支付`;
}
