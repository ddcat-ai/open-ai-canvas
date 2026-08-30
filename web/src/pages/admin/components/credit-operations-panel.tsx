import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BadgeCheck, Coins, Plus, RefreshCw, Search, Trash2, Undo2 } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listAdminUsers, type AdminReferenceData, type AdminUser } from "@/services/api/auth";
import { adjustAdminUserCredits, getAdminCreditPolicy, listAdminBillingOrders, resolveAdminBillingOrder, resolveAdminBillingOrders, updateAdminCreditPolicy, type BillingOrder } from "@/services/api/wallet";

import { AdminBatchBar, AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

export type CreditOperation = "policy" | "adjustment" | null;

type AdjustmentFormValues = { userId: string; amount: number; note: string };
type ResolutionFormValues = { note: string };
type PolicyMultiplierRow = { model?: string; multiplier?: number };
type PolicyFormValues = { signupBonus: number; checkinBonus: number; defaultMultiplier: number; modelMultipliers: PolicyMultiplierRow[] };
type BillingResolutionAction = "settle" | "refund";
type AdjustmentUser = AdminReferenceData["users"][number] & Partial<Pick<AdminUser, "email" | "availableMicrocredits" | "reservedMicrocredits">>;
type BillingResolutionTarget = { kind: "single"; order: BillingOrder; action: BillingResolutionAction } | { kind: "batch"; orders: BillingOrder[]; action: BillingResolutionAction };

const billingStatusLabels = {
    uncertain: "待核对",
    running: "运行中",
    reserved: "已预授权",
    settled: "已结算",
    refunded: "已退款",
} satisfies Record<BillingOrder["status"], string>;

export default function CreditOperationsPanel({ users, activeOperation, onOperationChange }: { users: AdminReferenceData["users"]; activeOperation: CreditOperation; onOperationChange: (operation: CreditOperation) => void }) {
    const { message } = App.useApp();
    const [orders, setOrders] = useState<BillingOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingPolicy, setLoadingPolicy] = useState(false);
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [adjusting, setAdjusting] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [orderStatus, setOrderStatus] = useState<"review" | "all" | BillingOrder["status"]>("review");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [adjustmentUsers, setAdjustmentUsers] = useState<AdjustmentUser[]>(users);
    const [adjustmentSearch, setAdjustmentSearch] = useState("");
    const debouncedAdjustmentSearch = useDebouncedValue(adjustmentSearch);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [pendingAdjustment, setPendingAdjustment] = useState<AdjustmentFormValues | null>(null);
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [resolutionTarget, setResolutionTarget] = useState<BillingResolutionTarget | null>(null);
    const [adjustmentForm] = Form.useForm<AdjustmentFormValues>();
    const [resolutionForm] = Form.useForm<ResolutionFormValues>();
    const [policyForm] = Form.useForm<PolicyFormValues>();
    const ordersRequestRef = useRef(0);
    const userSearchRequestRef = useRef(0);
    const selectedAdjustmentUserId = Form.useWatch("userId", adjustmentForm);

    const userLabels = useMemo(() => {
        const labels = new Map<string, string>();
        for (const user of [...users, ...adjustmentUsers]) labels.set(user.id, user.displayName || user.username);
        return labels;
    }, [adjustmentUsers, users]);
    const selectedAdjustmentUser = adjustmentUsers.find((user) => user.id === selectedAdjustmentUserId);
    const pendingAdjustmentUser = adjustmentUsers.find((user) => user.id === pendingAdjustment?.userId);

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        const requestId = ++ordersRequestRef.current;
        setLoading(true);
        try {
            const result = await listAdminBillingOrders({
                keyword: debouncedKeyword || undefined,
                status: orderStatus,
                page: targetPage,
                limit: targetPageSize,
            });
            if (requestId !== ordersRequestRef.current) return;
            if (targetPage > 1 && result.total > 0 && result.orders.length === 0) {
                setPage(1);
                return;
            }
            setOrders(result.orders);
            setTotal(result.total);
            setSelectedOrderIds([]);
        } catch (error) {
            if (requestId === ordersRequestRef.current) message.error(error instanceof Error ? error.message : "读取待核对计费失败");
        } finally {
            if (requestId === ordersRequestRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload(page, pageSize);
    }, [debouncedKeyword, orderStatus, page, pageSize]);

    useEffect(() => {
        if (activeOperation !== "policy") return;
        let active = true;
        setLoadingPolicy(true);
        void getAdminCreditPolicy()
            .then(({ policy }) => {
                if (!active) return;
                policyForm.setFieldsValue({
                    signupBonus: policy.signupBonusMicrocredits / 1_000_000,
                    checkinBonus: policy.checkinBonusMicrocredits / 1_000_000,
                    defaultMultiplier: policy.defaultMultiplierBasisPoints / 10_000,
                    modelMultipliers: Object.entries(policy.modelMultiplierBasisPoints).map(([model, value]) => ({
                        model,
                        multiplier: value / 10_000,
                    })),
                });
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "读取积分策略失败");
            })
            .finally(() => {
                if (active) setLoadingPolicy(false);
            });
        return () => {
            active = false;
        };
    }, [activeOperation, message, policyForm]);

    useEffect(() => {
        if (activeOperation !== "adjustment") return;
        adjustmentForm.resetFields();
        setPendingAdjustment(null);
        setAdjustmentSearch("");
        setAdjustmentUsers(users);
    }, [activeOperation, adjustmentForm, users]);

    useEffect(() => {
        if (activeOperation !== "adjustment") return;
        const requestId = ++userSearchRequestRef.current;
        setSearchingUsers(true);
        void listAdminUsers({ keyword: debouncedAdjustmentSearch.trim() || undefined, page: 1, limit: 50 })
            .then((result) => {
                if (requestId !== userSearchRequestRef.current) return;
                const selectedId = adjustmentForm.getFieldValue("userId");
                setAdjustmentUsers((current) => {
                    const selected = current.find((user) => user.id === selectedId);
                    if (selected && !result.users.some((user) => user.id === selected.id)) return [selected, ...result.users];
                    return result.users;
                });
            })
            .catch((error) => {
                if (requestId === userSearchRequestRef.current) message.error(error instanceof Error ? error.message : "搜索用户失败");
            })
            .finally(() => {
                if (requestId === userSearchRequestRef.current) setSearchingUsers(false);
            });
    }, [activeOperation, adjustmentForm, debouncedAdjustmentSearch, message]);

    const savePolicy = async (values: PolicyFormValues) => {
        const modelMultiplierBasisPoints: Record<string, number> = {};
        for (const row of values.modelMultipliers || []) {
            const model = String(row.model || "").trim();
            const multiplier = Number(row.multiplier);
            if (!model || !Number.isFinite(multiplier) || multiplier < 0.0001 || multiplier > 100) {
                message.error("请完整填写模型标识与 0.0001–100 之间的倍率");
                return;
            }
            if (model in modelMultiplierBasisPoints) {
                message.error(`模型“${model}”配置了重复倍率`);
                return;
            }
            modelMultiplierBasisPoints[model] = Math.round(multiplier * 10_000);
        }
        setSavingPolicy(true);
        try {
            await updateAdminCreditPolicy({
                signupBonusMicrocredits: toMicrocredits(values.signupBonus),
                checkinBonusMicrocredits: toMicrocredits(values.checkinBonus),
                defaultMultiplierBasisPoints: Math.round(values.defaultMultiplier * 10_000),
                modelMultiplierBasisPoints,
            });
            message.success("积分策略已保存，将应用于后续创建的计费订单");
            onOperationChange(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存积分策略失败");
        } finally {
            setSavingPolicy(false);
        }
    };

    const previewAdjustment = (values: AdjustmentFormValues) => {
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount === 0) {
            message.error("积分变化不能为 0");
            return;
        }
        try {
            toMicrocredits(amount);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分变化超出可处理范围");
            return;
        }
        const user = adjustmentUsers.find((item) => item.id === values.userId);
        if (amount < 0 && hasCreditBalance(user) && user.availableMicrocredits + toMicrocredits(amount) < 0) {
            message.error("扣减后可用积分不能低于 0");
            return;
        }
        setPendingAdjustment({ ...values, amount, note: values.note.trim() });
    };

    const applyAdjustment = async () => {
        if (!pendingAdjustment) return;
        setAdjusting(true);
        try {
            const result = await adjustAdminUserCredits(pendingAdjustment.userId, {
                amountMicrocredits: toMicrocredits(pendingAdjustment.amount),
                note: pendingAdjustment.note,
            });
            setAdjustmentUsers((current) =>
                current.map((user) =>
                    user.id === result.account.userId
                        ? {
                              ...user,
                              availableMicrocredits: result.account.availableMicrocredits,
                              reservedMicrocredits: result.account.reservedMicrocredits,
                          }
                        : user,
                ),
            );
            adjustmentForm.resetFields();
            setPendingAdjustment(null);
            onOperationChange(null);
            message.success(`用户积分已调整，当前可用积分 ${formatCredits(result.account.availableMicrocredits)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整积分失败");
        } finally {
            setAdjusting(false);
        }
    };

    const resolveBilling = async () => {
        if (!resolutionTarget) return;
        let values: ResolutionFormValues;
        try {
            values = await resolutionForm.validateFields();
        } catch {
            return;
        }
        const note = values.note.trim();
        setResolving(true);
        try {
            if (resolutionTarget.kind === "single") {
                await resolveAdminBillingOrder(resolutionTarget.order.id, { action: resolutionTarget.action, note });
                message.success(resolutionTarget.action === "settle" ? "计费订单已结算" : "预授权积分已退回");
            } else {
                const result = await resolveAdminBillingOrders({
                    ids: resolutionTarget.orders.map((order) => order.id),
                    action: resolutionTarget.action,
                    note,
                });
                if (result.failed.length > 0) {
                    const failedIds = new Set(result.failed.map((item) => item.id));
                    const failedOrders = resolutionTarget.orders.filter((order) => failedIds.has(order.id));
                    const detail = result.failed[0]?.message ? `：${result.failed[0].message}` : "";
                    if (result.resolvedCount > 0) message.warning(`已处理 ${result.resolvedCount} 条，仍有 ${result.failed.length} 条失败${detail}`);
                    else message.error(`所选 ${result.failed.length} 条订单均处理失败${detail}`);
                    setResolutionTarget({ ...resolutionTarget, orders: failedOrders.length > 0 ? failedOrders : resolutionTarget.orders });
                    await reload(page, pageSize);
                    return;
                }
                message.success(resolutionTarget.action === "settle" ? `已结算 ${result.resolvedCount} 条订单` : `已退回 ${result.resolvedCount} 条订单的预授权积分`);
            }
            setResolutionTarget(null);
            resolutionForm.resetFields();
            await reload(page, pageSize);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "处理计费订单失败");
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
        setResolutionTarget({ kind: "batch", orders: selectedOrders, action });
        resolutionForm.resetFields();
    };

    const columns: ColumnsType<BillingOrder> = [
        { title: "创建时间", dataIndex: "createdAt", width: 170, align: "center", render: formatTime },
        {
            title: "用户",
            dataIndex: "userId",
            width: 150,
            render: (id: string) => (
                <div>
                    <div className="font-medium">{userLabels.get(id) || "未知用户"}</div>
                    <div className="mt-0.5 truncate text-xs text-foreground/50" title={id}>
                        {id}
                    </div>
                </div>
            ),
        },
        {
            title: "模型 / 场景",
            width: 220,
            render: (_, order) => (
                <div>
                    <div className="font-medium">{order.model}</div>
                    <div className="mt-0.5 text-xs text-foreground/50">{order.scene || order.capability}</div>
                </div>
            ),
        },
        {
            title: "预授权积分",
            width: 125,
            align: "center",
            render: (_, order) => <span className="font-medium tabular-nums">{formatCredits(getReservedAmount(order))}</span>,
        },
        {
            title: "实际结算 / 用量",
            width: 205,
            align: "center",
            render: (_, order) =>
                order.billingMode === "token" ? (
                    <div className="text-xs leading-5">
                        <div className="font-medium tabular-nums">{order.status === "settled" ? `${formatCredits(order.actualAmountMicrocredits)} 积分` : "等待用量结算"}</div>
                        <div className="text-foreground/50">
                            输入 {order.inputTokens} · 输出 {order.outputTokens} · 缓存 {order.cachedTokens}
                        </div>
                    </div>
                ) : (
                    <span className="tabular-nums">{order.status === "settled" ? formatCredits(order.actualAmountMicrocredits) : "--"}</span>
                ),
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 110,
            align: "center",
            render: (value: BillingOrder["status"]) => <AdminStatusBadge label={billingStatusLabels[value]} tone={value === "settled" ? "success" : value === "refunded" ? "neutral" : "warning"} />,
        },
        { title: "上游请求", dataIndex: "providerRequestId", width: 180, ellipsis: true, render: (value) => value || "未获取" },
        { title: "核对原因", dataIndex: "error", width: 260, ellipsis: true, render: (value) => value || "费用状态不明确" },
        {
            title: "操作",
            width: 190,
            align: "center",
            fixed: "right",
            render: (_, order) =>
                !canResolveBillingOrder(order) ? (
                    <span className="text-xs text-foreground/45">处理完成</span>
                ) : (
                    <div className="flex justify-center">
                        <AdminRowActions primary={{ label: "确认结算", onClick: () => openSingleResolution(order, "settle") }} actions={[{ key: "refund", label: "退回预授权", danger: true, onClick: () => openSingleResolution(order, "refund") }]} />
                    </div>
                ),
        },
    ];

    const hasFilters = Boolean(keyword || orderStatus !== "review");
    const resolutionOrders = resolutionTarget?.kind === "batch" ? resolutionTarget.orders : resolutionTarget ? [resolutionTarget.order] : [];
    const resolutionReservedTotal = resolutionOrders.reduce((sum, order) => sum + getReservedAmount(order), 0);
    const resolutionTitle = resolutionTarget ? (resolutionTarget.action === "settle" ? (resolutionTarget.kind === "batch" ? "批量确认结算" : "确认结算计费订单") : resolutionTarget.kind === "batch" ? "批量退回预授权积分" : "确认退回预授权积分") : "";

    return (
        <div className="admin-credit-operations flex min-h-0 flex-1 flex-col">
            <section className="admin-credit-operations-table-region flex min-h-0 flex-1" aria-labelledby="credit-review-heading">
                <h2 id="credit-review-heading" className="sr-only">
                    异常计费核对
                </h2>
                <AdminDataTable
                    toolbar={
                        <Input
                            allowClear
                            aria-label="搜索计费订单"
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索用户、模型、场景或请求号"
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                    }
                    toolbarActive={hasFilters}
                    toolbarFilters={
                        <Select
                            aria-label="筛选计费队列"
                            className="w-40"
                            value={orderStatus}
                            onChange={(value) => {
                                setOrderStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: "待核对队列", value: "review" },
                                { label: "全部历史", value: "all" },
                                { label: "费用待核对", value: "uncertain" },
                                { label: "运行中", value: "running" },
                                { label: "已预授权", value: "reserved" },
                                { label: "已结算", value: "settled" },
                                { label: "已退款", value: "refunded" },
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
                            刷新
                        </Button>
                    }
                    batchActions={
                        <AdminBatchBar count={selectedOrderIds.length} onClear={() => setSelectedOrderIds([])}>
                            <Button size="small" type="primary" icon={<BadgeCheck className="size-3.5" />} onClick={() => openBatchResolution("settle")}>
                                批量确认结算
                            </Button>
                            <Button size="small" danger icon={<Undo2 className="size-3.5" />} onClick={() => openBatchResolution("refund")}>
                                批量退回预授权
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
                            getCheckboxProps: (order) => ({
                                disabled: !canResolveBillingOrder(order),
                                name: `${order.model} ${order.scene || order.capability}`,
                            }),
                        },
                        scroll: { x: 1510 },
                    }}
                    empty={<AdminTableEmpty filtered={hasFilters} title={!hasFilters ? "当前没有待核对订单" : undefined} description={!hasFilters ? "新的异常计费订单会自动出现在这里。" : undefined} />}
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

            <Drawer
                title="积分策略"
                open={activeOperation === "policy"}
                size="min(700px, 100vw)"
                onClose={() => {
                    if (!savingPolicy) onOperationChange(null);
                }}
                rootClassName="admin-drawer admin-credit-drawer"
                destroyOnHidden
                mask={{ closable: !savingPolicy }}
                keyboard={!savingPolicy}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={savingPolicy} onClick={() => onOperationChange(null)}>
                            取消
                        </Button>
                        <Button type="primary" loading={savingPolicy} disabled={loadingPolicy} onClick={() => policyForm.submit()}>
                            保存策略
                        </Button>
                    </div>
                }
            >
                <div className="admin-credit-drawer-intro">
                    <strong>后续订单计费规则</strong>
                    <p>修改只影响保存后创建的新订单，不会追溯调整历史订单。</p>
                </div>
                {loadingPolicy ? (
                    <div className="admin-credit-drawer-loading" role="status">
                        正在读取积分策略…
                    </div>
                ) : (
                    <Form form={policyForm} layout="vertical" requiredMark={false} initialValues={{ modelMultipliers: [] }} onFinish={(values) => void savePolicy(values)}>
                        <section className="admin-credit-drawer-section">
                            <div className="admin-credit-drawer-section-heading">
                                <h3>基础规则</h3>
                                <p>积分支持最多 6 位小数，倍率支持最多 4 位小数。</p>
                            </div>
                            <div className="admin-credit-policy-grid">
                                <Form.Item
                                    name="signupBonus"
                                    label="注册赠送积分"
                                    rules={[
                                        { required: true, message: "请填写注册积分" },
                                        { type: "number", min: 0, max: 1_000_000, message: "请输入 0–1,000,000" },
                                    ]}
                                >
                                    <InputNumber className="w-full" min={0} max={1_000_000} precision={6} />
                                </Form.Item>
                                <Form.Item
                                    name="checkinBonus"
                                    label="每日签到积分"
                                    rules={[
                                        { required: true, message: "请填写签到积分" },
                                        { type: "number", min: 0, max: 100_000, message: "请输入 0–100,000" },
                                    ]}
                                >
                                    <InputNumber className="w-full" min={0} max={100_000} precision={6} />
                                </Form.Item>
                                <Form.Item
                                    name="defaultMultiplier"
                                    label="默认计费倍率"
                                    rules={[
                                        { required: true, message: "请填写默认倍率" },
                                        { type: "number", min: 0.0001, max: 100, message: "请输入 0.0001–100" },
                                    ]}
                                >
                                    <InputNumber className="w-full" min={0.0001} max={100} precision={4} />
                                </Form.Item>
                            </div>
                        </section>

                        <section className="admin-credit-drawer-section">
                            <Form.List name="modelMultipliers">
                                {(fields, { add, remove }) => (
                                    <>
                                        <div className="admin-credit-drawer-section-heading admin-credit-drawer-section-heading-with-action">
                                            <div>
                                                <h3>模型独立倍率</h3>
                                                <p>仅为需要覆盖默认倍率的模型添加规则。</p>
                                            </div>
                                            <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => add({ model: "", multiplier: 1 })}>
                                                添加模型
                                            </Button>
                                        </div>
                                        {fields.length > 0 ? (
                                            <div className="admin-credit-multiplier-list">
                                                <div className="admin-credit-multiplier-header" aria-hidden="true">
                                                    <span>模型标识</span>
                                                    <span>倍率</span>
                                                    <span>操作</span>
                                                </div>
                                                {fields.map((field, index) => (
                                                    <div className="admin-credit-multiplier-row" key={field.key}>
                                                        <Form.Item name={[field.name, "model"]} rules={[{ required: true, whitespace: true, message: "请填写模型标识" }]}>
                                                            <Input aria-label={`第 ${index + 1} 行模型标识`} placeholder="例如 gpt-image-1" />
                                                        </Form.Item>
                                                        <Form.Item
                                                            name={[field.name, "multiplier"]}
                                                            rules={[
                                                                { required: true, message: "请填写倍率" },
                                                                { type: "number", min: 0.0001, max: 100, message: "请输入 0.0001–100" },
                                                            ]}
                                                        >
                                                            <InputNumber aria-label={`第 ${index + 1} 行倍率`} className="w-full" min={0.0001} max={100} precision={4} />
                                                        </Form.Item>
                                                        <Button type="text" danger className="admin-credit-multiplier-remove" icon={<Trash2 className="size-4" />} aria-label={`删除第 ${index + 1} 条模型倍率`} onClick={() => remove(field.name)} />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="admin-credit-multiplier-empty">暂无模型独立倍率，所有模型使用默认倍率。</div>
                                        )}
                                    </>
                                )}
                            </Form.List>
                        </section>
                    </Form>
                )}
            </Drawer>

            <Drawer
                title="人工调账"
                open={activeOperation === "adjustment"}
                size="min(580px, 100vw)"
                onClose={() => {
                    if (adjusting || pendingAdjustment) return;
                    onOperationChange(null);
                }}
                rootClassName="admin-drawer admin-credit-drawer"
                destroyOnHidden
                mask={{ closable: !adjusting && !pendingAdjustment }}
                keyboard={!adjusting && !pendingAdjustment}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={adjusting} onClick={() => onOperationChange(null)}>
                            取消
                        </Button>
                        <Button type="primary" disabled={adjusting} onClick={() => adjustmentForm.submit()}>
                            核对并继续
                        </Button>
                    </div>
                }
            >
                <div className="admin-credit-drawer-intro is-warning">
                    <strong>账务写入操作</strong>
                    <p>提交后会立即写入积分流水和管理员审计记录，请填写可追溯的处理依据。</p>
                </div>
                <Form form={adjustmentForm} layout="vertical" requiredMark={false} onFinish={previewAdjustment}>
                    <section className="admin-credit-drawer-section">
                        <Form.Item name="userId" label="目标用户" rules={[{ required: true, message: "请选择用户" }]}>
                            <Select
                                showSearch
                                filterOption={false}
                                loading={searchingUsers}
                                aria-label="搜索并选择调账用户"
                                placeholder="搜索用户名、显示名称或邮箱"
                                onSearch={setAdjustmentSearch}
                                options={adjustmentUsers.map((user) => ({
                                    label: `${user.displayName || user.username} · @${user.username}`,
                                    value: user.id,
                                }))}
                            />
                        </Form.Item>
                        {selectedAdjustmentUser ? <CreditAccountSummary user={selectedAdjustmentUser} /> : null}
                        <Form.Item
                            name="amount"
                            label="积分变化"
                            extra="正数增加，负数扣减；扣减只能使用可用积分。"
                            rules={[
                                { required: true, message: "请填写积分变化" },
                                {
                                    validator: (_, value) => (typeof value === "number" && Number.isFinite(value) && value !== 0 ? Promise.resolve() : Promise.reject(new Error("积分变化不能为 0"))),
                                },
                            ]}
                        >
                            <InputNumber className="w-full" precision={6} prefix={<Coins className="size-3.5 text-foreground/45" />} placeholder="例如 10 或 -2" />
                        </Form.Item>
                        <Form.Item name="note" label="调整原因" rules={[{ required: true, whitespace: true, message: "请填写工单号或处理依据" }]}>
                            <Input.TextArea rows={4} maxLength={500} showCount placeholder="例如：工单 YC-20260828，补偿失败任务费用" />
                        </Form.Item>
                    </section>
                </Form>
            </Drawer>

            <Modal
                title={pendingAdjustment?.amount && pendingAdjustment.amount < 0 ? "确认扣减用户积分" : "确认增加用户积分"}
                open={Boolean(pendingAdjustment)}
                okText={pendingAdjustment?.amount && pendingAdjustment.amount < 0 ? "确认扣减" : "确认增加"}
                cancelText="返回修改"
                onCancel={() => {
                    if (!adjusting) setPendingAdjustment(null);
                }}
                onOk={() => void applyAdjustment()}
                confirmLoading={adjusting}
                mask={{ closable: !adjusting }}
                closable={!adjusting}
                destroyOnHidden
                rootClassName="admin-modal-root"
                okButtonProps={{ danger: Boolean(pendingAdjustment && pendingAdjustment.amount < 0) }}
            >
                {pendingAdjustment ? (
                    <div className="admin-operation-confirmation">
                        <p className="admin-operation-confirmation-copy">请再次核对用户、积分变化和处理依据。确认后将立即写入账务流水。</p>
                        <dl className="admin-operation-confirmation-grid">
                            <div>
                                <dt>目标用户</dt>
                                <dd>{formatUserLabel(pendingAdjustmentUser, pendingAdjustment.userId)}</dd>
                            </div>
                            <div>
                                <dt>积分变化</dt>
                                <dd className={pendingAdjustment.amount < 0 ? "is-negative" : "is-positive"}>
                                    {pendingAdjustment.amount > 0 ? "+" : ""}
                                    {formatCredits(toMicrocredits(pendingAdjustment.amount))}
                                </dd>
                            </div>
                            {hasCreditBalance(pendingAdjustmentUser) ? (
                                <>
                                    <div>
                                        <dt>当前可用</dt>
                                        <dd>{formatCredits(pendingAdjustmentUser.availableMicrocredits)}</dd>
                                    </div>
                                    <div>
                                        <dt>预计可用</dt>
                                        <dd>{formatCredits(pendingAdjustmentUser.availableMicrocredits + toMicrocredits(pendingAdjustment.amount))}</dd>
                                    </div>
                                </>
                            ) : null}
                            <div className="is-wide">
                                <dt>处理依据</dt>
                                <dd>{pendingAdjustment.note}</dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Modal>

            <Modal
                title={resolutionTitle}
                open={Boolean(resolutionTarget)}
                okText={resolutionTarget?.action === "settle" ? "确认结算" : "退回预授权"}
                cancelText="取消"
                onCancel={() => {
                    if (resolving) return;
                    setResolutionTarget(null);
                    resolutionForm.resetFields();
                }}
                onOk={() => void resolveBilling()}
                confirmLoading={resolving}
                mask={{ closable: !resolving }}
                closable={!resolving}
                destroyOnHidden
                rootClassName="admin-modal-root"
                okButtonProps={{ danger: resolutionTarget?.action === "refund" }}
            >
                {resolutionTarget ? (
                    <div className="admin-operation-confirmation">
                        <p className="admin-operation-confirmation-copy">{resolutionTarget.action === "settle" ? "结算会依据订单计费方式确认实际费用；Token 订单可能退回差额，也可能补扣可用积分。" : "退回操作只会释放尚未结算订单的预授权积分。"}</p>
                        <dl className="admin-operation-confirmation-grid">
                            <div>
                                <dt>订单数量</dt>
                                <dd>{resolutionOrders.length} 条</dd>
                            </div>
                            <div>
                                <dt>预授权总额</dt>
                                <dd>{formatCredits(resolutionReservedTotal)} 积分</dd>
                            </div>
                            {resolutionTarget.kind === "single" ? (
                                <>
                                    <div>
                                        <dt>用户</dt>
                                        <dd>{userLabels.get(resolutionTarget.order.userId) || resolutionTarget.order.userId}</dd>
                                    </div>
                                    <div>
                                        <dt>模型 / 场景</dt>
                                        <dd>
                                            {resolutionTarget.order.model} · {resolutionTarget.order.scene || resolutionTarget.order.capability}
                                        </dd>
                                    </div>
                                    <div className="is-wide">
                                        <dt>订单编号</dt>
                                        <dd className="admin-monospace">{resolutionTarget.order.id}</dd>
                                    </div>
                                </>
                            ) : null}
                        </dl>
                    </div>
                ) : null}
                <Form form={resolutionForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="note" label="核对依据" rules={[{ required: true, whitespace: true, message: "请填写供应商账单、任务状态或处理依据" }]}>
                        <Input.TextArea rows={4} maxLength={500} showCount placeholder="例如：供应商后台确认任务未产生费用" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

function CreditAccountSummary({ user }: { user: AdjustmentUser }) {
    if (!hasCreditBalance(user)) {
        return <div className="admin-credit-account-summary is-unavailable">选择远程搜索结果后可核对当前可用与冻结积分。</div>;
    }
    return (
        <dl className="admin-credit-account-summary">
            <div>
                <dt>当前可用</dt>
                <dd>{formatCredits(user.availableMicrocredits)}</dd>
            </div>
            <div>
                <dt>当前冻结</dt>
                <dd>{formatCredits(user.reservedMicrocredits)}</dd>
            </div>
        </dl>
    );
}

function canResolveBillingOrder(order: BillingOrder) {
    return order.status === "uncertain" || order.status === "running" || order.status === "reserved";
}

function getReservedAmount(order: BillingOrder) {
    return order.reservedAmountMicrocredits || order.amountMicrocredits;
}

function hasCreditBalance(user?: AdjustmentUser): user is AdjustmentUser & Pick<AdminUser, "availableMicrocredits" | "reservedMicrocredits"> {
    return Boolean(user && typeof user.availableMicrocredits === "number" && typeof user.reservedMicrocredits === "number");
}

function formatUserLabel(user: AdjustmentUser | undefined, fallback: string) {
    return user ? `${user.displayName || user.username} · @${user.username}` : fallback;
}

function toMicrocredits(value: number) {
    const result = Math.round(Number(value) * 1_000_000);
    if (!Number.isSafeInteger(result)) throw new Error("积分变化超出可处理范围");
    return result;
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
