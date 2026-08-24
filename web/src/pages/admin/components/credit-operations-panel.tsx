import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BadgeCheck, Coins, RefreshCw, Search, Settings2, Undo2, UserRoundCog } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listAdminUsers, type AdminReferenceData, type LocalUser } from "@/services/api/auth";
import { adjustAdminUserCredits, getAdminCreditPolicy, listAdminBillingOrders, resolveAdminBillingOrder, resolveAdminBillingOrders, updateAdminCreditPolicy, type BillingOrder } from "@/services/api/wallet";

import { AdminBatchBar, AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { useTranslation } from "react-i18next";

type AdjustmentFormValues = { userId: string; amount: number; note: string };
type ResolutionFormValues = { note: string };
type PolicyFormValues = { signupBonus: number; checkinBonus: number; defaultMultiplier: number; modelMultipliers: string };
type BillingResolutionAction = "settle" | "refund";
type BillingResolutionTarget = { kind: "single"; order: BillingOrder; action: BillingResolutionAction } | { kind: "batch"; orderIds: string[]; amountMicrocredits: number; action: BillingResolutionAction };

export default function CreditOperationsPanel({ users }: { users: AdminReferenceData["users"] }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [orders, setOrders] = useState<BillingOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [adjusting, setAdjusting] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [orderStatus, setOrderStatus] = useState<"review" | "all" | BillingOrder["status"]>("review");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [adjustmentUsers, setAdjustmentUsers] = useState<Array<AdminReferenceData["users"][number] | LocalUser>>(users);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [resolutionTarget, setResolutionTarget] = useState<BillingResolutionTarget | null>(null);
    const [adjustmentForm] = Form.useForm<AdjustmentFormValues>();
    const [resolutionForm] = Form.useForm<ResolutionFormValues>();
    const [policyForm] = Form.useForm<PolicyFormValues>();
    const [savingPolicy, setSavingPolicy] = useState(false);

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        setLoading(true);
        try {
            const result = await listAdminBillingOrders({ keyword: debouncedKeyword || undefined, status: orderStatus, page: targetPage, limit: targetPageSize });
            setOrders(result.orders);
            setTotal(result.total);
            setSelectedOrderIds([]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-load-pending-billing"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload(page, pageSize);
    }, [debouncedKeyword, orderStatus, page, pageSize]);

    useEffect(() => {
        setAdjustmentUsers(users);
    }, [users]);

    useEffect(() => {
        void getAdminCreditPolicy()
            .then(({ policy }) =>
                policyForm.setFieldsValue({
                    signupBonus: policy.signupBonusMicrocredits / 1_000_000,
                    checkinBonus: policy.checkinBonusMicrocredits / 1_000_000,
                    defaultMultiplier: policy.defaultMultiplierBasisPoints / 10_000,
                    modelMultipliers: Object.entries(policy.modelMultiplierBasisPoints)
                        .map(([model, value]) => `${model}=${value / 10_000}`)
                        .join("\n"),
                }),
            )
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-load-credit-policy")));
    }, [message, policyForm]);

    const savePolicy = async () => {
        const values = await policyForm.validateFields();
        const modelMultiplierBasisPoints: Record<string, number> = {};
        for (const line of String(values.modelMultipliers || "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)) {
            const [model, rawMultiplier, ...rest] = line.split("=");
            const multiplier = Number(rawMultiplier);
            if (!model?.trim() || rest.length || !Number.isFinite(multiplier) || multiplier <= 0) {
                message.error(t("admin:invalid-model-multiplier-format-param", { line: line }));
                return;
            }
            modelMultiplierBasisPoints[model.trim()] = Math.round(multiplier * 10_000);
        }
        setSavingPolicy(true);
        try {
            await updateAdminCreditPolicy({
                signupBonusMicrocredits: Math.round(values.signupBonus * 1_000_000),
                checkinBonusMicrocredits: Math.round(values.checkinBonus * 1_000_000),
                defaultMultiplierBasisPoints: Math.round(values.defaultMultiplier * 10_000),
                modelMultiplierBasisPoints,
            });
            message.success(t("admin:credit-policy-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-credit-policy"));
        } finally {
            setSavingPolicy(false);
        }
    };

    const searchUsers = async (value: string) => {
        setSearchingUsers(true);
        try {
            const result = await listAdminUsers({ keyword: value.trim() || undefined, page: 1, limit: 50 });
            setAdjustmentUsers(result.users);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-search-users"));
        } finally {
            setSearchingUsers(false);
        }
    };

    const adjust = async () => {
        const values = await adjustmentForm.validateFields();
        setAdjusting(true);
        try {
            await adjustAdminUserCredits(values.userId, { amountMicrocredits: Math.round(values.amount * 1_000_000), note: values.note.trim() });
            adjustmentForm.resetFields();
            message.success(t("admin:user-credits-adjusted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-adjust-credits"));
        } finally {
            setAdjusting(false);
        }
    };

    const resolveBilling = async () => {
        if (!resolutionTarget) return;
        const values = await resolutionForm.validateFields();
        const note = values.note.trim();
        setResolving(true);
        try {
            if (resolutionTarget.kind === "single") {
                await resolveAdminBillingOrder(resolutionTarget.order.id, { action: resolutionTarget.action, note });
            } else {
                const result = await resolveAdminBillingOrders({ ids: resolutionTarget.orderIds, action: resolutionTarget.action, note });
                if (result.failed.length > 0) {
                    const detail = result.failed[0]?.message ? `：${result.failed[0].message}` : "";
                    if (result.resolvedCount > 0) message.warning(t("admin:param-processed-param-failed-param", { resolvedCount: result.resolvedCount, length: result.failed.length, detail: detail }));
                    else message.error(t("admin:all-param-selected-orders-failed-param", { length: result.failed.length, detail: detail }));
                } else {
                    message.success(resolutionTarget.action === "settle" ? t("admin:param-charges-confirmed", { resolvedCount: result.resolvedCount }) : t("admin:param-refunds-issued", { resolvedCount: result.resolvedCount }));
                }
            }
            const resolvedAction = resolutionTarget.action;
            const wasBatch = resolutionTarget.kind === "batch";
            setResolutionTarget(null);
            resolutionForm.resetFields();
            await reload(page, pageSize);
            if (!wasBatch) message.success(resolvedAction === "settle" ? t("admin:billing-orders-settled") : t("admin:frozen-credits-refunded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-process-billing-orders"));
        } finally {
            setResolving(false);
        }
    };

    const openSingleResolution = (order: BillingOrder, action: BillingResolutionAction) => {
        setResolutionTarget({ kind: "single", order, action });
        resolutionForm.resetFields();
    };

    const openBatchResolution = (action: BillingResolutionAction) => {
        const selectedOrders = orders.filter((order) => selectedOrderIds.includes(order.id) && canResolveBillingOrder(order));
        if (selectedOrders.length === 0) return;
        setResolutionTarget({
            kind: "batch",
            orderIds: selectedOrders.map((order) => order.id),
            amountMicrocredits: selectedOrders.reduce((sum, order) => sum + order.amountMicrocredits, 0),
            action,
        });
        resolutionForm.resetFields();
    };

    const columns: ColumnsType<BillingOrder> = [
        { title: t("admin:created-at"), dataIndex: "createdAt", width: 170, render: formatTime },
        { title: t("admin:users-2"), dataIndex: "userId", width: 150, render: (id) => users.find((user) => user.id === id)?.displayName || id },
        {
            title: t("admin:model-scenario"),
            width: 220,
            render: (_, order) => (
                <div>
                    <div className="font-medium">{order.model}</div>
                    <div className="mt-0.5 text-xs text-foreground/50">{order.scene || order.capability}</div>
                </div>
            ),
        },
        { title: t("admin:pre-authorized-credits"), dataIndex: "amountMicrocredits", width: 120, align: "right", render: (value) => <span className="font-medium tabular-nums">{formatCredits(value)}</span> },
        {
            title: t("admin:settled-usage"),
            width: 190,
            render: (_, order) =>
                order.billingMode === "token" ? (
                    <div className="text-xs leading-5">
                        <div className="font-medium tabular-nums">{order.status === "settled" ? `${formatCredits(order.actualAmountMicrocredits)} 积分` : t("admin:awaiting-usage-settlement")}</div>
                        <div className="text-foreground/50">
                            {t("admin:in-2")} {order.inputTokens} {t("admin:out")} {order.outputTokens} {t("admin:cached")} {order.cachedTokens}
                        </div>
                    </div>
                ) : (
                    <span className="tabular-nums">{order.status === "settled" ? formatCredits(order.actualAmountMicrocredits || order.amountMicrocredits) : "--"}</span>
                ),
        },
        {
            title: t("admin:status"),
            dataIndex: "status",
            width: 105,
            render: (value) => (
                <AdminStatusBadge
                    label={({ uncertain: t("admin:to-verify"), running: t("admin:running"), reserved: t("admin:frozen"), settled: t("admin:settled"), refunded: t("admin:refunded") } as Record<string, string>)[value] || t("admin:unknown-status")}
                    tone={value === "settled" ? "success" : value === "refunded" ? "neutral" : "warning"}
                />
            ),
        },
        { title: t("admin:upstream-requests"), dataIndex: "providerRequestId", width: 180, ellipsis: true, render: (value) => value || t("admin:not-retrieved") },
        { title: t("admin:reason"), dataIndex: "error", width: 260, ellipsis: true, render: (value) => value || t("admin:billing-status-unclear") },
        {
            title: t("admin:process"),
            width: 180,
            render: (_, order) =>
                !canResolveBillingOrder(order) ? (
                    <span className="text-xs text-foreground/40">{t("admin:processing-finished")}</span>
                ) : (
                    <AdminRowActions
                        primary={{ label: t("admin:confirm-charge"), onClick: () => openSingleResolution(order, "settle") }}
                        actions={[{ key: "refund", label: t("admin:refund-credits"), danger: true, onClick: () => openSingleResolution(order, "refund") }]}
                    />
                ),
        },
    ];

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid shrink-0 gap-4 xl:grid-cols-2">
                <section className="rounded-lg bg-background p-4">
                    <div className="flex items-start gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                            <Settings2 className="size-4" />
                        </span>
                        <h2 className="pt-1 text-sm font-semibold">{t("admin:credit-policy")}</h2>
                    </div>
                    <Form form={policyForm} layout="vertical" requiredMark={false} className="mt-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Form.Item
                                name="signupBonus"
                                label={t("admin:sign-up-credits")}
                                rules={[
                                    { required: true, message: t("admin:enter-sign-up-credits") },
                                    { type: "number", min: 0 },
                                ]}
                            >
                                <InputNumber className="w-full" min={0} precision={6} />
                            </Form.Item>
                            <Form.Item
                                name="checkinBonus"
                                label={t("admin:daily-check-in-credits")}
                                rules={[
                                    { required: true, message: t("admin:enter-check-in-credits") },
                                    { type: "number", min: 0 },
                                ]}
                            >
                                <InputNumber className="w-full" min={0} precision={6} />
                            </Form.Item>
                            <Form.Item
                                name="defaultMultiplier"
                                label={t("admin:default-multiplier")}
                                rules={[
                                    { required: true, message: t("admin:enter-the-default-multiplier") },
                                    { type: "number", min: 0.0001, max: 100 },
                                ]}
                            >
                                <InputNumber className="w-full" min={0.0001} max={100} precision={4} />
                            </Form.Item>
                        </div>
                        <Form.Item name="modelMultipliers" label={t("admin:per-model-multipliers")} extra={t("admin:one-per-line-model-multiplier")}>
                            <Input.TextArea rows={2} placeholder={"gpt-image-1=1.5\nseedance-1.0-pro=2"} />
                        </Form.Item>
                        <Button type="primary" loading={savingPolicy} onClick={() => void savePolicy()}>
                            {t("admin:save-credit-policy")}
                        </Button>
                    </Form>
                </section>
                <section className="rounded-lg bg-background p-4">
                    <div className="flex items-start gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                            <UserRoundCog className="size-4" />
                        </span>
                        <h2 className="pt-1 text-sm font-semibold">{t("admin:manual-credit-adjustment")}</h2>
                    </div>
                    <Form form={adjustmentForm} layout="vertical" requiredMark={false} className="mt-3">
                        <Form.Item name="userId" label={t("admin:target-user")} rules={[{ required: true, message: t("admin:select-a-user") }]}>
                            <Select
                                showSearch
                                filterOption={false}
                                loading={searchingUsers}
                                placeholder={t("admin:search-usernames-or-display-names")}
                                onSearch={(value) => void searchUsers(value)}
                                options={adjustmentUsers.map((user) => ({ label: `${user.displayName || user.username} · @${user.username}`, value: user.id }))}
                            />
                        </Form.Item>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item name="amount" label={t("admin:credit-change")} rules={[{ required: true, message: t("admin:enter-the-credit-change") }]}>
                                <InputNumber className="w-full" precision={6} prefix={<Coins className="size-3.5 text-foreground/45" />} placeholder={t("admin:e-g-10-or-2")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("admin:adjustment-reason")} rules={[{ required: true, message: t("admin:enter-the-adjustment-reason") }]}>
                                <Input maxLength={500} placeholder={t("admin:ticket-number-or-rationale")} />
                            </Form.Item>
                        </div>
                        <Button type="primary" loading={adjusting} onClick={() => void adjust()}>
                            {t("admin:confirm-adjustment")}
                        </Button>
                    </Form>
                </section>
            </div>

            <section className="flex min-h-0 flex-1">
                <AdminDataTable
                    toolbar={
                        <Input
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("admin:search-users-models-scenarios-or-request-ids")}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                    }
                    toolbarActiveFilters={
                        <>
                            {keyword ? (
                                <AdminFilterChip
                                    label={t("admin:search-param", { keyword: keyword })}
                                    onRemove={() => {
                                        setKeyword("");
                                        setPage(1);
                                    }}
                                />
                            ) : null}
                            {orderStatus !== "review" ? (
                                <AdminFilterChip
                                    label={`队列：${orderStatus === "all" ? t("admin:all-history") : orderStatus}`}
                                    onRemove={() => {
                                        setOrderStatus("review");
                                        setPage(1);
                                    }}
                                />
                            ) : null}
                        </>
                    }
                    toolbarActive={Boolean(keyword || orderStatus !== "review")}
                    toolbarFilters={
                        <Select
                            className="w-36"
                            value={orderStatus}
                            onChange={(value) => {
                                setOrderStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: t("admin:verification-queue"), value: "review" },
                                { label: t("admin:all-history"), value: "all" },
                                { label: t("admin:billing-pending-verification"), value: "uncertain" },
                                { label: t("admin:running"), value: "running" },
                                { label: t("admin:frozen"), value: "reserved" },
                                { label: t("admin:settled"), value: "settled" },
                                { label: t("admin:refunded"), value: "refunded" },
                            ]}
                        />
                    }
                    onReset={() => {
                        setKeyword("");
                        setOrderStatus("review");
                        setPage(1);
                    }}
                    trailing={
                        <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void reload()}>
                            {t("admin:refresh-3")}
                        </Button>
                    }
                    batchActions={
                        <AdminBatchBar count={selectedOrderIds.length} onClear={() => setSelectedOrderIds([])}>
                            <Button size="small" type="primary" icon={<BadgeCheck className="size-3.5" />} onClick={() => openBatchResolution("settle")}>
                                {t("admin:batch-confirm-charges")}
                            </Button>
                            <Button size="small" danger icon={<Undo2 className="size-3.5" />} onClick={() => openBatchResolution("refund")}>
                                {t("admin:batch-refund-credits")}
                            </Button>
                        </AdminBatchBar>
                    }
                    table={{
                        className: "app-data-table",
                        rowKey: "id",
                        size: "small",
                        loading,
                        pagination: false,
                        columns,
                        dataSource: orders,
                        rowSelection: {
                            selectedRowKeys: selectedOrderIds,
                            preserveSelectedRowKeys: false,
                            onChange: (keys) => setSelectedOrderIds(keys.map(String)),
                            getCheckboxProps: (order) => ({ disabled: !canResolveBillingOrder(order), name: `${order.model} ${order.scene || order.capability}` }),
                        },
                        scroll: { x: 1390 },
                    }}
                    empty={<AdminTableEmpty filtered={Boolean(keyword || orderStatus !== "review")} title={t("admin:no-billing-orders")} />}
                    footer={
                        <PaginationBar
                            alwaysShow
                            current={page}
                            pageSize={pageSize}
                            total={total}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    }
                />
            </section>

            <Modal
                title={
                    resolutionTarget?.action === "settle"
                        ? resolutionTarget.kind === "batch"
                            ? t("admin:batch-confirm-charging-frozen-credits")
                            : t("admin:confirm-charging-frozen-credits")
                        : resolutionTarget?.kind === "batch"
                          ? t("admin:batch-confirm-refunding-frozen-credits")
                          : t("admin:confirm-refunding-frozen-credits")
                }
                open={Boolean(resolutionTarget)}
                okText={resolutionTarget?.action === "settle" ? t("admin:confirm-charge") : t("admin:refund-credits")}
                cancelText={t("admin:cancel-4")}
                onCancel={() => {
                    if (resolving) return;
                    setResolutionTarget(null);
                    resolutionForm.resetFields();
                }}
                onOk={() => void resolveBilling()}
                confirmLoading={resolving}
                maskClosable={!resolving}
                okButtonProps={{ danger: resolutionTarget?.action === "refund" }}
            >
                {resolutionTarget?.kind === "batch" ? (
                    <div className="mb-4 rounded-md border border-border bg-muted/25 px-3 py-2.5 text-sm text-foreground/65">
                        {t("admin:selected-2")} <span className="font-semibold text-foreground">{resolutionTarget.orderIds.length}</span> {t("admin:orders-involving-frozen-credits")}{" "}
                        <span className="font-semibold tabular-nums text-foreground">{formatCredits(resolutionTarget.amountMicrocredits)}</span>
                        {t("admin:the-verification-rationale-is-written-into-each-order-s-audit-record")}
                    </div>
                ) : null}
                <Form form={resolutionForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="note" label={t("admin:verification-rationale")} rules={[{ required: true, whitespace: true, message: t("admin:enter-vendor-billing-info-task-status-or-processing-rationale") }]}>
                        <Input.TextArea rows={4} maxLength={500} placeholder={t("admin:e-g-vendor-console-confirms-this-request-incurred-no-charges")} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

function canResolveBillingOrder(order: BillingOrder) {
    return order.status === "uncertain" || order.status === "running" || order.status === "reserved";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
