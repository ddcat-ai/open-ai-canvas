import { App, Button } from "antd";
import { CreditCard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { AppModal } from "@/components/ui/product/app-modal";
import { createClientUUID } from "@/lib/client-id";
import { paymentOrderGrantLabel } from "@/lib/payment-order-grant";
import { closePaymentOrder, createPaymentOrder, formatPaymentAmount, getPaymentOrder, queryPaymentOrder, refreshPaymentCheckout, type PaymentOrder } from "@/services/api/payments";

function grantedText(order: PaymentOrder) {
    return order.productKind === "storage" ? "支付已确认，存储空间已扩容" : "支付已确认，积分已经到账";
}

function notGrantedText(order: PaymentOrder) {
    return order.productKind === "storage" ? "订单已关闭，未产生扩容" : "订单已关闭，未产生积分充值";
}

/**
 * 在线支付下单、扫码、轮询、关单与重建收银台的共用流程。
 * onGranted 对每个订单只触发一次，调用方在其中刷新余额或容量。
 */
export function usePaymentOrderFlow({ onGranted }: { onGranted: (order: PaymentOrder) => Promise<void> | void }) {
    const { message } = App.useApp();
    const [order, setOrder] = useState<PaymentOrder | null>(null);
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const idempotencyKey = useRef("");
    const grantedOrderId = useRef("");
    const onGrantedRef = useRef(onGranted);
    onGrantedRef.current = onGranted;

    const settle = async (next: PaymentOrder) => {
        if (next.status !== "credited" || grantedOrderId.current === next.id) return;
        grantedOrderId.current = next.id;
        await onGrantedRef.current(next);
    };

    useEffect(() => {
        if (!open || !order || !["created", "pending", "closing"].includes(order.status)) return;
        const interval = window.setInterval(() => {
            void refresh(order.id, true);
        }, 4_000);
        return () => window.clearInterval(interval);
    }, [open, order?.id, order?.status]);

    useEffect(() => {
        if (!open) return;
        const interval = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [open]);

    /** 切换商品或支付方式后必须换新的幂等键，否则后端会拒绝“同键不同单”。 */
    const resetIdempotency = () => {
        idempotencyKey.current = "";
    };

    const start = async (productId: string, providerId: string) => {
        setCreating(true);
        try {
            if (!idempotencyKey.current) idempotencyKey.current = createClientUUID();
            const result = await createPaymentOrder({ productId, providerId, idempotencyKey: idempotencyKey.current });
            idempotencyKey.current = "";
            setOrder(result.order);
            await settle(result.order);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            }
            setOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
        } finally {
            setCreating(false);
        }
    };

    /** 支付跳转返回后展示指定订单的结果。 */
    const showOrder = async (orderId: string) => {
        try {
            const result = await getPaymentOrder(orderId);
            setOrder(result.order);
            setOpen(true);
            await settle(result.order);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付结果失败");
        }
    };

    async function refresh(orderId = order?.id, silent = false) {
        if (!orderId || querying) return;
        setQuerying(true);
        try {
            const result = await queryPaymentOrder(orderId);
            setOrder(result.order);
            if (result.order.status === "credited") {
                await settle(result.order);
                if (!silent) message.success(grantedText(result.order));
            } else if (!silent && result.order.status === "closed") message.warning(notGrantedText(result.order));
            else if (!silent) message.info("渠道尚未确认支付，请稍后再试");
        } catch (error) {
            if (!silent) message.error(error instanceof Error ? error.message : "查询支付结果失败");
        } finally {
            setQuerying(false);
        }
    }

    const cancel = async () => {
        if (!order) return;
        setQuerying(true);
        try {
            const result = await closePaymentOrder(order.id);
            setOrder(result.order);
            if (result.order.status === "credited") await settle(result.order);
            else message.success("未支付订单已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭订单失败");
        } finally {
            setQuerying(false);
        }
    };

    const retry = async () => {
        if (!order) return;
        setQuerying(true);
        try {
            const result = await refreshPaymentCheckout(order.id);
            setOrder(result.order);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) window.location.assign(result.order.checkout.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新支付入口失败");
        } finally {
            setQuerying(false);
        }
    };

    const close = () => setOpen(false);

    const dialog = (
        <AppModal
            open={open}
            title={order?.status === "credited" ? (order.productKind === "storage" ? "扩容完成" : "充值完成") : order?.checkout.mode === "qr_code" ? "扫码支付" : "确认支付结果"}
            centered
            width={430}
            onCancel={close}
            footer={paymentFooter(order, querying, close, cancel, () => refresh(), retry)}
        >
            {order ? (
                <div className="workspace-wallet-payment">
                    <span className="workspace-wallet-payment-icon">
                        <CreditCard />
                    </span>
                    <strong>{formatPaymentAmount(order.amountFen, order.currency)}</strong>
                    <p>
                        {order.productName} · {paymentOrderGrantLabel(order)}
                    </p>
                    {order.status === "pending" && order.checkout.mode === "qr_code" && order.checkout.value ? (
                        <>
                            <PaymentCheckoutCode value={order.checkout.value} />
                            <span>请使用支付应用扫码完成支付</span>
                        </>
                    ) : null}
                    <PaymentStatus order={order} now={clock} />
                </div>
            ) : null}
        </AppModal>
    );

    return { creating, start, showOrder, resetIdempotency, dialog };
}

function PaymentStatus({ order, now }: { order: PaymentOrder; now: number }) {
    if (order.status === "credited") return <div className="workspace-wallet-payment-status is-success">{grantedText(order)}</div>;
    if (order.status === "closed") return <div className="workspace-wallet-payment-status">{notGrantedText(order)}</div>;
    if (order.status === "create_failed") return <div className="workspace-wallet-payment-status is-error">支付入口创建失败，请重新生成支付入口。</div>;
    const remaining = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    return (
        <div className="workspace-wallet-payment-status">
            订单剩余 {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}，将自动确认支付结果
        </div>
    );
}

function paymentFooter(order: PaymentOrder | null, loading: boolean, close: () => void, cancel: () => Promise<void>, query: () => Promise<void>, retry: () => Promise<void>) {
    if (order?.status === "pending")
        return [
            <Button key="cancel" danger disabled={loading} onClick={() => void cancel()}>
                关闭订单
            </Button>,
            <Button key="query" type="primary" loading={loading} onClick={() => void query()}>
                我已完成支付
            </Button>,
        ];
    if (order?.status === "create_failed")
        return [
            <Button key="close" onClick={close}>
                稍后处理
            </Button>,
            <Button key="retry" type="primary" loading={loading} onClick={() => void retry()}>
                重新生成支付入口
            </Button>,
        ];
    return [
        <Button key="done" type="primary" onClick={close}>
            完成
        </Button>,
    ];
}
