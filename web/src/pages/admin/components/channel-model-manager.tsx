import { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FlaskConical, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { ModelIcon } from "@/components/model-picker";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker, type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { MODEL_PROTOCOLS, modelProtocolCapability, modelProtocolDefinition, modelProtocolLabel, modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import { createAdminPhysicalVariant, listAdminPhysicalVariants, updateAdminPhysicalVariant, type AdminPhysicalVariant } from "@/services/api/logical-models";
import { createAdminChannelModel, deleteAdminChannelModel, fetchAdminChannelModels, listAdminChannelModels, testAdminChannelModel, updateAdminChannelModel, type ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { CapabilitySummary, capabilitySpecFromChannelModel } from "../logical-models/model-routing-capabilities";
import { AdminPageFrame } from "./admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatusBadge } from "./admin-ui";

type EditableCapability = ModelCapabilityChoice;

type FormValues = {
    modelKey: string;
    displayName?: string;
    capability: EditableCapability;
    protocol: ModelProtocol;
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

type ConfigFormValues = {
    name: string;
    enabled: boolean;
};

export function ChannelModelManager({ channel, onClose, onChanged }: { channel: ModelChannel; onClose: () => void; onChanged: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
    const [config, setConfig] = useState<AdminPhysicalVariant | null>(null);
    const [configLoading, setConfigLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [form] = Form.useForm<FormValues>();
    const [configForm] = Form.useForm<ConfigFormValues>();
    const configRequestRef = useRef(0);
    const billingMode = Form.useWatch("billingMode", form) || "fixed_request";
    const modelCapability = Form.useWatch("capability", form);
    const modelProtocol = Form.useWatch("protocol", form);
    const modelKey = Form.useWatch("modelKey", form) || "";
    const editingCapabilitySpec = capabilitySpecFromChannelModel(editing || undefined);
    const currentConfig = editing && config?.channelModelId === editing.id ? config : null;

    const reload = async () => {
        if (!channel) return;
        setLoading(true);
        try {
            setItems((await listAdminChannelModels(channel.id)).models);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取渠道模型失败");
        } finally {
            setLoading(false);
        }
    };

    const reloadConfig = async (channelModelID: string, defaultName = "") => {
        const requestID = ++configRequestRef.current;
        setConfigLoading(true);
        try {
            const variants = (await listAdminPhysicalVariants(channelModelID)).variants;
            if (requestID !== configRequestRef.current) return;
            const nextConfig = variants.find((item) => item.channelModelId === channelModelID) || null;
            setConfig(nextConfig);
            if (nextConfig) {
                configForm.setFieldsValue({ name: nextConfig.name, enabled: nextConfig.enabled });
            } else {
                configForm.setFieldsValue({ name: defaultName, enabled: true });
            }
        } catch (error) {
            if (requestID === configRequestRef.current) message.error(error instanceof Error ? error.message : "读取可用配置失败");
        } finally {
            if (requestID === configRequestRef.current) setConfigLoading(false);
        }
    };

    const saveConfig = async () => {
        if (!editing) {
            message.info("请先保存渠道模型，再配置唯一可用配置");
            return;
        }
        const values = await configForm.validateFields();
        if (values.enabled && editing.capability !== "audio" && !editingCapabilitySpec) {
            message.error("请先完成渠道模型的供应能力配置");
            return;
        }
        if (values.enabled && !editing.enabled) {
            message.error("渠道模型已停用，不能启用可用配置");
            return;
        }
        if (config && !currentConfig) {
            message.error("可用配置与当前渠道模型不匹配，请重新打开后再试");
            return;
        }
        setConfigSaving(true);
        try {
            // 能力范围只维护在渠道模型能力参数中；可用配置只是路由开关和显示名称。
            // 后端会从渠道模型能力生成 variant 快照，避免同一尺寸/比例被填写两次。
            const payload = { channelModelId: editing.id, name: values.name.trim(), enabled: values.enabled };
            if (currentConfig) await updateAdminPhysicalVariant(currentConfig.id, payload);
            else await createAdminPhysicalVariant(payload);
            await reloadConfig(editing.id, editing.displayName || editing.modelKey);
            await onChanged();
            message.success(currentConfig ? "可用配置已更新" : "已创建唯一可用配置");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存可用配置失败");
        } finally {
            setConfigSaving(false);
        }
    };

    useEffect(() => {
        configRequestRef.current += 1;
        void reload();
        setEditing(null);
        setConfig(null);
        setConfigLoading(false);
        setConfigDrawerOpen(false);
        configForm.resetFields();
        setEditorOpen(false);
        setKeyword("");
        setCapability("all");
        setStatus("all");
        setPage(1);
    }, [channel.id]);

    const fetchModels = async () => {
        setFetching(true);
        try {
            // 拉取只导入缺失项；新模型仍需管理员定价并手动启用。
            const result = await fetchAdminChannelModels(channel.id);
            await reload();
            await onChanged();
            if (result.models.length === 0) message.warning("上游没有返回可用模型");
            else if (result.added > 0) message.success(`已拉取 ${result.models.length} 个模型，新增 ${result.added} 个待配置模型`);
            else message.info(`已拉取 ${result.models.length} 个模型，没有需要新增的模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetching(false);
        }
    };

    const startCreate = () => {
        configRequestRef.current += 1;
        setEditing(null);
        setConfig(null);
        setConfigLoading(false);
        setConfigDrawerOpen(false);
        configForm.resetFields();
        form.setFieldsValue({
            modelKey: "",
            displayName: "",
            capability: "text",
            protocol: "chat-completion",
            billingMode: "fixed_request",
            unitPrice: 0,
            inputTokenPrice: 0,
            outputTokenPrice: 0,
            cachedTokenPrice: 0,
            enabled: true,
            capabilityConfig: defaultModelCapabilityConfig("chat-completion", ""),
        });
        setEditorOpen(true);
    };

    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        setConfig(null);
        setConfigDrawerOpen(false);
        configForm.setFieldsValue({ name: item.displayName || item.modelKey, enabled: true });
        void reloadConfig(item.id, item.displayName || item.modelKey);
        form.setFieldsValue({
            modelKey: item.modelKey,
            displayName: item.displayName,
            capability: item.capability || undefined,
            protocol: item.protocol,
            billingMode: item.billingMode,
            unitPrice: item.unitPriceMicrocredits / 1_000_000,
            inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000,
            outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000,
            cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000,
            enabled: item.enabled,
            capabilityConfig: item.capability === "text" || item.capability === "image" || item.capability === "video" ? item.capabilityConfig || defaultModelCapabilityConfig(item.protocol, item.modelKey) : undefined,
        });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const payload = {
                modelKey: values.modelKey.trim(),
                displayName: values.displayName?.trim() || values.modelKey.trim(),
                capability: values.capability,
                protocol: values.protocol,
                billingMode: values.billingMode,
                unitPriceMicrocredits: Math.round(values.unitPrice * 1_000_000),
                inputTokenPriceMicrocredits: Math.round((values.inputTokenPrice || 0) * 1_000_000),
                outputTokenPriceMicrocredits: Math.round((values.outputTokenPrice || 0) * 1_000_000),
                cachedTokenPriceMicrocredits: Math.round((values.cachedTokenPrice || 0) * 1_000_000),
                priceConfigured: true,
                enabled: values.enabled !== false,
                capabilityConfig: values.capability === "text" || values.capability === "image" || values.capability === "video" ? values.capabilityConfig : undefined,
            };
            if (editing) await updateAdminChannelModel(channel.id, editing.id, payload);
            else await createAdminChannelModel(channel.id, payload);
            await reload();
            await onChanged();
            setEditorOpen(false);
            setEditing(null);
            message.success(editing ? "模型配置已更新" : "模型已添加");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        } finally {
            setSaving(false);
        }
    };

    const testModel = async () => {
        const values = await form.validateFields(["modelKey", "capability", "protocol", ...(modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? ["capabilityConfig"] : [])]);
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                capability: values.capability,
                protocol: values.protocol,
                capabilityConfig: values.capabilityConfig,
            });
            message.success(`模型测试通过，耗时 ${(result.durationMs / 1000).toFixed(2)} 秒`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型测试失败");
        } finally {
            setTesting(false);
        }
    };

    const remove = async (item: ChannelModel) => {
        try {
            await deleteAdminChannelModel(channel.id, item.id);
            await reload();
            await onChanged();
            message.success("模型已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除模型失败");
        }
    };

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        if (changed.protocol && (modelCapability === "image" || modelCapability === "video")) {
            form.setFieldValue("capabilityConfig", defaultModelCapabilityConfig(changed.protocol, form.getFieldValue("modelKey")));
        }
        const currentBillingMode = form.getFieldValue("billingMode") as ChannelModel["billingMode"] | undefined;
        const currentCapability = form.getFieldValue("capability") as EditableCapability | undefined;
        const currentProtocol = form.getFieldValue("protocol") as ModelProtocol | undefined;
        if ((currentBillingMode === "per_second" && currentCapability !== "video") || (currentBillingMode === "token" && !modelProtocolSupportsTokenBilling(currentCapability, currentProtocol))) {
            form.setFieldValue("billingMode", "fixed_request");
        }
        if (!changed.capability) return;
        const current = form.getFieldValue("protocol") as ModelProtocol | undefined;
        if (modelProtocolCapability(current) !== changed.capability) {
            const nextProtocol = MODEL_PROTOCOLS.find((item) => item.capability === changed.capability)?.value;
            form.setFieldValue("protocol", nextProtocol);
            form.setFieldValue("capabilityConfig", changed.capability === "text" || changed.capability === "image" || changed.capability === "video" ? defaultModelCapabilityConfig(nextProtocol, form.getFieldValue("modelKey")) : undefined);
        }
    };

    const columns: ColumnsType<ChannelModel> = [
        {
            title: "模型",
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35">
                        <ModelIcon model={item.modelKey} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium">{item.displayName || item.modelKey}</div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                    </div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: "请求协议",
            dataIndex: "protocol",
            width: 230,
            render: (value: ModelProtocol) =>
                value ? (
                    <div>
                        <div className="text-xs font-medium">{modelProtocolLabel(value)}</div>
                        <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value)?.create}</div>
                    </div>
                ) : (
                    <AdminStatusBadge label="待配置" tone="warning" />
                ),
        },
        { title: "计费", width: 220, render: (_, item) => (item.priceConfigured ? billingSummary(item) : <AdminStatusBadge label="未配置价格" tone="warning" />) },
        { title: "版本", dataIndex: "priceVersion", width: 75, render: (value) => `v${value}` },
        { title: "状态", dataIndex: "enabled", width: 85, render: (enabled) => <AdminStatusBadge label={enabled ? "启用" : "停用"} tone={enabled ? "success" : "neutral"} /> },
        {
            title: "操作",
            width: 180,
            render: (_, item) => (
                <Space>
                    <Button size="small" onClick={() => startEdit(item)}>
                        编辑
                    </Button>
                    <Popconfirm title="删除模型" description="删除后模型不再显示，历史账单仍会保留。该操作不能在页面恢复。" okText="删除" cancelText="取消" onConfirm={() => void remove(item)}>
                        <Button size="small" danger title="删除模型" aria-label="删除模型" icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.displayName}`.toLowerCase().includes(query)) return false;
        if (capability !== "all" && item.capability !== capability) return false;
        if (status === "enabled" && !item.enabled) return false;
        if (status === "disabled" && item.enabled) return false;
        return true;
    });
    const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

    return (
        <AdminPageFrame
            title={`${channel.name} / 模型管理`}
            back={{ label: "返回系统渠道", onClick: onClose }}
            actions={
                <Space wrap>
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        拉取模型
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        新增模型
                    </Button>
                </Space>
            }
        >
            <AdminDataTable
                toolbar={<Input
                    allowClear
                    className="app-list-search"
                    prefix={<Search className="size-4 text-foreground/40" />}
                    value={keyword}
                    placeholder="搜索模型标识或显示名称"
                    onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                    }}
                />}
                toolbarActiveFilters={<>{keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => { setKeyword(""); setPage(1); }} /> : null}{capability !== "all" ? <AdminFilterChip label={`能力：${capability}`} onRemove={() => { setCapability("all"); setPage(1); }} /> : null}{status !== "all" ? <AdminFilterChip label={`状态：${status === "enabled" ? "已启用" : "已停用"}`} onRemove={() => { setStatus("all"); setPage(1); }} /> : null}</>}
                toolbarActive={Boolean(keyword || capability !== "all" || status !== "all")}
                toolbarFilters={
                    <>
                        <Select
                            className="w-32"
                            value={capability}
                            onChange={(value) => {
                                setCapability(value);
                                setPage(1);
                            }}
                            options={[{ label: "全部能力", value: "all" }, { label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }]}
                        />
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[{ label: "全部状态", value: "all" }, { label: "已启用", value: "enabled" }, { label: "已停用", value: "disabled" }]}
                        />
                    </>
                }
                onReset={() => {
                    setKeyword("");
                    setCapability("all");
                    setStatus("all");
                    setPage(1);
                }}
                table={{
                    className: "app-data-table",
                    rowKey: "id",
                    size: "small",
                    loading,
                    columns,
                    dataSource: pagedItems,
                    pagination: false,
                    scroll: { x: 990 },
                }}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={filteredItems.length} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />}
            />
            <Drawer
                title={editing ? `编辑模型 / ${editing.displayName || editing.modelKey}` : "新增模型"}
                open={editorOpen}
                size="min(1080px, 100vw)"
                onClose={() => !configSaving && setEditorOpen(false)}
                rootClassName="admin-drawer"
                footer={
                    <div className="flex items-center justify-between gap-3">
                        <Button icon={<FlaskConical className="size-4" />} loading={testing} disabled={saving} onClick={() => void testModel()}>测试模型</Button>
                        <div className="flex items-center gap-2">
                            <Button disabled={saving || testing} onClick={() => setEditorOpen(false)}>取消</Button>
                            <Button type="primary" loading={saving} disabled={testing} onClick={() => void save()}>{editing ? "保存修改" : "添加模型"}</Button>
                        </div>
                    </div>
                }
                extra={
                    editing ? (
                        <Button size="small" icon={<Plus className="size-3.5" />} onClick={startCreate}>
                            新增模型
                        </Button>
                    ) : null
                }
            >
                <Form form={form} layout="vertical" requiredMark={false} onValuesChange={handleFormValuesChange}>
                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">模型身份</h2>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Form.Item name="modelKey" label="模型标识" rules={[{ required: true, message: "请输入模型标识" }]}>
                                <Input
                                    prefix={
                                        <span className="grid size-6 place-items-center">
                                            <ModelIcon model={modelKey} />
                                        </span>
                                    }
                                    placeholder="例如：deepseek-chat、gpt-5、glm-4.5"
                                />
                            </Form.Item>
                            <Form.Item name="displayName" label="后台显示名称">
                                <Input placeholder="不填则使用模型标识" />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">能力与协议</h2>
                        </div>
                        <div className="space-y-4">
                            <Form.Item className="mb-0" name="capability" label="模型能力" rules={[{ required: true }]}>
                                <CapabilityCardPicker density="compact" />
                            </Form.Item>
                            <Form.Item className="mb-0" name="protocol" label="请求协议" rules={[{ required: true, message: "请选择模型请求协议" }]}>
                                <ProtocolCardPicker capability={modelCapability} density="compact" />
                            </Form.Item>
                        </div>
                        {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                            <Form.Item name="capabilityConfig" rules={[{ required: true, message: `请配置${capabilityLabel(modelCapability)}能力参数` }]}>
                                <ModelCapabilityEditor capability={modelCapability} model={modelKey} protocol={form.getFieldValue("protocol")} />
                            </Form.Item>
                        ) : null}
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">可用配置</h2>
                        </div>
                        {!editing ? (
                            <div className="rounded-md bg-muted/20 px-4 py-4 text-sm text-foreground/60">请先保存模型基础信息，保存后即可配置唯一的路由入口。</div>
                        ) : (
                            <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/15 p-4">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{currentConfig?.name || "尚未创建路由配置"}</span>
                                        {currentConfig ? <AdminStatusBadge label={currentConfig.enabled ? "启用" : "停用"} tone={currentConfig.enabled ? "success" : "neutral"} /> : null}
                                    </div>
                                    <div className="mt-1 text-xs text-foreground/45">{currentConfig?.usageCount ? `已被 ${currentConfig.usageCount} 条前台供应配置引用` : "尚未被前台供应配置引用"}</div>
                                </div>
                                <Button
                                    loading={configLoading}
                                    onClick={() => {
                                        setConfigDrawerOpen(true);
                                        void reloadConfig(editing.id, editing.displayName || editing.modelKey);
                                    }}
                                >
                                    编辑配置
                                </Button>
                            </div>
                        )}
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">计费</h2>
                        </div>
                        <Form.Item name="billingMode" label="计费方式" rules={[{ required: true }]}>
                            <Segmented
                                block
                                options={[
                                    { label: "按次计费", value: "fixed_request" },
                                    { label: "按秒计费", value: "per_second", disabled: modelCapability !== "video" },
                                    { label: "Token 计费", value: "token", disabled: !modelProtocolSupportsTokenBilling(modelCapability, modelProtocol) },
                                ]}
                            />
                        </Form.Item>
                        {billingMode === "token" ? (
                            modelCapability === "video" ? (
                                <Form.Item name="outputTokenPrice" label="视频 / 百万 Token" rules={[{ required: true, message: "请输入视频 Token 价格" }]}>
                                    <InputNumber style={{ width: "100%" }} min={0.000001} max={1_000_000} precision={6} step={0.1} />
                                </Form.Item>
                            ) : (
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Form.Item name="inputTokenPrice" label="输入 / 百万 Token" rules={[{ required: true, message: "请输入输入价格" }]}>
                                        <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                    <Form.Item name="outputTokenPrice" label="输出 / 百万 Token" rules={[{ required: true, message: "请输入输出价格" }]}>
                                        <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                    <Form.Item name="cachedTokenPrice" label="缓存 / 百万 Token" rules={[{ required: true, message: "请输入缓存价格" }]}>
                                        <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                </div>
                            )
                        ) : (
                            <Form.Item name="unitPrice" label={billingMode === "per_second" ? "每秒消耗积分" : "每次消耗积分"} rules={[{ required: true, message: "请输入积分价格" }]}>
                                <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                        )}
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">启用状态</h2>
                        </div>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </section>
                </Form>
            </Drawer>
            <Drawer
                title="可用配置"
                open={configDrawerOpen}
                size="min(560px, 100vw)"
                onClose={() => !configSaving && setConfigDrawerOpen(false)}
                rootClassName="admin-secondary-drawer"
                footer={<div className="flex justify-end gap-2"><Button onClick={() => setConfigDrawerOpen(false)}>取消</Button><Button type="primary" loading={configSaving} onClick={() => void saveConfig()}>保存路由配置</Button></div>}
            >
                <Form form={configForm} layout="vertical" requiredMark={false}>
                    <div className="mb-5 rounded-lg bg-muted/15 p-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">唯一可用配置</span>
                                <AdminStatusBadge label={currentConfig ? (currentConfig.enabled ? "启用" : "停用") : "未创建"} tone={currentConfig?.enabled ? "success" : "neutral"} />
                            </div>
                            <span className="text-xs text-foreground/45">{currentConfig?.usageCount ? `引用 ${currentConfig.usageCount}` : "未引用"}</span>
                        </div>
                    </div>
                    <Form.Item name="name" label="配置名称" rules={[{ required: true, message: "请填写配置名称" }]}><Input placeholder="例如：标准能力、高清能力、多参考图" /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                    <div className="rounded-lg bg-muted/10 px-4 py-4">
                        <div className="mb-2 text-xs font-semibold text-foreground/65">继承的模型能力</div>
                        {editingCapabilitySpec ? <CapabilitySummary spec={editingCapabilitySpec} /> : <span className="text-xs text-foreground/45">请先在“能力与协议”中完成模型能力参数。</span>}
                    </div>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value];
}

function billingSummary(item: ChannelModel) {
    if (item.billingMode !== "token") {
        return `${formatCredits(item.unitPriceMicrocredits)} 积分 / ${item.billingMode === "per_second" ? "秒" : "次"}`;
    }
    return (
        <div className="text-xs leading-5">
            {item.capability === "video" ? (
                <div>视频 {formatCredits(item.outputTokenPriceMicrocredits)} / 百万</div>
            ) : (
                <>
                    <div>输入 {formatCredits(item.inputTokenPriceMicrocredits)} / 百万</div>
                    <div>输出 {formatCredits(item.outputTokenPriceMicrocredits)} / 百万</div>
                    <div>缓存 {formatCredits(item.cachedTokenPriceMicrocredits)} / 百万</div>
                </>
            )}
        </div>
    );
}

function formatCredits(value: number) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
