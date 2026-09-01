import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Modal, QRCode, Select, Spin, Tag } from "antd";
import { CheckCircle2, CreditCard, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { closeRechargeOrder, createRechargeOrder, getRechargeCatalog, getRechargeOrder, listRechargeOrders, syncRechargeOrder, type CreditPackage, type RechargeCatalogChannel, type RechargeOrder } from "@/services/api/wallet";
import { useUserStore } from "@/stores/use-user-store";

export function RechargePanel({ onCredited }: { onCredited: () => void }) {
    const { message } = App.useApp();
    const enabled = useUserStore((state) => state.features.creditRechargeEnabled);
    const [packages, setPackages] = useState<CreditPackage[]>([]);
    const [channels, setChannels] = useState<RechargeCatalogChannel[]>([]);
    const [orders, setOrders] = useState<RechargeOrder[]>([]);
    const [packageId, setPackageId] = useState<string>();
    const [channelId, setChannelId] = useState<string>();
    const [activeOrder, setActiveOrder] = useState<RechargeOrder | null>(null);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const creditedNoticeRef = useRef("");
    const onCreditedRef = useRef(onCredited);

    useEffect(() => {
        onCreditedRef.current = onCredited;
    }, [onCredited]);

    const load = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        try {
            const [catalog, history] = await Promise.all([getRechargeCatalog(), listRechargeOrders({ limit: 5 })]);
            setPackages(catalog.packages);
            setChannels(catalog.channels);
            setOrders(history.orders);
            setPackageId((current) => (current && catalog.packages.some((item) => item.id === current) ? current : catalog.packages[0]?.id));
            setChannelId((current) => (current && catalog.channels.some((item) => item.id === current) ? current : catalog.channels[0]?.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取充值选项失败");
        } finally {
            setLoading(false);
        }
    }, [enabled, message]);

    const applyOrderResult = useCallback(
        (order: RechargeOrder) => {
            setActiveOrder(order);
            setOrders((current) => [order, ...current.filter((item) => item.id !== order.id)].slice(0, 5));
            if (order.status === "credited" && creditedNoticeRef.current !== order.id) {
                creditedNoticeRef.current = order.id;
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                onCreditedRef.current();
                message.success("支付成功，积分已到账");
            }
        },
        [message],
    );

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!activeOrder || !["created", "prepay_running", "awaiting_payment", "prepay_uncertain"].includes(activeOrder.status)) return;
        let disposed = false;
        const poll = async () => {
            try {
                const result = await syncRechargeOrder(activeOrder.id);
                if (disposed) return;
                applyOrderResult(result.order);
            } catch {
                // Keep the QR visible. The next poll or manual refresh can recover a transient query failure.
            }
        };
        const timer = window.setInterval(() => void poll(), 4_000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [activeOrder?.id, activeOrder?.status, applyOrderResult]);

    const selectedPackage = useMemo(() => packages.find((item) => item.id === packageId), [packageId, packages]);

    if (!enabled) return null;

    const create = async () => {
        if (!packageId || !channelId) {
            message.warning("请选择充值套餐和支付渠道");
            return;
        }
        setCreating(true);
        try {
            const result = await createRechargeOrder({ packageId, channelId, idempotencyKey: newIdempotencyKey() });
            applyOrderResult(result.order);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建充值订单失败");
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <section className="app-workspace-surface mt-5 rounded-lg p-5 backdrop-blur-xl sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="grid size-9 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600">
                            <CreditCard className="size-4" />
                        </span>
                        <div>
                            <h2 className="text-base font-semibold">在线充值</h2>
                            <p className="mt-1 text-xs leading-5 text-foreground/55">选择套餐与支付渠道，扫码支付后自动到账。</p>
                        </div>
                    </div>
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>
                <Spin spinning={loading}>
                    {packages.length && channels.length ? (
                        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                            <div>
                                <span className="text-xs font-medium text-foreground/65">充值套餐</span>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                    {packages.map((item) => (
                                        <button
                                            type="button"
                                            key={item.id}
                                            onClick={() => setPackageId(item.id)}
                                            className={`rounded-lg border p-4 text-left transition ${packageId === item.id ? "border-emerald-500 bg-emerald-500/5" : "border-foreground/10 hover:border-foreground/25"}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <strong>{item.name}</strong>
                                                <span className="text-lg font-semibold">¥{(item.amountFen / 100).toFixed(2)}</span>
                                            </div>
                                            <div className="mt-2 text-sm text-foreground/65">到账 {formatCredits(item.baseMicrocredits + item.bonusMicrocredits)} 积分</div>
                                            {item.bonusMicrocredits > 0 ? (
                                                <Tag className="mt-2" color="success">
                                                    赠送 {formatCredits(item.bonusMicrocredits)}
                                                </Tag>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-lg border border-foreground/10 p-4">
                                <label className="text-xs font-medium text-foreground/65">支付渠道</label>
                                <Select className="mt-2 w-full" value={channelId} onChange={setChannelId} options={channels.map((item) => ({ label: `${item.name} · ${item.method === "native" ? "扫码支付" : item.method}`, value: item.id }))} />
                                <div className="mt-4 flex items-start gap-2 text-xs text-foreground/50">
                                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                                    <span>支付结果以服务商签名通知和主动查单为准。充值一经到账不支持退款。</span>
                                </div>
                                <Button className="mt-5" type="primary" block size="large" loading={creating} disabled={!selectedPackage || !channelId} onClick={() => void create()}>
                                    支付 ¥{selectedPackage ? (selectedPackage.amountFen / 100).toFixed(2) : "0.00"}
                                </Button>
                            </div>
                        </div>
                    ) : !loading ? (
                        <Alert className="mt-5" type="info" showIcon message="暂时没有可用的充值套餐或支付渠道" />
                    ) : null}
                </Spin>
                {orders.length ? (
                    <div className="mt-6 border-t border-foreground/8 pt-4">
                        <div className="mb-2 text-xs font-medium text-foreground/55">最近充值订单</div>
                        <div className="grid gap-2">
                            {orders.map((order) => (
                                <button
                                    type="button"
                                    key={order.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-foreground/[0.035]"
                                    onClick={async () => {
                                        setActiveOrder(order);
                                        try {
                                            setActiveOrder((await getRechargeOrder(order.id)).order);
                                        } catch {
                                            /* The list snapshot remains available for manual refresh. */
                                        }
                                    }}
                                >
                                    <span>
                                        <strong className="text-sm">{order.packageName}</strong>
                                        <small className="ml-2 text-foreground/45">{new Date(order.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-sm">¥{(order.amountFen / 100).toFixed(2)}</span>
                                        <RechargeOrderTag status={order.status} />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
            </section>
            <Modal title="微信扫码支付" open={Boolean(activeOrder)} footer={null} onCancel={() => setActiveOrder(null)} destroyOnHidden>
                {activeOrder ? (
                    <div className="flex flex-col items-center py-4 text-center">
                        {activeOrder.status === "credited" ? (
                            <>
                                <CheckCircle2 className="size-16 text-emerald-500" />
                                <h3 className="mt-4 text-lg font-semibold">积分已到账</h3>
                                <p className="mt-1 text-sm text-foreground/55">本次到账 {formatCredits(activeOrder.totalMicrocredits)} 积分</p>
                                <Button className="mt-5" type="primary" onClick={() => setActiveOrder(null)}>
                                    完成
                                </Button>
                            </>
                        ) : activeOrder.status === "awaiting_payment" && activeOrder.payPayload?.codeUrl ? (
                            <>
                                <div className="rounded-xl bg-white p-3">
                                    <QRCode value={activeOrder.payPayload.codeUrl} size={220} bordered={false} />
                                </div>
                                <h3 className="mt-4 text-lg font-semibold">支付 ¥{(activeOrder.amountFen / 100).toFixed(2)}</h3>
                                <p className="mt-1 text-sm text-foreground/55">请使用微信扫描二维码，页面会自动确认到账。</p>
                                <div className="mt-3 flex items-center gap-2 text-xs text-amber-600">
                                    <Smartphone className="size-4" />
                                    手机端请使用另一台设备扫码
                                </div>
                                <div className="mt-5 flex gap-2">
                                    <Button
                                        onClick={async () => {
                                            try {
                                                const result = await syncRechargeOrder(activeOrder.id);
                                                applyOrderResult(result.order);
                                            } catch (error) {
                                                message.error(error instanceof Error ? error.message : "查询失败");
                                            }
                                        }}
                                    >
                                        我已支付，立即查询
                                    </Button>
                                    <Button
                                        danger
                                        onClick={async () => {
                                            try {
                                                const result = await closeRechargeOrder(activeOrder.id);
                                                applyOrderResult(result.order);
                                                message.success("订单已关闭");
                                            } catch (error) {
                                                message.error(error instanceof Error ? error.message : "关闭订单失败");
                                            }
                                        }}
                                    >
                                        关闭订单
                                    </Button>
                                </div>
                                <p className="mt-4 break-all font-mono text-[10px] text-foreground/30">订单号 {activeOrder.id}</p>
                            </>
                        ) : (
                            <>
                                <Spin />
                                <h3 className="mt-4 text-base font-semibold">正在确认订单状态</h3>
                                <p className="mt-1 text-sm text-foreground/55">
                                    <RechargeOrderTag status={activeOrder.status} />
                                </p>
                                <Button
                                    className="mt-5"
                                    onClick={async () => {
                                        try {
                                            applyOrderResult((await syncRechargeOrder(activeOrder.id)).order);
                                        } catch (error) {
                                            message.error(error instanceof Error ? error.message : "查询失败");
                                        }
                                    }}
                                >
                                    刷新状态
                                </Button>
                            </>
                        )}
                    </div>
                ) : null}
            </Modal>
        </>
    );
}

function RechargeOrderTag({ status }: { status: RechargeOrder["status"] }) {
    const label =
        ({ created: "已创建", prepay_running: "下单中", awaiting_payment: "待支付", prepay_uncertain: "待确认", paid: "已支付", credited: "已到账", closed: "已关闭", failed: "失败", review_required: "人工核对中" } as Record<string, string>)[status] ||
        status;
    const color = status === "credited" ? "success" : status === "awaiting_payment" || status === "prepay_running" ? "processing" : status === "review_required" || status === "failed" || status === "prepay_uncertain" ? "error" : "default";
    return <Tag color={color}>{label}</Tag>;
}

function newIdempotencyKey() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `recharge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
