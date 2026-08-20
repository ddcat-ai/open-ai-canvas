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

type AdjustmentFormValues = { userId: string; amount: number; note: string };
type ResolutionFormValues = { note: string };
type PolicyFormValues = { signupBonus: number; checkinBonus: number; defaultMultiplier: number; modelMultipliers: string };
type BillingResolutionAction = "settle" | "refund";
type BillingResolutionTarget =
    | { kind: "single"; order: BillingOrder; action: BillingResolutionAction }
    | { kind: "batch"; orderIds: string[]; amountMicrocredits: number; action: BillingResolutionAction };

export default function CreditOperationsPanel({ users }: { users: AdminReferenceData["users"] }) {
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
            message.error(error instanceof Error ? error.message : "读取待核对计费失败");
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
            .catch((error) => message.error(error instanceof Error ? error.message : "读取积分策略失败"));
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
                message.error(`模型倍率格式无效：${line}`);
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
            message.success("积分策略已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存积分策略失败");
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
            message.error(error instanceof Error ? error.message : "搜索用户失败");
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
            message.success("用户积分已调整");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整积分失败");
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
                    if (result.resolvedCount > 0) message.warning(`已处理 ${result.resolvedCount} 条，${result.failed.length} 条失败${detail}`);
                    else message.error(`所选 ${result.failed.length} 条订单均处理失败${detail}`);
                } else {
                    message.success(resolutionTarget.action === "settle" ? `已确认扣费 ${result.resolvedCount} 条` : `已退回积分 ${result.resolvedCount} 条`);
                }
            }
            const resolvedAction = resolutionTarget.action;
            const wasBatch = resolutionTarget.kind === "batch";
            setResolutionTarget(null);
            resolutionForm.resetFields();
            await reload(page, pageSize);
            if (!wasBatch) message.success(resolvedAction === "settle" ? "计费订单已结算" : "冻结积分已退款");
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
        setResolutionTarget({
            kind: "batch",
            orderIds: selectedOrders.map((order) => order.id),
            amountMicrocredits: selectedOrders.reduce((sum, order) => sum + order.amountMicrocredits, 0),
            action,
        });
        resolutionForm.resetFields();
    };

    const columns: ColumnsType<BillingOrder> = [
        { title: "创建时间", dataIndex: "createdAt", width: 170, render: formatTime },
        { title: "用户", dataIndex: "userId", width: 150, render: (id) => users.find((user) => user.id === id)?.displayName || id },
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
        { title: "预授权积分", dataIndex: "amountMicrocredits", width: 120, align: "right", render: (value) => <span className="font-medium tabular-nums">{formatCredits(value)}</span> },
        {
            title: "实际结算 / 用量",
            width: 190,
            render: (_, order) => order.billingMode === "token" ? (
                <div className="text-xs leading-5">
                    <div className="font-medium tabular-nums">{order.status === "settled" ? `${formatCredits(order.actualAmountMicrocredits)} 积分` : "待 usage 结算"}</div>
                    <div className="text-foreground/50">输入 {order.inputTokens} · 输出 {order.outputTokens} · 缓存 {order.cachedTokens}</div>
                </div>
            ) : <span className="tabular-nums">{order.status === "settled" ? formatCredits(order.actualAmountMicrocredits || order.amountMicrocredits) : "--"}</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 105,
            render: (value) => (
                <AdminStatusBadge
                    label={({ uncertain: "待核对", running: "运行中", reserved: "已冻结", settled: "已结算", refunded: "已退款" } as Record<string, string>)[value] || "未知状态"}
                    tone={value === "settled" ? "success" : value === "refunded" ? "neutral" : "warning"}
                />
            ),
        },
        { title: "上游请求", dataIndex: "providerRequestId", width: 180, ellipsis: true, render: (value) => value || "未获取" },
        { title: "原因", dataIndex: "error", width: 260, ellipsis: true, render: (value) => value || "费用状态不明确" },
        {
            title: "处理",
            width: 180,
            render: (_, order) =>
                !canResolveBillingOrder(order) ? (
                    <span className="text-xs text-foreground/40">处理完成</span>
                ) : (
                    <AdminRowActions
                        primary={{ label: "确认扣费", onClick: () => openSingleResolution(order, "settle") }}
                        actions={[{ key: "refund", label: "退回积分", danger: true, onClick: () => openSingleResolution(order, "refund") }]}
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
                        <h2 className="pt-1 text-sm font-semibold">积分策略</h2>
                    </div>
                    <Form form={policyForm} layout="vertical" requiredMark={false} className="mt-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Form.Item name="signupBonus" label="注册积分" rules={[{ required: true, message: "请填写注册积分" }, { type: "number", min: 0 }]}>
                                <InputNumber className="w-full" min={0} precision={6} />
                            </Form.Item>
                            <Form.Item name="checkinBonus" label="签到积分" rules={[{ required: true, message: "请填写签到积分" }, { type: "number", min: 0 }]}>
                                <InputNumber className="w-full" min={0} precision={6} />
                            </Form.Item>
                            <Form.Item name="defaultMultiplier" label="默认倍率" rules={[{ required: true, message: "请填写默认倍率" }, { type: "number", min: 0.0001, max: 100 }]}>
                                <InputNumber className="w-full" min={0.0001} max={100} precision={4} />
                            </Form.Item>
                        </div>
                        <Form.Item name="modelMultipliers" label="模型独立倍率" extra="每行使用 模型名=倍率">
                            <Input.TextArea rows={2} placeholder={"gpt-image-1=1.5\nseedance-1.0-pro=2"} />
                        </Form.Item>
                        <Button type="primary" loading={savingPolicy} onClick={() => void savePolicy()}>保存积分策略</Button>
                    </Form>
                </section>
                <section className="rounded-lg bg-background p-4">
                    <div className="flex items-start gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                            <UserRoundCog className="size-4" />
                        </span>
                        <h2 className="pt-1 text-sm font-semibold">人工调整积分</h2>
                    </div>
                    <Form form={adjustmentForm} layout="vertical" requiredMark={false} className="mt-3">
                        <Form.Item name="userId" label="目标用户" rules={[{ required: true, message: "请选择用户" }]}>
                            <Select showSearch filterOption={false} loading={searchingUsers} placeholder="搜索用户名或显示名称" onSearch={(value) => void searchUsers(value)} options={adjustmentUsers.map((user) => ({ label: `${user.displayName || user.username} · @${user.username}`, value: user.id }))} />
                        </Form.Item>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item name="amount" label="积分变化" rules={[{ required: true, message: "请填写积分变化" }]}>
                                <InputNumber className="w-full" precision={6} prefix={<Coins className="size-3.5 text-foreground/45" />} placeholder="例如 10 或 -2" />
                            </Form.Item>
                            <Form.Item name="note" label="调整原因" rules={[{ required: true, message: "请填写调整原因" }]}>
                                <Input maxLength={500} placeholder="工单号或处理依据" />
                            </Form.Item>
                        </div>
                        <Button type="primary" loading={adjusting} onClick={() => void adjust()}>确认调整</Button>
                    </Form>
                </section>
            </div>

            <section className="flex min-h-0 flex-1">
                <AdminDataTable
                    toolbar={<Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索用户、模型、场景或请求号"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />}
                    toolbarActiveFilters={<>{keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => { setKeyword(""); setPage(1); }} /> : null}{orderStatus !== "review" ? <AdminFilterChip label={`队列：${orderStatus === "all" ? "全部历史" : orderStatus}`} onRemove={() => { setOrderStatus("review"); setPage(1); }} /> : null}</>}
                    toolbarActive={Boolean(keyword || orderStatus !== "review")}
                    toolbarFilters={<Select className="w-36" value={orderStatus} onChange={(value) => { setOrderStatus(value); setPage(1); }} options={[{ label: "待核对队列", value: "review" }, { label: "全部历史", value: "all" }, { label: "费用待核对", value: "uncertain" }, { label: "运行中", value: "running" }, { label: "已冻结", value: "reserved" }, { label: "已结算", value: "settled" }, { label: "已退款", value: "refunded" }]} />}
                    onReset={() => { setKeyword(""); setOrderStatus("review"); setPage(1); }}
                    trailing={<Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void reload()}>刷新</Button>}
                    batchActions={<AdminBatchBar count={selectedOrderIds.length} onClear={() => setSelectedOrderIds([])}><Button size="small" type="primary" icon={<BadgeCheck className="size-3.5" />} onClick={() => openBatchResolution("settle")}>批量确认扣费</Button><Button size="small" danger icon={<Undo2 className="size-3.5" />} onClick={() => openBatchResolution("refund")}>批量退回积分</Button></AdminBatchBar>}
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: orders, rowSelection: {
                            selectedRowKeys: selectedOrderIds,
                            preserveSelectedRowKeys: false,
                            onChange: (keys) => setSelectedOrderIds(keys.map(String)),
                            getCheckboxProps: (order) => ({ disabled: !canResolveBillingOrder(order), name: `${order.model} ${order.scene || order.capability}` }),
                        }, scroll: { x: 1390 } }}
                    empty={<AdminTableEmpty filtered={Boolean(keyword || orderStatus !== "review")} title="暂无计费订单" />}
                    footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />}
                />
            </section>

            <Modal
                title={resolutionTarget?.action === "settle" ? (resolutionTarget.kind === "batch" ? "批量确认扣除冻结积分" : "确认扣除冻结积分") : (resolutionTarget?.kind === "batch" ? "批量确认退回冻结积分" : "确认退回冻结积分")}
                open={Boolean(resolutionTarget)}
                okText={resolutionTarget?.action === "settle" ? "确认扣费" : "退回积分"}
                cancelText="取消"
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
                        已选择 <span className="font-semibold text-foreground">{resolutionTarget.orderIds.length}</span> 条订单，涉及冻结积分 <span className="font-semibold tabular-nums text-foreground">{formatCredits(resolutionTarget.amountMicrocredits)}</span>。本次核对依据将写入每条订单的审计记录。
                    </div>
                ) : null}
                <Form form={resolutionForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="note" label="核对依据" rules={[{ required: true, whitespace: true, message: "请填写供应商账单、任务状态或处理依据" }]}>
                        <Input.TextArea rows={4} maxLength={500} placeholder="例如：供应商后台确认该请求未产生费用" />
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
