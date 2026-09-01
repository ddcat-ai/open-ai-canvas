import { useCallback, useEffect, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { Archive, CreditCard, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import {
    archiveCreditPackage,
    archivePaymentChannel,
    createCreditPackage,
    createPaymentChannel,
    listAdminRechargeOrders,
    listCreditPackages,
    listPaymentChannels,
    listPaymentReconciliationAnomalies,
    listPaymentProviders,
    listPaymentReconciliationRuns,
    reconcilePaymentChannel,
    resolvePaymentReconciliationAnomaly,
    savePaymentChannelConfig,
    testPaymentChannel,
    updateCreditPackage,
    updatePaymentChannel,
    type CreditPackage,
    type PaymentChannel,
    type PaymentProviderDescriptor,
    type PaymentReconciliationAnomaly,
    type PaymentReconciliationRun,
    type RechargeOrder,
} from "@/services/api/wallet";
import { AdminPageFrame } from "../components/admin-shell";

type PackageFormValue = { name: string; description?: string; amountYuan: number; baseCredits: number; bonusCredits: number; enabled: boolean; sortOrder: number };
type ChannelFormValue = { provider: string; method: string; name: string; description?: string; sortOrder: number };

export default function PaymentSettingsPage() {
    const [activeTab, setActiveTab] = useState("packages");
    return (
        <AdminPageFrame title="积分充值" description="管理套餐、支付渠道、充值订单与交易对账；平台不提供退款操作" scroll>
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "packages", label: "充值套餐", children: <PackagePanel active={activeTab === "packages"} /> },
                    { key: "channels", label: "支付渠道", children: <ChannelPanel active={activeTab === "channels"} /> },
                    { key: "orders", label: "充值订单", children: <OrderPanel active={activeTab === "orders"} /> },
                    { key: "reconciliation", label: "交易对账", children: <ReconciliationPanel active={activeTab === "reconciliation"} /> },
                ]}
            />
        </AdminPageFrame>
    );
}

function PackagePanel({ active }: { active: boolean }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<CreditPackage[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<CreditPackage | null | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<PackageFormValue>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await listCreditPackages()).packages);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取充值套餐失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        if (active) void load();
    }, [active, load]);

    const openEditor = (item: CreditPackage | null) => {
        setEditing(item);
        form.setFieldsValue(
            item
                ? { name: item.name, description: item.description, amountYuan: item.amountFen / 100, baseCredits: item.baseMicrocredits / 1_000_000, bonusCredits: item.bonusMicrocredits / 1_000_000, enabled: item.enabled, sortOrder: item.sortOrder }
                : { name: "", description: "", amountYuan: 10, baseCredits: 10, bonusCredits: 0, enabled: false, sortOrder: 0 },
        );
    };

    const save = async () => {
        const value = await form.validateFields();
        setSaving(true);
        try {
            const payload = {
                name: value.name.trim(),
                description: value.description?.trim(),
                currency: "CNY",
                amountFen: Math.round(value.amountYuan * 100),
                baseMicrocredits: Math.round(value.baseCredits * 1_000_000),
                bonusMicrocredits: Math.round(value.bonusCredits * 1_000_000),
                enabled: value.enabled,
                sortOrder: value.sortOrder,
            };
            if (editing) await updateCreditPackage(editing.id, { ...payload, expectedVersion: editing.version });
            else await createCreditPackage(payload);
            message.success(editing ? "套餐已更新" : "套餐已创建");
            setEditing(undefined);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存充值套餐失败");
        } finally {
            setSaving(false);
        }
    };

    const columns: ColumnsType<CreditPackage> = [
        {
            title: "套餐",
            dataIndex: "name",
            render: (_, item) => (
                <div>
                    <strong>{item.name}</strong>
                    <div className="text-xs text-foreground/45">{item.description || "无说明"}</div>
                </div>
            ),
        },
        { title: "售价", dataIndex: "amountFen", width: 120, render: (value: number) => `¥${(value / 100).toFixed(2)}` },
        {
            title: "到账积分",
            width: 180,
            render: (_, item) => (
                <span>
                    {formatCredits(item.baseMicrocredits + item.bonusMicrocredits)}
                    {item.bonusMicrocredits > 0 ? <small className="ml-2 text-emerald-500">含赠送 {formatCredits(item.bonusMicrocredits)}</small> : null}
                </span>
            ),
        },
        { title: "状态", dataIndex: "enabled", width: 90, render: (enabled: boolean) => <Tag color={enabled ? "success" : "default"}>{enabled ? "已启用" : "已停用"}</Tag> },
        { title: "版本", dataIndex: "version", width: 72, render: (value: number) => `v${value}` },
        {
            title: "操作",
            width: 150,
            render: (_, item) => (
                <Space>
                    <Button size="small" onClick={() => openEditor(item)}>
                        编辑
                    </Button>
                    <Popconfirm
                        title="归档后不再向用户展示，历史订单不受影响。"
                        onConfirm={async () => {
                            await archiveCreditPackage(item.id);
                            message.success("套餐已归档");
                            await load();
                        }}
                    >
                        <Button size="small" danger icon={<Archive className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap justify-between gap-3">
                <p className="text-sm text-foreground/55">订单会保存套餐版本、价格和积分快照，修改套餐不会影响历史订单。</p>
                <Space>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
                        添加套餐
                    </Button>
                </Space>
            </div>
            <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={false} />
            <Modal title={editing ? "编辑充值套餐" : "添加充值套餐"} open={editing !== undefined} confirmLoading={saving} onCancel={() => setEditing(undefined)} onOk={() => void save()} destroyOnHidden>
                <Form form={form} layout="vertical" className="pt-3">
                    <Form.Item name="name" label="套餐名称" rules={[{ required: true }]}>
                        <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item name="description" label="说明">
                        <Input.TextArea maxLength={500} rows={2} />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="amountYuan" label="售价（元）" rules={[{ required: true }]}>
                            <InputNumber min={0.01} precision={2} className="w-full" />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber className="w-full" />
                        </Form.Item>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="baseCredits" label="基础积分" rules={[{ required: true }]}>
                            <InputNumber min={0.000001} precision={6} className="w-full" />
                        </Form.Item>
                        <Form.Item name="bonusCredits" label="赠送积分">
                            <InputNumber min={0} precision={6} className="w-full" />
                        </Form.Item>
                    </div>
                    <Form.Item name="enabled" label="创建后启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </section>
    );
}

function ChannelPanel({ active }: { active: boolean }) {
    const { message } = App.useApp();
    const [providers, setProviders] = useState<PaymentProviderDescriptor[]>([]);
    const [items, setItems] = useState<PaymentChannel[]>([]);
    const [loading, setLoading] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [configuring, setConfiguring] = useState<PaymentChannel | null>(null);
    const [busyId, setBusyId] = useState("");
    const [createForm] = Form.useForm<ChannelFormValue>();
    const [configForm] = Form.useForm<Record<string, string>>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [providerResult, channelResult] = await Promise.all([listPaymentProviders(), listPaymentChannels()]);
            setProviders(providerResult.providers);
            setItems(channelResult.channels);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付渠道失败");
        } finally {
            setLoading(false);
        }
    }, [message]);
    useEffect(() => {
        if (active) void load();
    }, [active, load]);

    const selectedProviderCode = Form.useWatch("provider", createForm);
    const selectedProvider = providers.find((item) => item.code === selectedProviderCode) || providers[0];
    const configProvider = providers.find((item) => item.code === configuring?.provider);

    const create = async () => {
        const value = await createForm.validateFields();
        setBusyId("create");
        try {
            await createPaymentChannel({ ...value, name: value.name.trim(), description: value.description?.trim() });
            message.success("支付渠道已创建，请继续保存凭据并测试");
            setCreateOpen(false);
            createForm.resetFields();
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付渠道失败");
        } finally {
            setBusyId("");
        }
    };

    const saveConfig = async () => {
        if (!configuring || !configProvider) return;
        const value = await configForm.validateFields();
        setBusyId(configuring.id + ":config");
        try {
            await savePaymentChannelConfig(configuring.id, value);
            message.success("新配置版本已保存，渠道已自动停用；测试通过后可重新启用");
            setConfiguring(null);
            configForm.resetFields();
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存支付配置失败");
        } finally {
            setBusyId("");
        }
    };

    const changeEnabled = async (item: PaymentChannel, enabled: boolean) => {
        setBusyId(item.id + ":toggle");
        try {
            await updatePaymentChannel(item.id, { name: item.name, description: item.description, enabled, sortOrder: item.sortOrder });
            message.success(enabled ? "支付渠道已启用" : "支付渠道已停用");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新支付渠道失败");
        } finally {
            setBusyId("");
        }
    };

    const columns: ColumnsType<PaymentChannel> = [
        {
            title: "渠道",
            dataIndex: "name",
            render: (_, item) => (
                <div>
                    <strong>{item.name}</strong>
                    <div className="text-xs text-foreground/45">
                        {item.provider} · {item.method} · 配置 v{item.activeConfigVersion || "-"}
                    </div>
                </div>
            ),
        },
        { title: "配置", width: 110, render: (_, item) => <Tag color={item.configured ? "blue" : "default"}>{item.configured ? "已保存" : "未配置"}</Tag> },
        {
            title: "测试",
            width: 120,
            render: (_, item) => <Tag color={item.lastTestStatus === "passed" ? "success" : item.lastTestStatus === "failed" ? "error" : "default"}>{item.lastTestStatus === "passed" ? "已通过" : item.lastTestStatus === "failed" ? "失败" : "待测试"}</Tag>,
        },
        { title: "启用", width: 90, render: (_, item) => <Switch checked={item.enabled} loading={busyId === item.id + ":toggle"} onChange={(checked) => void changeEnabled(item, checked)} /> },
        {
            title: "操作",
            width: 260,
            render: (_, item) => (
                <Space wrap>
                    <Button
                        size="small"
                        onClick={() => {
                            setConfiguring(item);
                            configForm.resetFields();
                        }}
                    >
                        配置
                    </Button>
                    <Button
                        size="small"
                        icon={<ShieldCheck className="size-3.5" />}
                        loading={busyId === item.id + ":test"}
                        disabled={!item.configured}
                        onClick={async () => {
                            setBusyId(item.id + ":test");
                            try {
                                await testPaymentChannel(item.id);
                                message.success("配置检查通过");
                                await load();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "配置检查失败");
                            } finally {
                                setBusyId("");
                            }
                        }}
                    >
                        测试
                    </Button>
                    <Popconfirm
                        title="归档渠道不会影响历史订单回调和对账。"
                        onConfirm={async () => {
                            await archivePaymentChannel(item.id);
                            message.success("渠道已归档");
                            await load();
                        }}
                    >
                        <Button size="small" danger icon={<Archive className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap justify-between gap-3">
                <p className="text-sm text-foreground/55">密钥按不可变版本加密保存；新订单绑定配置版本，轮换密钥不会破坏旧订单回调。</p>
                <Space>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setCreateOpen(true);
                            const first = providers[0];
                            createForm.setFieldsValue({ provider: first?.code, method: first?.methods[0], sortOrder: 0 });
                        }}
                    >
                        添加渠道
                    </Button>
                </Space>
            </div>
            <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={false} />
            <Modal title="添加支付渠道" open={createOpen} confirmLoading={busyId === "create"} onCancel={() => setCreateOpen(false)} onOk={() => void create()} destroyOnHidden>
                <Form form={createForm} layout="vertical" className="pt-3">
                    <Form.Item name="provider" label="支付服务商" rules={[{ required: true }]}>
                        <Select options={providers.map((item) => ({ label: item.name, value: item.code }))} onChange={(value) => createForm.setFieldValue("method", providers.find((item) => item.code === value)?.methods[0])} />
                    </Form.Item>
                    <Form.Item name="method" label="支付方式" rules={[{ required: true }]}>
                        <Select options={(selectedProvider?.methods || []).map((method) => ({ label: method === "native" ? "Native 扫码支付" : method, value: method }))} />
                    </Form.Item>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
                        <Input placeholder="微信支付" />
                    </Form.Item>
                    <Form.Item name="description" label="说明">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="sortOrder" label="排序">
                        <InputNumber className="w-full" />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal
                title={`配置 ${configuring?.name || "支付渠道"}`}
                open={Boolean(configuring)}
                width={720}
                confirmLoading={busyId === configuring?.id + ":config"}
                okText="保存新版本"
                okButtonProps={{ icon: <Save className="size-4" /> }}
                onCancel={() => setConfiguring(null)}
                onOk={() => void saveConfig()}
                destroyOnHidden
            >
                <p className="mb-4 text-sm text-amber-600">为安全起见，后台不会回显旧密钥。保存时请填写一套完整配置。</p>
                <Form form={configForm} layout="vertical">
                    {(configProvider?.configFields || []).map((field) => (
                        <Form.Item key={field.key} name={field.key} label={field.label} rules={[{ required: field.required }]}>
                            {field.kind === "textarea" ? (
                                <Input.TextArea rows={field.secret ? 6 : 3} placeholder={field.placeholder} autoComplete="off" />
                            ) : (
                                <Input type={field.kind === "password" ? "password" : "text"} placeholder={field.placeholder} autoComplete="off" />
                            )}
                        </Form.Item>
                    ))}
                </Form>
            </Modal>
        </section>
    );
}

function OrderPanel({ active }: { active: boolean }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<RechargeOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>();
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await listAdminRechargeOrders({ status, limit: 100 })).orders);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取充值订单失败");
        } finally {
            setLoading(false);
        }
    }, [message, status]);
    useEffect(() => {
        if (active) void load();
    }, [active, load]);
    const columns: ColumnsType<RechargeOrder> = [
        { title: "订单号", dataIndex: "id", width: 210, ellipsis: true },
        { title: "用户", dataIndex: "userId", width: 180, ellipsis: true },
        {
            title: "套餐/渠道",
            render: (_, item) => (
                <div>
                    {item.packageName}
                    <div className="text-xs text-foreground/45">{item.channelName}</div>
                </div>
            ),
        },
        { title: "金额", dataIndex: "amountFen", width: 100, render: (value: number) => `¥${(value / 100).toFixed(2)}` },
        { title: "积分", dataIndex: "totalMicrocredits", width: 110, render: (value: number) => formatCredits(value) },
        { title: "状态", dataIndex: "status", width: 140, render: (value: RechargeOrder["status"]) => <RechargeStatusTag status={value} /> },
        { title: "创建时间", dataIndex: "createdAt", width: 170, render: formatTime },
    ];
    return (
        <section className="space-y-4">
            <div className="flex justify-between gap-3">
                <Select
                    allowClear
                    placeholder="全部状态"
                    value={status}
                    onChange={setStatus}
                    className="w-48"
                    options={["awaiting_payment", "credited", "closed", "failed", "review_required", "prepay_uncertain"].map((value) => ({ label: rechargeStatusLabel(value), value }))}
                />
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                    刷新
                </Button>
            </div>
            <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ pageSize: 20 }} scroll={{ x: 1050 }} />
        </section>
    );
}

function ReconciliationPanel({ active }: { active: boolean }) {
    const { message, modal } = App.useApp();
    const [channels, setChannels] = useState<PaymentChannel[]>([]);
    const [runs, setRuns] = useState<PaymentReconciliationRun[]>([]);
    const [channelId, setChannelId] = useState<string>();
    const [tradeDate, setTradeDate] = useState(dayjs().subtract(1, "day"));
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [anomalyRunId, setAnomalyRunId] = useState("");
    const [anomalies, setAnomalies] = useState<PaymentReconciliationAnomaly[]>([]);
    const [anomalyLoading, setAnomalyLoading] = useState(false);
    const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
    const [resolvingId, setResolvingId] = useState("");
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [channelResult, runResult] = await Promise.all([listPaymentChannels({ includeArchived: true }), listPaymentReconciliationRuns({ channelId, limit: 50 })]);
            setChannels(channelResult.channels);
            setRuns(runResult.runs);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账记录失败");
        } finally {
            setLoading(false);
        }
    }, [channelId, message]);
    useEffect(() => {
        if (active) void load();
    }, [active, load]);
    const run = async () => {
        if (!channelId) {
            message.warning("请先选择支付渠道");
            return;
        }
        setRunning(true);
        try {
            const result = await reconcilePaymentChannel({ channelId, tradeDate: tradeDate.format("YYYY-MM-DD") });
            message.success(`对账完成，发现 ${result.run.anomalyCount} 项异常`);
            if (result.anomalies.length)
                modal.info({
                    title: "对账异常",
                    width: 760,
                    content: (
                        <div className="max-h-96 space-y-2 overflow-auto pt-3">
                            {result.anomalies.map((item) => (
                                <div key={item.id} className="rounded border border-foreground/10 p-3">
                                    <strong>{item.type}</strong>
                                    <div className="text-xs text-foreground/55">
                                        {item.orderId || item.providerTransactionId || "未知交易"} · {item.detail}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ),
                });
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "执行对账失败");
        } finally {
            setRunning(false);
        }
    };
    const showAnomalies = async (runId: string) => {
        setAnomalyRunId(runId);
        setAnomalyLoading(true);
        try {
            const result = await listPaymentReconciliationAnomalies(runId);
            setAnomalies(result.anomalies);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账异常失败");
        } finally {
            setAnomalyLoading(false);
        }
    };
    const columns: ColumnsType<PaymentReconciliationRun> = [
        { title: "交易日", dataIndex: "tradeDate", width: 120 },
        { title: "渠道", dataIndex: "channelId", width: 200, ellipsis: true },
        { title: "微信账单", render: (_, item) => `${item.providerOrderCount} 笔 / ¥${(item.providerAmountFen / 100).toFixed(2)}` },
        { title: "本地到账", render: (_, item) => `${item.localOrderCount} 笔 / ¥${(item.localAmountFen / 100).toFixed(2)}` },
        { title: "异常", dataIndex: "anomalyCount", width: 90, render: (value: number) => <Tag color={value ? "error" : "success"}>{value}</Tag> },
        { title: "状态", dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "processing"}>{value}</Tag> },
        { title: "执行时间", dataIndex: "createdAt", width: 170, render: formatTime },
        {
            title: "操作",
            width: 110,
            render: (_, item) => (
                <Button size="small" disabled={!item.anomalyCount} onClick={() => void showAnomalies(item.id)}>
                    查看异常
                </Button>
            ),
        },
    ];
    return (
        <section className="space-y-4">
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.025] p-4">
                <div className="mb-3 flex items-center gap-2">
                    <CreditCard className="size-4" />
                    <strong>按交易日核对微信支付账单</strong>
                </div>
                <Space wrap>
                    <Select className="w-64" placeholder="选择支付渠道" value={channelId} onChange={setChannelId} options={channels.map((item) => ({ label: item.name + (item.archivedAt ? "（已归档）" : ""), value: item.id }))} />
                    <DatePicker value={tradeDate} disabledDate={(date) => date.isAfter(dayjs(), "day")} onChange={(date) => date && setTradeDate(date)} />
                    <Button type="primary" loading={running} onClick={() => void run()}>
                        下载账单并对账
                    </Button>
                    <span className="text-xs text-foreground/45">仅核对和补发确认到账的积分，不执行退款。</span>
                </Space>
            </div>
            <Table rowKey="id" loading={loading} dataSource={runs} columns={columns} pagination={false} scroll={{ x: 980 }} />
            <Modal title="对账异常" open={Boolean(anomalyRunId)} width={820} footer={null} onCancel={() => setAnomalyRunId("")} destroyOnHidden>
                <Spin spinning={anomalyLoading}>
                    <div className="max-h-[60vh] space-y-3 overflow-auto pt-3">
                        {anomalies.map((item) => (
                            <div key={item.id} className="rounded border border-foreground/10 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <strong>{item.type}</strong>
                                    <Tag color={item.resolved ? "success" : "error"}>{item.resolved ? "已核查" : "待核查"}</Tag>
                                </div>
                                <div className="mt-1 text-xs text-foreground/55">
                                    {item.orderId || item.providerTransactionId || "未知交易"} · {item.detail}
                                </div>
                                {!item.resolved ? (
                                    <div className="mt-3 flex gap-2">
                                        <Input value={resolveNote[item.id] || ""} maxLength={500} placeholder="填写核查备注（不会触发退款或积分变更）" onChange={(event) => setResolveNote((current) => ({ ...current, [item.id]: event.target.value }))} />
                                        <Button
                                            loading={resolvingId === item.id}
                                            onClick={async () => {
                                                const note = (resolveNote[item.id] || "").trim();
                                                if (!note) {
                                                    message.warning("请填写核查备注");
                                                    return;
                                                }
                                                setResolvingId(item.id);
                                                try {
                                                    await resolvePaymentReconciliationAnomaly(anomalyRunId, item.id, note);
                                                    message.success("已标记为核查完成");
                                                    await showAnomalies(anomalyRunId);
                                                } catch (error) {
                                                    message.error(error instanceof Error ? error.message : "更新核查状态失败");
                                                } finally {
                                                    setResolvingId("");
                                                }
                                            }}
                                        >
                                            标记已核查
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </Spin>
            </Modal>
        </section>
    );
}

function RechargeStatusTag({ status }: { status: RechargeOrder["status"] }) {
    const color = status === "credited" ? "success" : status === "review_required" || status === "failed" || status === "prepay_uncertain" ? "error" : status === "awaiting_payment" || status === "prepay_running" ? "processing" : "default";
    return <Tag color={color}>{rechargeStatusLabel(status)}</Tag>;
}

function rechargeStatusLabel(status: string) {
    return (
        ({ created: "已创建", prepay_running: "下单中", awaiting_payment: "待支付", prepay_uncertain: "下单待确认", paid: "已支付", credited: "已到账", closed: "已关闭", failed: "失败", review_required: "待人工核对" } as Record<string, string>)[status] ||
        status
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}
