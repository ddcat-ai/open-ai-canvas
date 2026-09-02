import { AlipayCircleFilled, WechatFilled } from "@ant-design/icons";
import { Alert, App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Switch, Tabs } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { Eye, Plus, RefreshCw, Search, Settings2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import {
    closeAdminPaymentOrder,
    createAdminTopupProduct,
    listAdminPaymentOrders,
    listAdminPaymentProviders,
    listAdminPaymentReconciliationItems,
    listAdminPaymentReconciliations,
    listAdminTopupProducts,
    queryAdminPaymentOrder,
    runAdminPaymentReconciliation,
    updateAdminPaymentProvider,
    updateAdminTopupProduct,
    type AdminPaymentProvider,
    type PaymentOrder,
    type PaymentReconciliationItem,
    type PaymentReconciliationRun,
    type TopupProduct,
} from "@/services/api/payments";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, configuredSecretText } from "../components/admin-ui";
import "./payments-page.css";

type ProviderFormValues = {
    enabled: boolean;
    closeAfterMinutes: number;
    values: Record<string, string>;
};

type ProductFormValues = {
    name: string;
    description?: string;
    amountYuan: number;
    credits: number;
    enabled: boolean;
    sortOrder: number;
};

const paymentOrderStatus: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "error" | "info" }> = {
    created: { label: "创建中", tone: "info" },
    pending: { label: "待支付", tone: "warning" },
    closing: { label: "关单中", tone: "warning" },
    closed: { label: "已关闭", tone: "neutral" },
    credited: { label: "已入账", tone: "success" },
    create_failed: { label: "下单失败", tone: "error" },
};

const reconciliationResult: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "error" | "info" }> = {
    matched: { label: "一致", tone: "success" },
    recovered: { label: "已自动补发", tone: "info" },
    local_order_not_found: { label: "本地订单缺失", tone: "error" },
    provider_record_missing: { label: "渠道记录缺失", tone: "error" },
    amount_mismatch: { label: "金额不一致", tone: "error" },
    trade_no_mismatch: { label: "交易号不一致", tone: "error" },
    credit_failed: { label: "补发失败", tone: "error" },
};

export default function AdminPaymentsPage() {
    const { message, modal } = App.useApp();
    const [activeTab, setActiveTab] = useState("providers");
    const [providers, setProviders] = useState<AdminPaymentProvider[]>([]);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [loading, setLoading] = useState(true);

    const [providerDrawer, setProviderDrawer] = useState<AdminPaymentProvider>();
    const [providerSaving, setProviderSaving] = useState(false);
    const [providerForm] = Form.useForm<ProviderFormValues>();

    const [productDrawer, setProductDrawer] = useState<TopupProduct | null | undefined>();
    const [productSaving, setProductSaving] = useState(false);
    const [productForm] = Form.useForm<ProductFormValues>();

    const [orders, setOrders] = useState<PaymentOrder[]>([]);
    const [orderTotal, setOrderTotal] = useState(0);
    const [orderPage, setOrderPage] = useState(1);
    const [orderPageSize, setOrderPageSize] = useState(30);
    const [orderStatusFilter, setOrderStatusFilter] = useState("all");
    const [orderKeyword, setOrderKeyword] = useState("");
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [orderActionId, setOrderActionId] = useState("");

    const [runs, setRuns] = useState<PaymentReconciliationRun[]>([]);
    const [runTotal, setRunTotal] = useState(0);
    const [runPage, setRunPage] = useState(1);
    const [runPageSize, setRunPageSize] = useState(30);
    const [runsLoading, setRunsLoading] = useState(false);
    const [runProviderFilter, setRunProviderFilter] = useState("all");
    const [runningBill, setRunningBill] = useState(false);
    const [billProviderId, setBillProviderId] = useState("");
    const [billDate, setBillDate] = useState<Dayjs>(dayjs().subtract(1, "day"));
    const [detailRun, setDetailRun] = useState<PaymentReconciliationRun>();
    const [detailItems, setDetailItems] = useState<PaymentReconciliationItem[]>([]);
    const [detailTotal, setDetailTotal] = useState(0);
    const [detailPage, setDetailPage] = useState(1);
    const [detailPageSize, setDetailPageSize] = useState(50);
    const [detailResult, setDetailResult] = useState("all");
    const [detailLoading, setDetailLoading] = useState(false);

    const loadBase = async () => {
        setLoading(true);
        try {
            const [providerResult, productResult] = await Promise.all([listAdminPaymentProviders(), listAdminTopupProducts()]);
            setProviders(providerResult.providers);
            setProducts(productResult.products);
            setBillProviderId((current) => current || providerResult.providers.find((item) => item.configured)?.id || providerResult.providers[0]?.id || "");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付配置失败");
        } finally {
            setLoading(false);
        }
    };

    const loadOrders = async (page = orderPage, limit = orderPageSize) => {
        setOrdersLoading(true);
        try {
            const result = await listAdminPaymentOrders({ status: orderStatusFilter === "all" ? undefined : orderStatusFilter, keyword: orderKeyword.trim() || undefined, page, limit });
            setOrders(result.orders);
            setOrderTotal(result.total);
            setOrderPage(result.page);
            setOrderPageSize(result.limit);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付订单失败");
        } finally {
            setOrdersLoading(false);
        }
    };

    const loadRuns = async (page = runPage, limit = runPageSize) => {
        setRunsLoading(true);
        try {
            const result = await listAdminPaymentReconciliations({ providerId: runProviderFilter === "all" ? undefined : runProviderFilter, page, limit });
            setRuns(result.runs);
            setRunTotal(result.total);
            setRunPage(result.page);
            setRunPageSize(result.limit);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账记录失败");
        } finally {
            setRunsLoading(false);
        }
    };

    useEffect(() => {
        void Promise.all([loadBase(), loadOrders(1, orderPageSize), loadRuns(1, runPageSize)]);
    }, []);

    const refresh = async () => {
        if (activeTab === "orders") await loadOrders();
        else if (activeTab === "reconciliation") await loadRuns();
        else await loadBase();
    };

    const openProvider = (provider: AdminPaymentProvider) => {
        providerForm.resetFields();
        const configValues = { ...(provider.values || {}) };
        for (const field of provider.configFields) {
            if (!configValues[field.name] && field.default !== undefined && field.default !== null) configValues[field.name] = String(field.default);
        }
        providerForm.setFieldsValue({ enabled: provider.configEnabled, closeAfterMinutes: provider.closeAfterMinutes || 30, values: configValues });
        setProviderDrawer(provider);
    };

    const saveProvider = async () => {
        if (!providerDrawer) return;
        const values = await providerForm.validateFields();
        setProviderSaving(true);
        try {
            await updateAdminPaymentProvider(providerDrawer.id, {
                enabled: values.enabled,
                closeAfterMinutes: values.closeAfterMinutes,
                values: Object.fromEntries(Object.entries(values.values || {}).map(([key, value]) => [key, String(value || "")])),
            });
            message.success(`${providerDrawer.name}配置已保存为新版本`);
            setProviderDrawer(undefined);
            await loadBase();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存支付渠道失败");
        } finally {
            setProviderSaving(false);
        }
    };

    const openProduct = (product?: TopupProduct) => {
        productForm.resetFields();
        productForm.setFieldsValue(
            product
                ? {
                      name: product.name,
                      description: product.description,
                      amountYuan: product.amountFen / 100,
                      credits: product.creditsMicrocredits / 1_000_000,
                      enabled: product.enabled,
                      sortOrder: product.sortOrder,
                  }
                : { enabled: true, sortOrder: products.length * 10, amountYuan: 10, credits: 10 },
        );
        setProductDrawer(product || null);
    };

    const saveProduct = async () => {
        if (productDrawer === undefined) return;
        const values = await productForm.validateFields();
        const input = {
            name: values.name.trim(),
            description: values.description?.trim(),
            amountFen: Math.round(values.amountYuan * 100),
            creditsMicrocredits: Math.round(values.credits * 1_000_000),
            enabled: values.enabled,
            sortOrder: values.sortOrder || 0,
        };
        setProductSaving(true);
        try {
            if (productDrawer) await updateAdminTopupProduct(productDrawer.id, input);
            else await createAdminTopupProduct(input);
            message.success(productDrawer ? "充值商品已更新" : "充值商品已创建");
            setProductDrawer(undefined);
            await loadBase();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存充值商品失败");
        } finally {
            setProductSaving(false);
        }
    };

    const queryOrder = async (order: PaymentOrder) => {
        setOrderActionId(order.id);
        try {
            await queryAdminPaymentOrder(order.id);
            message.success("已向支付渠道查单");
            await loadOrders();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "查单失败");
        } finally {
            setOrderActionId("");
        }
    };

    const closeOrder = (order: PaymentOrder) => {
        modal.confirm({
            title: "关闭未支付订单？",
            content: "系统会先向支付渠道查单；若渠道已支付则立即入账，否则执行关单。",
            okText: "查单并关单",
            cancelText: "取消",
            onOk: async () => {
                setOrderActionId(order.id);
                try {
                    await closeAdminPaymentOrder(order.id);
                    message.success("订单状态已更新");
                    await loadOrders();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "关单失败");
                    throw error;
                } finally {
                    setOrderActionId("");
                }
            },
        });
    };

    const runReconciliation = async () => {
        if (!billProviderId || !billDate) return;
        setRunningBill(true);
        try {
            const result = await runAdminPaymentReconciliation({ providerId: billProviderId, billDate: billDate.format("YYYY-MM-DD") });
            if (result.run.status === "running") {
                message.info("该渠道与账单日期的对账正在执行，请稍后刷新查看结果");
            } else {
                message.success(result.run.recoveredItems ? `对账完成，自动补发 ${result.run.recoveredItems} 笔` : "对账完成");
            }
            await loadRuns(1, runPageSize);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "执行对账失败");
            await loadRuns(1, runPageSize);
        } finally {
            setRunningBill(false);
        }
    };

    const openRunDetails = async (run: PaymentReconciliationRun, page = 1, limit = detailPageSize, result = detailResult) => {
        setDetailRun(run);
        setDetailLoading(true);
        try {
            const response = await listAdminPaymentReconciliationItems(run.id, { result: result === "all" ? undefined : result, page, limit });
            setDetailRun(response.run);
            setDetailItems(response.items);
            setDetailTotal(response.total);
            setDetailPage(response.page);
            setDetailPageSize(response.limit);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账明细失败");
        } finally {
            setDetailLoading(false);
        }
    };

    const providerNames = useMemo(() => Object.fromEntries(providers.map((item) => [item.id, item.name])), [providers]);

    const providerColumns: ColumnsType<AdminPaymentProvider> = [
        {
            title: "支付渠道",
            key: "provider",
            render: (_, provider) => (
                <div className="flex items-center gap-3">
                    <PaymentBrandIcon providerId={provider.id} />
                    <div>
                        <div className="font-medium">{provider.name}</div>
                        <div className="mt-0.5 font-mono text-xs text-foreground/45">{provider.id}</div>
                    </div>
                </div>
            ),
        },
        { title: "支付方式", dataIndex: "checkoutMode", width: 120, align: "center", render: (value) => (value === "qr_code" ? "扫码支付" : "网站跳转") },
        {
            title: "状态",
            key: "status",
            width: 180,
            align: "center",
            render: (_, provider) => (
                <div className="flex flex-col items-center gap-1.5">
                    <AdminStatusBadge label={provider.enabled ? "可用" : "不可用"} tone={provider.enabled ? "success" : "neutral"} />
                    <span className="text-xs text-foreground/45">
                        插件{provider.pluginEnabled ? "已开放" : "已停用"} · 配置{provider.configEnabled ? "已启用" : "已停用"}
                    </span>
                </div>
            ),
        },
        { title: "未支付自动关闭", dataIndex: "closeAfterMinutes", width: 150, align: "center", render: (value) => `${value || 30} 分钟` },
        { title: "配置版本", dataIndex: "version", width: 105, align: "center", render: (value) => (value ? `v${value}` : "未配置") },
        {
            title: "操作",
            key: "actions",
            width: 100,
            align: "center",
            render: (_, provider) => (
                <Button size="small" icon={<Settings2 className="size-3.5" />} onClick={() => openProvider(provider)}>
                    配置
                </Button>
            ),
        },
    ];

    const productColumns: ColumnsType<TopupProduct> = [
        {
            title: "商品",
            key: "name",
            render: (_, product) => (
                <div>
                    <div className="font-medium">{product.name}</div>
                    <div className="mt-0.5 text-xs text-foreground/45">{product.description || "无说明"}</div>
                </div>
            ),
        },
        { title: "售价", dataIndex: "amountFen", width: 130, align: "right", render: (value) => <span className="font-medium tabular-nums">¥ {(value / 100).toFixed(2)}</span> },
        { title: "到账积分", dataIndex: "creditsMicrocredits", width: 150, align: "right", render: (value) => <span className="tabular-nums">{formatCredits(value)}</span> },
        { title: "排序", dataIndex: "sortOrder", width: 90, align: "center" },
        { title: "状态", dataIndex: "enabled", width: 100, align: "center", render: (value) => <AdminStatusBadge label={value ? "销售中" : "已停用"} tone={value ? "success" : "neutral"} /> },
        {
            title: "操作",
            key: "actions",
            width: 90,
            align: "center",
            render: (_, product) => (
                <Button size="small" onClick={() => openProduct(product)}>
                    编辑
                </Button>
            ),
        },
    ];

    const orderColumns: ColumnsType<PaymentOrder> = [
        {
            title: "订单",
            key: "order",
            width: 280,
            render: (_, order) => (
                <div>
                    <div className="font-mono text-xs">{order.merchantOrderNo}</div>
                    <div className="mt-1 truncate text-xs text-foreground/45">
                        用户 {order.userId || "--"} · {order.productName}
                    </div>
                </div>
            ),
        },
        {
            title: "渠道",
            dataIndex: "providerId",
            width: 160,
            render: (value) => (
                <span className="inline-flex items-center gap-2">
                    <PaymentBrandIcon providerId={value} compact />
                    {providerNames[value] || value}
                </span>
            ),
        },
        {
            title: "金额 / 积分",
            key: "amount",
            width: 150,
            align: "right",
            render: (_, order) => (
                <div>
                    <div className="font-medium tabular-nums">¥ {(order.amountFen / 100).toFixed(2)}</div>
                    <div className="text-xs text-foreground/45">{formatCredits(order.creditsMicrocredits)} 积分</div>
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", width: 110, align: "center", render: (value) => <AdminStatusBadge {...(paymentOrderStatus[value] || { label: value, tone: "neutral" as const })} /> },
        { title: "创建时间", dataIndex: "createdAt", width: 170, render: (value) => formatDateTime(value) },
        {
            title: "操作",
            key: "actions",
            width: 150,
            align: "center",
            render: (_, order) => (
                <div className="flex justify-center gap-1">
                    <Button type="text" size="small" loading={orderActionId === order.id} disabled={order.status === "credited" || order.status === "closed"} onClick={() => void queryOrder(order)}>
                        查单
                    </Button>
                    <Button
                        danger
                        type="text"
                        size="small"
                        icon={<XCircle className="size-3.5" />}
                        loading={orderActionId === order.id}
                        disabled={!["created", "pending", "create_failed", "closing"].includes(order.status)}
                        onClick={() => closeOrder(order)}
                    >
                        关单
                    </Button>
                </div>
            ),
        },
    ];

    const runColumns: ColumnsType<PaymentReconciliationRun> = [
        { title: "账单日期", dataIndex: "billDate", width: 120 },
        {
            title: "渠道",
            dataIndex: "providerId",
            width: 190,
            render: (value) => (
                <span className="inline-flex items-center gap-2">
                    <PaymentBrandIcon providerId={value} compact />
                    {providerNames[value] || value}
                </span>
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 110,
            align: "center",
            render: (value) => <AdminStatusBadge label={value === "completed" ? "已完成" : value === "running" ? "执行中" : "失败"} tone={value === "completed" ? "success" : value === "running" ? "info" : "error"} />,
        },
        { title: "一致", dataIndex: "matchItems", width: 80, align: "right" },
        { title: "自动补发", dataIndex: "recoveredItems", width: 100, align: "right", render: (value) => <span className={value ? "font-medium text-status-success" : ""}>{value}</span> },
        { title: "异常", dataIndex: "errorItems", width: 80, align: "right", render: (value) => <span className={value ? "font-medium text-status-error" : ""}>{value}</span> },
        { title: "完成时间", dataIndex: "completedAt", width: 170, render: (value) => (value ? formatDateTime(value) : "--") },
        {
            title: "明细",
            key: "actions",
            width: 90,
            align: "center",
            render: (_, run) => (
                <Button type="text" size="small" icon={<Eye className="size-3.5" />} onClick={() => void openRunDetails(run)}>
                    查看
                </Button>
            ),
        },
    ];

    const detailColumns: ColumnsType<PaymentReconciliationItem> = [
        { title: "结果", dataIndex: "result", width: 135, render: (value) => <AdminStatusBadge {...(reconciliationResult[value] || { label: value, tone: "neutral" as const })} /> },
        { title: "商户订单号", dataIndex: "merchantOrderNo", width: 255, render: (value) => <span className="font-mono text-xs">{value}</span> },
        { title: "渠道交易号", dataIndex: "providerTradeNo", width: 220, render: (value) => (value ? <span className="font-mono text-xs">{value}</span> : "--") },
        { title: "金额", dataIndex: "amountFen", width: 110, align: "right", render: (value, item) => `${item.currency} ${(value / 100).toFixed(2)}` },
        { title: "说明", dataIndex: "detail", render: (value) => value || "账单与本地订单一致" },
    ];

    return (
        <AdminPageFrame
            title="支付充值"
            description="管理系统支付适配器、充值商品、支付订单与 T+1 对账"
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading || ordersLoading || runsLoading} onClick={() => void refresh()}>
                    刷新
                </Button>
            }
            scroll
        >
            <Alert className="my-4" type="info" showIcon message="平台不提供支付退款" description="管理端仅提供查单、关单和对账。关单前始终先向渠道查单；对账发现已支付未入账订单时会幂等补发积分。" />
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: "providers",
                        label: "支付渠道",
                        children: <AdminDataTable table={{ rowKey: "id", loading, columns: providerColumns, dataSource: providers, pagination: false, scroll: { x: 980 } }} empty={<AdminTableEmpty title="没有发现支付渠道插件" />} />,
                    },
                    {
                        key: "products",
                        label: "充值商品",
                        children: (
                            <AdminDataTable
                                toolbar={<span />}
                                trailing={
                                    <Button type="primary" className="admin-toolbar-primary-action" icon={<Plus className="size-4" />} onClick={() => openProduct()}>
                                        新增商品
                                    </Button>
                                }
                                table={{ rowKey: "id", loading, columns: productColumns, dataSource: products, pagination: false, scroll: { x: 820 } }}
                                empty={<AdminTableEmpty title="还没有充值商品" />}
                            />
                        ),
                    },
                    {
                        key: "orders",
                        label: "支付订单",
                        children: (
                            <AdminDataTable
                                toolbar={
                                    <Input
                                        className="app-list-search"
                                        allowClear
                                        prefix={<Search className="size-4 text-foreground/40" />}
                                        value={orderKeyword}
                                        placeholder="订单号、渠道交易号或用户 ID"
                                        onChange={(event) => setOrderKeyword(event.target.value)}
                                        onPressEnter={() => void loadOrders(1)}
                                    />
                                }
                                toolbarFilters={
                                    <Select
                                        className="w-36"
                                        value={orderStatusFilter}
                                        onChange={setOrderStatusFilter}
                                        options={[{ value: "all", label: "全部状态" }, ...Object.entries(paymentOrderStatus).map(([value, item]) => ({ value, label: item.label }))]}
                                    />
                                }
                                trailing={<Button onClick={() => void loadOrders(1)}>查询</Button>}
                                table={{ rowKey: "id", loading: ordersLoading, columns: orderColumns, dataSource: orders, pagination: false, scroll: { x: 1180 } }}
                                empty={<AdminTableEmpty filtered={Boolean(orderKeyword || orderStatusFilter !== "all")} title="没有支付订单" />}
                                footer={<PaginationBar alwaysShow current={orderPage} pageSize={orderPageSize} total={orderTotal} onChange={(page, size) => void loadOrders(size !== orderPageSize ? 1 : page, size)} />}
                            />
                        ),
                    },
                    {
                        key: "reconciliation",
                        label: "支付对账",
                        children: (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-3">
                                    <Select
                                        className="min-w-52"
                                        value={billProviderId || undefined}
                                        placeholder="选择支付渠道"
                                        onChange={setBillProviderId}
                                        options={providers.map((provider) => ({ value: provider.id, label: provider.name, disabled: !provider.configured }))}
                                    />
                                    <DatePicker value={billDate} allowClear={false} disabledDate={(date) => !date.isBefore(dayjs(), "day") || date.isBefore(dayjs().subtract(3, "month"), "day")} onChange={(date) => date && setBillDate(date)} />
                                    <Button type="primary" loading={runningBill} disabled={!billProviderId} onClick={() => void runReconciliation()}>
                                        执行对账
                                    </Button>
                                    <span className="text-xs text-foreground/45">系统每天 10:15 后自动对账昨日账单；也可在此手动重跑最近三个月账单。</span>
                                </div>
                                <AdminDataTable
                                    toolbar={
                                        <Select
                                            className="w-52"
                                            value={runProviderFilter}
                                            onChange={(value) => {
                                                setRunProviderFilter(value);
                                                setRunPage(1);
                                            }}
                                            options={[{ value: "all", label: "全部支付渠道" }, ...providers.map((provider) => ({ value: provider.id, label: provider.name }))]}
                                        />
                                    }
                                    trailing={<Button onClick={() => void loadRuns(1)}>筛选</Button>}
                                    table={{ rowKey: "id", loading: runsLoading, columns: runColumns, dataSource: runs, pagination: false, scroll: { x: 1000 } }}
                                    empty={<AdminTableEmpty title="还没有对账记录" />}
                                    footer={<PaginationBar alwaysShow current={runPage} pageSize={runPageSize} total={runTotal} onChange={(page, size) => void loadRuns(size !== runPageSize ? 1 : page, size)} />}
                                />
                            </div>
                        ),
                    },
                ]}
            />

            <Drawer
                title={providerDrawer ? `配置 ${providerDrawer.name}` : "配置支付渠道"}
                width={620}
                open={Boolean(providerDrawer)}
                destroyOnHidden
                onClose={() => setProviderDrawer(undefined)}
                extra={
                    <Button type="primary" loading={providerSaving} onClick={() => void saveProvider()}>
                        保存新版本
                    </Button>
                }
            >
                {providerDrawer ? (
                    <Form form={providerForm} layout="vertical" requiredMark="optional">
                        <Alert
                            className="mb-4"
                            type={providerDrawer.pluginEnabled ? "info" : "warning"}
                            showIcon
                            message={providerDrawer.pluginEnabled ? "密钥会加密保存，历史订单固定使用创建时的配置版本。" : "该宿主插件当前已在插件管理中停用；保存配置后仍需开放插件才能接受新订单。"}
                        />
                        <Form.Item name="enabled" label="渠道配置启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="closeAfterMinutes" label="未支付订单自动关闭时间（分钟）" rules={[{ required: true }, { type: "number", min: 5, max: 1440 }]}>
                            <InputNumber min={5} max={1440} precision={0} className="w-full" />
                        </Form.Item>
                        {providerDrawer.configFields.map((field) => {
                            const secretReady = Boolean(providerDrawer.secretConfigured[field.name]);
                            const rules = field.required && !secretReady ? [{ required: true, message: `请输入${field.label || field.name}` }] : undefined;
                            const placeholder = field.secret && secretReady ? configuredSecretText : field.description || undefined;
                            const input =
                                field.type === "textarea" ? (
                                    <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} placeholder={placeholder} autoComplete="off" />
                                ) : field.type === "password" || field.secret ? (
                                    <Input.Password placeholder={placeholder} autoComplete="new-password" />
                                ) : (
                                    <Input placeholder={placeholder} />
                                );
                            return (
                                <Form.Item key={field.name} name={["values", field.name]} label={field.label || field.name} extra={field.description} rules={rules}>
                                    {input}
                                </Form.Item>
                            );
                        })}
                    </Form>
                ) : null}
            </Drawer>

            <Drawer
                title={productDrawer ? "编辑充值商品" : "新增充值商品"}
                width={520}
                open={productDrawer !== undefined}
                destroyOnHidden
                onClose={() => setProductDrawer(undefined)}
                extra={
                    <Button type="primary" loading={productSaving} onClick={() => void saveProduct()}>
                        保存
                    </Button>
                }
            >
                <Form form={productForm} layout="vertical" requiredMark="optional">
                    <Form.Item name="name" label="商品名称" rules={[{ required: true, max: 120 }]}>
                        <Input placeholder="例如：100 积分" />
                    </Form.Item>
                    <Form.Item name="description" label="商品说明" rules={[{ max: 500 }]}>
                        <Input.TextArea rows={3} />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="amountYuan" label="售价（元）" rules={[{ required: true }, { type: "number", min: 0.01, max: 1_000_000 }]}>
                            <InputNumber min={0.01} max={1_000_000} precision={2} className="w-full" />
                        </Form.Item>
                        <Form.Item
                            name="credits"
                            label="到账积分"
                            rules={[
                                { required: true },
                                {
                                    validator: (_, value) => {
                                        const credits = Number(value);
                                        const microcredits = Math.round(credits * 1_000_000);
                                        return Number.isFinite(credits) && credits > 0 && credits <= 1_000_000_000 && Number.isSafeInteger(microcredits) ? Promise.resolve() : Promise.reject(new Error("请输入 0.000001 至 10 亿之间且可安全处理的积分"));
                                    },
                                },
                            ]}
                        >
                            <InputNumber min={0.000001} max={1_000_000_000} precision={6} className="w-full" />
                        </Form.Item>
                    </div>
                    <Form.Item name="sortOrder" label="排序" rules={[{ required: true }]}>
                        <InputNumber precision={0} className="w-full" />
                    </Form.Item>
                    <Form.Item name="enabled" label="上架销售" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Drawer>

            <Drawer
                title={detailRun ? `${providerNames[detailRun.providerId] || detailRun.providerId} · ${detailRun.billDate} 对账明细` : "对账明细"}
                width="min(1080px, 94vw)"
                open={Boolean(detailRun)}
                destroyOnHidden
                onClose={() => {
                    setDetailRun(undefined);
                    setDetailItems([]);
                }}
            >
                {detailRun?.error ? <Alert className="mb-4" type="error" showIcon message="对账执行失败" description={detailRun.error} /> : null}
                <AdminDataTable
                    toolbar={
                        <Select
                            className="w-44"
                            value={detailResult}
                            onChange={(value) => {
                                setDetailResult(value);
                                if (detailRun) void openRunDetails(detailRun, 1, detailPageSize, value);
                            }}
                            options={[{ value: "all", label: "全部结果" }, ...Object.entries(reconciliationResult).map(([value, item]) => ({ value, label: item.label }))]}
                        />
                    }
                    table={{ rowKey: "id", loading: detailLoading, columns: detailColumns, dataSource: detailItems, pagination: false, scroll: { x: 950 } }}
                    empty={<AdminTableEmpty title={detailRun?.status === "failed" ? "本次对账未生成明细" : "账单没有交易记录"} />}
                    footer={<PaginationBar alwaysShow current={detailPage} pageSize={detailPageSize} total={detailTotal} onChange={(page, size) => detailRun && void openRunDetails(detailRun, size !== detailPageSize ? 1 : page, size, detailResult)} />}
                />
            </Drawer>
        </AdminPageFrame>
    );
}

function PaymentBrandIcon({ providerId, compact = false }: { providerId: string; compact?: boolean }) {
    const size = compact ? "size-6" : "size-10";
    if (providerId === "wechat-native")
        return (
            <span className={`grid ${size} shrink-0 place-items-center rounded-lg bg-[#07c160]/10 text-[#07c160]`}>
                <WechatFilled className={compact ? "text-sm" : "text-xl"} aria-hidden />
            </span>
        );
    if (providerId === "alipay-page-pay")
        return (
            <span className={`grid ${size} shrink-0 place-items-center rounded-lg bg-[#1677ff]/10 text-[#1677ff]`}>
                <AlipayCircleFilled className={compact ? "text-sm" : "text-xl"} aria-hidden />
            </span>
        );
    return <span className={`grid ${size} shrink-0 place-items-center rounded-lg bg-muted text-xs`}>PAY</span>;
}

function formatDateTime(value: string) {
    return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
}
