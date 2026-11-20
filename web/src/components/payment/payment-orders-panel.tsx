import { useQuery } from "@tanstack/react-query";
import { Button, Pagination, Skeleton } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { currentLocale } from "@/i18n";
import { formatPaymentAmount, listPaymentOrders } from "@/services/api/payments";
import { useUserStore } from "@/stores/use-user-store";

export const paymentOrdersQueryKey = ["payment-orders"] as const;

export function PaymentOrdersPanel({ onOpen }: { onOpen: (id: string) => void }) {
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id);
    const [page, setPage] = useState(1);
    const query = useQuery({ queryKey: [...paymentOrdersQueryKey, userId, page], queryFn: ({ signal }) => listPaymentOrders(page, signal), enabled: Boolean(userId) });
    return (
        <div className="workspace-wallet-content is-history">
            <div className="workspace-wallet-history-toolbar">
                <div>
                    <h3>{t("account.payment.ordersTitle")}</h3>
                    <p>{t("account.payment.ordersHint")}</p>
                </div>
                <Button loading={query.isFetching} onClick={() => void query.refetch()}>
                    {t("common.refresh")}
                </Button>
            </div>
            <div className="workspace-wallet-history-scroll">
                {query.isError ? (
                    <div role="alert" className="workspace-wallet-inline-state is-error">
                        {query.error.message}
                    </div>
                ) : query.isPending ? (
                    <Skeleton active />
                ) : query.data?.orders.length ? (
                    <ul className="divide-y divide-border">
                        {query.data.orders.map((order) => (
                            <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <strong>{order.productName}</strong>
                                    <p className="text-sm text-muted-foreground">{order.merchantOrderNo}</p>
                                    <small>{new Date(order.createdAt).toLocaleString(currentLocale())}</small>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span>{formatPaymentAmount(order.amountFen, order.currency)}</span>
                                    <span>{t(`account.payment.status.${order.status}`)}</span>
                                    <Button onClick={() => onOpen(order.id)}>{t(order.status === "pending" ? "account.payment.continuePayment" : "account.payment.viewOrder")}</Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="workspace-wallet-empty">{t("account.payment.ordersEmpty")}</div>
                )}
            </div>
            <Pagination current={page} total={query.data?.total || 0} pageSize={20} showSizeChanger={false} onChange={setPage} />
        </div>
    );
}
