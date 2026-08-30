import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { KeyRound, PackagePlus, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { formatCredits } from "@/constant/credits";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import {
    closeAdminPaymentOrder,
    createAdminPaymentChannel,
    createAdminRechargeProduct,
    getAdminPaymentChannel,
    getAdminPaymentReconciliation,
    listAdminPaymentChannels,
    listAdminPaymentOrders,
    listAdminPaymentReconciliations,
    listAdminRechargeProducts,
    queryAdminPaymentOrder,
    runAdminPaymentReconciliation,
    rotateAdminPaymentChannelCredentials,
    testAdminPaymentChannel,
    updateAdminPaymentChannel,
    updateAdminRechargeProduct,
    type AdminPaymentOrder,
    type PaymentChannel,
    type PaymentChannelCredentials,
    type PaymentChannelDetail,
    type PaymentOrderStatus,
    type PaymentReconciliationDetail,
    type PaymentReconciliationDifference,
    type PaymentReconciliationRun,
    type RechargeProduct,
} from "@/services/api/payment";

type ChannelFormValue = PaymentChannelCredentials & {
    code: string;
    name: string;
    enabled: boolean;
    isDefault: boolean;
    notifyBaseUrl: string;
    orderExpireMinutes: number;
};

type ProductFormValue = Omit<RechargeProduct, "id" | "createdAt" | "updatedAt" | "amountFen" | "creditsMicrocredits"> & {
    amountYuan: number;
    credits: number;
};

export default function PaymentsPage() {
    return (
        <AdminPageFrame title="支付与充值" description="微信 Native 渠道、充值套餐和支付订单；支付成功后不可退款" scroll>
            <Tabs
                className="pt-2"
                items={[
                    { key: "channels", label: "支付渠道", children: <PaymentChannelsPanel /> },
                    { key: "products", label: "充值套餐", children: <RechargeProductsPanel /> },
                    { key: "orders", label: "支付订单", children: <PaymentOrdersPanel /> },
                    { key: "reconciliation", label: "交易账单对账", children: <PaymentReconciliationPanel /> },
                ]}
            />
        </AdminPageFrame>
    );
}

function PaymentChannelsPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<ChannelFormValue>();
    const [credentialForm] = Form.useForm<PaymentChannelCredentials>();
    const verifyMode = Form.useWatch("verifyMode", form);
    const rotateVerifyMode = Form.useWatch("verifyMode", credentialForm);
    const [channels, setChannels] = useState<PaymentChannel[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState("");
    const [editing, setEditing] = useState<PaymentChannel | null>(null);
    const [detail, setDetail] = useState<PaymentChannelDetail | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [rotateOpen, setRotateOpen] = useState(false);

    const reload = async () => {
        setLoading(true);
        try {
            setChannels((await listAdminPaymentChannels()).channels);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付渠道失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const openCreate = () => {
        setEditing(null);
        setDetail(null);
        form.resetFields();
        form.setFieldsValue({ enabled: false, isDefault: channels.length === 0, orderExpireMinutes: 15, verifyMode: "public_key" } as Partial<ChannelFormValue>);
        setModalOpen(true);
    };

    const openEdit = async (channel: PaymentChannel) => {
        setEditing(channel);
        form.setFieldsValue({
            code: channel.code,
            name: channel.name,
            enabled: channel.enabled,
            isDefault: channel.isDefault,
            notifyBaseUrl: channel.notifyBaseUrl,
            orderExpireMinutes: channel.orderExpireMinutes,
        } as Partial<ChannelFormValue>);
        setModalOpen(true);
        try {
            setDetail(await getAdminPaymentChannel(channel.id));
        } catch {
            setDetail(null);
        }
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateAdminPaymentChannel(editing.id, {
                    name: values.name,
                    enabled: values.enabled,
                    isDefault: values.isDefault,
                    notifyBaseUrl: values.notifyBaseUrl,
                    orderExpireMinutes: values.orderExpireMinutes,
                });
            } else {
                await createAdminPaymentChannel(values);
            }
            message.success(editing ? "支付渠道已更新" : "支付渠道已创建");
            setModalOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存支付渠道失败");
        } finally {
            setSaving(false);
        }
    };

    const openRotate = (channel: PaymentChannel) => {
        setEditing(channel);
        credentialForm.resetFields();
        credentialForm.setFieldsValue({ verifyMode: "public_key" } as Partial<PaymentChannelCredentials>);
        setRotateOpen(true);
    };

    const rotate = async () => {
        if (!editing) return;
        const values = await credentialForm.validateFields();
        setSaving(true);
        try {
            await rotateAdminPaymentChannelCredentials(editing.id, values);
            message.success("新凭据版本已启用，历史订单仍使用原版本");
            setRotateOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "轮换凭据失败");
        } finally {
            setSaving(false);
        }
    };

    const test = async (channel: PaymentChannel) => {
        setTestingId(channel.id);
        try {
            await testAdminPaymentChannel(channel.id);
            message.success("凭据格式和验签客户端初始化成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道测试失败");
        } finally {
            setTestingId("");
        }
    };

    const columns: ColumnsType<PaymentChannel> = [
        {
            title: "渠道",
            render: (_, item) => (
                <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-foreground/45">{item.code} · 微信 Native</div>
                </div>
            ),
        },
        {
            title: "状态",
            width: 120,
            render: (_, item) => (
                <Space size={4}>
                    <Tag color={item.enabled ? "success" : "default"}>{item.enabled ? "已启用" : "已停用"}</Tag>
                    {item.isDefault ? <Tag color="blue">默认</Tag> : null}
                </Space>
            ),
        },
        { title: "订单有效期", dataIndex: "orderExpireMinutes", width: 130, render: (value: number) => `${value} 分钟` },
        { title: "通知域名", dataIndex: "notifyBaseUrl", ellipsis: true },
        {
            title: "操作",
            width: 260,
            render: (_, item) => (
                <Space wrap>
                    <Button size="small" onClick={() => void openEdit(item)}>
                        配置
                    </Button>
                    <Button size="small" icon={<KeyRound className="size-3.5" />} onClick={() => openRotate(item)}>
                        轮换凭据
                    </Button>
                    <Button size="small" loading={testingId === item.id} onClick={() => void test(item)}>
                        测试
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <section className="app-workspace-surface rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold">微信 Native 支付渠道</h2>
                    <p className="mt-1 text-xs text-foreground/50">有效期由管理员设置，范围 5–120 分钟，新订单会保存配置快照。</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新增渠道
                </Button>
            </div>
            <Table rowKey="id" loading={loading} columns={columns} dataSource={channels} pagination={false} scroll={{ x: 900 }} />

            <Modal open={modalOpen} width={760} title={editing ? "编辑支付渠道" : "新增微信支付渠道"} confirmLoading={saving} onOk={() => void save()} onCancel={() => setModalOpen(false)} okText="保存">
                <Form form={form} layout="vertical" className="pt-3">
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="code" label="渠道编码" rules={[{ required: true }]}>
                            <Input disabled={Boolean(editing)} placeholder="wechat-native" />
                        </Form.Item>
                        <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
                            <Input placeholder="微信支付" />
                        </Form.Item>
                        <Form.Item name="notifyBaseUrl" label="服务端公网 HTTPS 地址" rules={[{ required: true, type: "url" }]}>
                            <Input placeholder="https://pay.example.com" />
                        </Form.Item>
                        <Form.Item name="orderExpireMinutes" label="订单有效期（分钟）" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={5} max={120} precision={0} />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="isDefault" label="设为默认渠道" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                    {detail?.callbackUrl ? (
                        <Form.Item label="当前回调地址">
                            <Input value={detail.callbackUrl} readOnly />
                        </Form.Item>
                    ) : null}
                    {!editing ? (
                        <CredentialFields verifyMode={verifyMode} />
                    ) : (
                        <Typography.Paragraph type="secondary" className="!mb-0 text-xs">
                            敏感凭据不会回显；如需修改，请保存后使用“轮换凭据”。
                        </Typography.Paragraph>
                    )}
                </Form>
            </Modal>

            <Modal open={rotateOpen} width={760} title={`轮换凭据${editing ? ` · ${editing.name}` : ""}`} confirmLoading={saving} onOk={() => void rotate()} onCancel={() => setRotateOpen(false)} okText="创建并启用新版本">
                <Typography.Paragraph type="secondary">旧版本会归档但不会删除，已有订单和回调继续使用旧版本完成核对。</Typography.Paragraph>
                <Form form={credentialForm} layout="vertical">
                    <CredentialFields verifyMode={rotateVerifyMode} />
                </Form>
            </Modal>
        </section>
    );
}

function CredentialFields({ verifyMode }: { verifyMode?: PaymentChannelCredentials["verifyMode"] }) {
    return (
        <>
            <div className="grid gap-x-4 sm:grid-cols-2">
                <Form.Item name="appId" label="AppID" rules={[{ required: true }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="merchantId" label="商户号 mchid" rules={[{ required: true }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="merchantCertSerial" label="商户证书序列号" rules={[{ required: true }]}>
                    <Input />
                </Form.Item>
                <Form.Item name="apiV3Key" label="APIv3 密钥" rules={[{ required: true, len: 32 }]}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
            </div>
            <Form.Item name="merchantPrivateKey" label="商户 API 私钥（PKCS#8 PEM）" rules={[{ required: true }]}>
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} />
            </Form.Item>
            <Form.Item name="verifyMode" label="微信支付验签方式" rules={[{ required: true }]}>
                <Select
                    options={[
                        { label: "微信支付公钥（推荐）", value: "public_key" },
                        { label: "平台证书自动下载", value: "platform_certificate" },
                    ]}
                />
            </Form.Item>
            {verifyMode === "public_key" ? (
                <>
                    <Form.Item name="wechatPayPublicKeyId" label="微信支付公钥 ID" rules={[{ required: true }]}>
                        <Input placeholder="PUB_KEY_ID_..." />
                    </Form.Item>
                    <Form.Item name="wechatPayPublicKey" label="微信支付公钥 PEM" rules={[{ required: true }]}>
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} />
                    </Form.Item>
                </>
            ) : null}
        </>
    );
}

function RechargeProductsPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<ProductFormValue>();
    const [products, setProducts] = useState<RechargeProduct[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<RechargeProduct | null>(null);
    const [open, setOpen] = useState(false);

    const reload = async () => {
        setLoading(true);
        try {
            setProducts((await listAdminRechargeProducts()).products);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取充值套餐失败");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void reload();
    }, []);

    const edit = (product?: RechargeProduct) => {
        setEditing(product || null);
        form.resetFields();
        form.setFieldsValue(
            product
                ? {
                      sku: product.sku,
                      name: product.name,
                      description: product.description,
                      amountYuan: product.amountFen / 100,
                      credits: product.creditsMicrocredits / 1_000_000,
                      enabled: Boolean(product.enabled),
                      sortOrder: product.sortOrder,
                  }
                : { enabled: true, sortOrder: products.length * 10, amountYuan: 1, credits: 1 },
        );
        setOpen(true);
    };
    const save = async () => {
        const values = await form.validateFields();
        const payload = {
            sku: values.sku,
            name: values.name,
            description: values.description,
            amountFen: Math.round(values.amountYuan * 100),
            creditsMicrocredits: Math.round(values.credits * 1_000_000),
            enabled: values.enabled,
            sortOrder: values.sortOrder,
        };
        setSaving(true);
        try {
            if (editing) await updateAdminRechargeProduct(editing.id, payload);
            else await createAdminRechargeProduct(payload);
            message.success(editing ? "套餐已更新" : "套餐已创建");
            setOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存套餐失败");
        } finally {
            setSaving(false);
        }
    };
    const columns: ColumnsType<RechargeProduct> = [
        {
            title: "套餐",
            render: (_, item) => (
                <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-foreground/45">{item.sku}</div>
                </div>
            ),
        },
        { title: "售价", dataIndex: "amountFen", width: 120, render: (value: number) => `¥ ${(value / 100).toFixed(2)}` },
        { title: "到账积分", dataIndex: "creditsMicrocredits", width: 150, render: (value: number) => formatCredits(value, 6) },
        { title: "状态", dataIndex: "enabled", width: 100, render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "上架" : "下架"}</Tag> },
        { title: "排序", dataIndex: "sortOrder", width: 80 },
        {
            title: "操作",
            width: 100,
            render: (_, item) => (
                <Button size="small" onClick={() => edit(item)}>
                    编辑
                </Button>
            ),
        },
    ];
    return (
        <section className="app-workspace-surface rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between">
                <div>
                    <h2 className="font-semibold">充值套餐</h2>
                    <p className="mt-1 text-xs text-foreground/50">售价按元填写，到账数量按积分填写；历史订单不随套餐修改。</p>
                </div>
                <Button type="primary" icon={<PackagePlus className="size-4" />} onClick={() => edit()}>
                    新增套餐
                </Button>
            </div>
            <Table rowKey="id" loading={loading} columns={columns} dataSource={products} pagination={false} scroll={{ x: 700 }} />
            <Modal open={open} title={editing ? "编辑充值套餐" : "新增充值套餐"} confirmLoading={saving} onOk={() => void save()} onCancel={() => setOpen(false)}>
                <Form form={form} layout="vertical" className="pt-3">
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
                            <Input disabled={Boolean(editing)} />
                        </Form.Item>
                        <Form.Item name="name" label="套餐名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="amountYuan" label="售价" rules={[{ required: true, message: "请输入售价" }]}>
                            <InputNumber className="w-full" min={0.01} precision={2} step={1} addonAfter="元" placeholder="输入 1 表示 1 元" />
                        </Form.Item>
                        <Form.Item name="credits" label="到账积分" rules={[{ required: true, message: "请输入到账积分" }]}>
                            <InputNumber className="w-full" min={0.000001} precision={6} step={1} addonAfter="积分" placeholder="输入 1 表示 1 积分" />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber className="w-full" precision={0} />
                        </Form.Item>
                        <Form.Item name="enabled" label="上架" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="说明">
                        <Input.TextArea maxLength={500} showCount />
                    </Form.Item>
                </Form>
            </Modal>
        </section>
    );
}

function PaymentOrdersPanel() {
    const { message } = App.useApp();
    const [orders, setOrders] = useState<AdminPaymentOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState("");
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<string>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);

    const reload = async () => {
        setLoading(true);
        try {
            const result = await listAdminPaymentOrders({ keyword: keyword.trim(), status, page, limit: pageSize });
            setOrders(result.orders);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取支付订单失败");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void reload();
    }, [status, page, pageSize]);

    const act = async (order: AdminPaymentOrder, action: "query" | "close") => {
        setActingId(order.id);
        try {
            if (action === "query") await queryAdminPaymentOrder(order.id);
            else await closeAdminPaymentOrder(order.id);
            message.success(action === "query" ? "已查询微信支付最新状态" : "已在查单确认未支付后关单");
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "订单操作失败");
        } finally {
            setActingId("");
        }
    };

    const columns: ColumnsType<AdminPaymentOrder> = [
        {
            title: "商户订单号",
            dataIndex: "outTradeNo",
            width: 220,
            render: (value: string, item) => (
                <div>
                    <Typography.Text copyable={{ text: value }} className="font-mono text-xs">
                        {value}
                    </Typography.Text>
                    <div className="mt-1 text-xs text-foreground/45">{item.productName}</div>
                </div>
            ),
        },
        { title: "用户", width: 150, render: (_, item) => item.userDisplayName || item.username || item.userId },
        {
            title: "金额 / 积分",
            width: 160,
            render: (_, item) => (
                <div>
                    <div>¥ {(item.amountFen / 100).toFixed(2)}</div>
                    <div className="text-xs text-foreground/45">{formatCredits(item.creditsMicrocredits, 6)} 积分</div>
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", width: 110, render: (value: PaymentOrderStatus) => <PaymentStatusTag status={value} /> },
        { title: "微信交易号", dataIndex: "transactionId", width: 190, ellipsis: true, render: (value?: string) => value || "--" },
        { title: "创建时间", dataIndex: "createdAt", width: 175, render: formatTime },
        { title: "过期时间", dataIndex: "expiresAt", width: 175, render: formatTime },
        {
            title: "操作",
            fixed: "right",
            width: 155,
            render: (_, item) => (
                <Space>
                    <Button size="small" loading={actingId === item.id} onClick={() => void act(item, "query")}>
                        查单
                    </Button>
                    {item.status === "pending" || item.status === "closing" ? (
                        <Popconfirm title="确认关闭订单？" description="程序会先向微信查单，只有仍未支付才执行关单。" onConfirm={() => void act(item, "close")}>
                            <Button size="small" danger>
                                关单
                            </Button>
                        </Popconfirm>
                    ) : null}
                </Space>
            ),
        },
    ];
    return (
        <section className="app-workspace-surface rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="font-semibold">支付订单</h2>
                    <p className="mt-1 text-xs text-foreground/50">支持查单和关闭未支付订单，不提供退款操作。</p>
                </div>
                <Space wrap>
                    <Input
                        value={keyword}
                        allowClear
                        prefix={<Search className="size-3.5" />}
                        placeholder="订单号、交易号或用户"
                        onChange={(event) => setKeyword(event.target.value)}
                        onPressEnter={() => {
                            setPage(1);
                            void reload();
                        }}
                    />
                    <Select
                        value={status}
                        className="w-32"
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={[{ label: "全部状态", value: "all" }, ...Object.entries(paymentStatusMeta).map(([value, meta]) => ({ label: meta.label, value }))]}
                    />
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void reload()}>
                        刷新
                    </Button>
                </Space>
            </div>
            <Table
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={orders}
                scroll={{ x: 1250 }}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    onChange: (next, size) => {
                        setPage(size !== pageSize ? 1 : next);
                        setPageSize(size);
                    },
                }}
            />
        </section>
    );
}

function PaymentReconciliationPanel() {
    const { message } = App.useApp();
    const [channels, setChannels] = useState<PaymentChannel[]>([]);
    const [runs, setRuns] = useState<PaymentReconciliationRun[]>([]);
    const [detail, setDetail] = useState<PaymentReconciliationDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [channelId, setChannelId] = useState("");
    const [billDate, setBillDate] = useState(() => yesterdayDate());
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);

    const reload = async () => {
        setLoading(true);
        try {
            const [channelResult, runResult] = await Promise.all([listAdminPaymentChannels(), listAdminPaymentReconciliations(page, pageSize)]);
            setChannels(channelResult.channels);
            setChannelId((current) => current || channelResult.channels[0]?.id || "");
            setRuns(runResult.runs);
            setTotal(runResult.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账记录失败");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void reload();
    }, [page, pageSize]);

    const run = async () => {
        if (!channelId || !billDate) {
            message.error("请选择渠道和账单日期");
            return;
        }
        setRunning(true);
        try {
            const result = await runAdminPaymentReconciliation(channelId, billDate);
            setDetail(result);
            message.success(result.run.differenceCount ? `对账完成，发现 ${result.run.differenceCount} 条差异` : "对账完成，账单一致");
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "执行对账失败");
        } finally {
            setRunning(false);
        }
    };
    const showDetail = async (item: PaymentReconciliationRun) => {
        try {
            setDetail(await getAdminPaymentReconciliation(item.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取对账差异失败");
        }
    };
    const columns: ColumnsType<PaymentReconciliationRun> = [
        { title: "账单日期", dataIndex: "billDate", width: 120 },
        { title: "商户号", dataIndex: "merchantId", width: 140 },
        { title: "状态", dataIndex: "status", width: 105, render: (value: PaymentReconciliationRun["status"]) => <ReconciliationStatusTag status={value} /> },
        { title: "微信 / 本地", width: 120, render: (_, item) => `${item.wechatOrderCount} / ${item.localOrderCount}` },
        { title: "一致", dataIndex: "matchedCount", width: 90 },
        { title: "差异", dataIndex: "differenceCount", width: 90, render: (value: number) => <span className={value ? "font-medium text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}>{value}</span> },
        { title: "完成时间", dataIndex: "completedAt", width: 175, render: formatTime },
        { title: "错误", dataIndex: "lastError", ellipsis: true, render: (value?: string) => value || "--" },
        {
            title: "操作",
            width: 90,
            render: (_, item) => (
                <Button size="small" onClick={() => void showDetail(item)}>
                    差异明细
                </Button>
            ),
        },
    ];
    const differenceColumns: ColumnsType<PaymentReconciliationDifference> = [
        { title: "差异类型", dataIndex: "type", width: 170, render: reconciliationDifferenceLabel },
        { title: "商户订单号", dataIndex: "outTradeNo", width: 210 },
        { title: "微信交易号", dataIndex: "transactionId", width: 190, render: (value?: string) => value || "--" },
        {
            title: "微信 / 本地金额",
            width: 170,
            render: (_, item) =>
                item.type === "external_refund" ? `退款 ¥ ${(item.wechatRefundFen / 100).toFixed(2)} / 原单 ¥ ${(item.localAmountFen / 100).toFixed(2)}` : `¥ ${(item.wechatAmountFen / 100).toFixed(2)} / ¥ ${(item.localAmountFen / 100).toFixed(2)}`,
        },
        { title: "本地状态", dataIndex: "localStatus", width: 110, render: (value?: string) => value || "--" },
        { title: "说明", dataIndex: "description", ellipsis: true },
    ];
    return (
        <section className="app-workspace-surface rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="font-semibold">微信交易账单对账</h2>
                    <p className="mt-1 text-xs text-foreground/50">每天 10:15 后自动下载昨日 ALL 账单，校验 SHA-256 后与本地成功订单逐笔比对；外部退款只报警，不自动扣积分。</p>
                </div>
                <Space wrap>
                    <Select value={channelId || undefined} className="min-w-40" placeholder="支付渠道" options={channels.map((item) => ({ label: item.name, value: item.id }))} onChange={setChannelId} />
                    <Input type="date" value={billDate} max={yesterdayDate()} onChange={(event) => setBillDate(event.target.value)} />
                    <Button type="primary" loading={running} onClick={() => void run()}>
                        立即对账
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void reload()}>
                        刷新
                    </Button>
                </Space>
            </div>
            <Table
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={runs}
                scroll={{ x: 1050 }}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    onChange: (next, size) => {
                        setPage(size !== pageSize ? 1 : next);
                        setPageSize(size);
                    },
                }}
            />
            <Modal open={Boolean(detail)} width={1050} title={detail ? `对账差异 · ${detail.run.billDate}` : "对账差异"} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} onCancel={() => setDetail(null)}>
                {detail ? (
                    <>
                        <div className="mb-4 grid grid-cols-2 gap-3 rounded-md bg-foreground/[.025] p-3 text-xs sm:grid-cols-4">
                            <span>
                                微信订单 <strong>{detail.run.wechatOrderCount}</strong>
                            </span>
                            <span>
                                本地订单 <strong>{detail.run.localOrderCount}</strong>
                            </span>
                            <span>
                                完全一致 <strong>{detail.run.matchedCount}</strong>
                            </span>
                            <span>
                                差异 <strong>{detail.run.differenceCount}</strong>（外部退款 {detail.run.externalRefundCount}）
                            </span>
                        </div>
                        <Table rowKey="id" size="small" columns={differenceColumns} dataSource={detail.differences} pagination={false} scroll={{ x: 1050 }} />
                    </>
                ) : null}
            </Modal>
        </section>
    );
}

const paymentStatusMeta: Record<PaymentOrderStatus, { label: string; color: string }> = {
    created: { label: "创建中", color: "default" },
    pending: { label: "待支付", color: "processing" },
    closing: { label: "关单核对中", color: "warning" },
    succeeded: { label: "已支付到账", color: "success" },
    closed: { label: "已关闭", color: "default" },
    failed: { label: "创建失败", color: "error" },
    exception: { label: "异常待核对", color: "warning" },
};

function PaymentStatusTag({ status }: { status: PaymentOrderStatus }) {
    const meta = paymentStatusMeta[status];
    return <Tag color={meta.color}>{meta.label}</Tag>;
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function yesterdayDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function ReconciliationStatusTag({ status }: { status: PaymentReconciliationRun["status"] }) {
    const values = { pending: { label: "待执行", color: "default" }, running: { label: "执行中", color: "processing" }, completed: { label: "已完成", color: "success" }, failed: { label: "失败", color: "error" } } as const;
    const value = values[status];
    return <Tag color={value.color}>{value.label}</Tag>;
}

function reconciliationDifferenceLabel(value: PaymentReconciliationDifference["type"]) {
    const labels: Record<PaymentReconciliationDifference["type"], string> = {
        wechat_order_missing_local: "微信有、本地无",
        local_status_mismatch: "本地未到账",
        amount_mismatch: "金额不一致",
        transaction_mismatch: "交易号不一致",
        local_order_missing_wechat: "本地有、微信无",
        external_refund: "外部退款异常",
    };
    return labels[value] || value;
}
