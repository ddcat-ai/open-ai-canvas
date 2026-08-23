import { useEffect, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, type FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FlaskConical, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { ModelIcon } from "@/components/model-picker";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker, type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, modelProtocolDefinition, modelProtocolLabel, modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import { fetchProtocolCatalog } from "@/services/api/protocols";
import { createAdminChannelModel, deleteAdminChannelModel, fetchAdminChannelModels, listAdminChannelModels, testAdminChannelModel, updateAdminChannelModel, type ChannelModel, type ChannelModelPriceTier } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { AdminPageFrame } from "./admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatusBadge } from "./admin-ui";

type EditableCapability = ModelCapabilityChoice;

type FormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    capability: EditableCapability;
    protocol?: ModelProtocol;
	priceTiers: PriceTierFormValues[];
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

type PriceTierFormValues = {
	operation: string;
	quality: string;
	size: string;
	resolution: string;
	videoSeconds: number;
	imageCount: number;
    providerModelKey?: string;
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    priceConfigured: boolean;
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
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [availableProtocols, setAvailableProtocols] = useState<import("@/lib/model-protocols").ModelProtocolDefinition[]>([]);
    const [form] = Form.useForm<FormValues>();
    const modelCapability = Form.useWatch("capability", form);
    const modelProtocol = Form.useWatch("protocol", form);
    const modelKey = Form.useWatch("modelKey", form) || "";
    const providerModelKey = Form.useWatch("providerModelKey", form) || "";
	const capabilityConfig = Form.useWatch("capabilityConfig", form);

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

    useEffect(() => {
        void reload();
        void fetchProtocolCatalog("admin.system-channel").then(setAvailableProtocols).catch(() => setAvailableProtocols([]));
        setEditing(null);
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
        setEditing(null);
        form.setFieldsValue({
            modelKey: "",
            providerModelKey: "",
            displayName: "",
            capability: "text",
            protocol: availableProtocols.find((item) => item.capability === "text")?.value,
			priceTiers: [defaultPriceTier()],
            enabled: true,
            capabilityConfig: defaultModelCapabilityConfig(availableProtocols.find((item) => item.capability === "text")?.value, ""),
        });
        setEditorOpen(true);
    };

    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        form.setFieldsValue({
            modelKey: item.modelKey,
            providerModelKey: item.providerModelKey || item.modelKey,
            displayName: item.displayName,
            capability: item.capability || undefined,
            protocol: item.protocol,
			priceTiers: item.priceTiers?.length ? item.priceTiers.map(priceTierToForm) : [legacyPriceTierToForm(item)],
            enabled: item.enabled,
            capabilityConfig: item.capability === "text" || item.capability === "image" || item.capability === "video"
            ? normalizeModelCapabilityConfig(item.capabilityConfig || defaultModelCapabilityConfig(item.protocol, item.providerModelKey || item.modelKey))
                : undefined,
        });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig = values.capability === "text" || values.capability === "image" || values.capability === "video"
            ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel))
            : undefined;
        setSaving(true);
        try {
            const payload = {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                displayName: values.displayName?.trim() || values.modelKey.trim(),
                capability: values.capability,
                protocol: values.protocol,
				priceTiers: values.priceTiers.map((tier) => ({
					selector: skuSelectorFromForm(values.capability, tier),
					resolution: values.capability === "video" ? (tier.resolution || "*") : "*",
					videoSeconds: values.capability === "video" ? Number(tier.videoSeconds || 0) : 0,
					providerModelKey: tier.providerModelKey?.trim() || upstreamModel,
					billingMode: tier.billingMode,
					unitPriceMicrocredits: Math.round((tier.unitPrice || 0) * 1_000_000),
					inputTokenPriceMicrocredits: Math.round((tier.inputTokenPrice || 0) * 1_000_000),
					outputTokenPriceMicrocredits: Math.round((tier.outputTokenPrice || 0) * 1_000_000),
					cachedTokenPriceMicrocredits: Math.round((tier.cachedTokenPrice || 0) * 1_000_000),
					priceConfigured: tier.priceConfigured !== false,
					enabled: tier.enabled !== false,
				})),
                enabled: values.enabled !== false,
                capabilityConfig,
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
        const values = await form.validateFields(["modelKey", "providerModelKey", "capability", "protocol", ...(modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? ["capabilityConfig"] : [])]);
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig = values.capability === "text" || values.capability === "image" || values.capability === "video"
            ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel))
            : undefined;
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                capability: values.capability,
                protocol: values.protocol,
                capabilityConfig,
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
        if (!changed.capability) return;
        const current = form.getFieldValue("protocol") as ModelProtocol | undefined;
        if (modelProtocolCapability(current, availableProtocols) !== changed.capability) {
            const nextProtocol = availableProtocols.find((item) => item.capability === changed.capability)?.value;
            form.setFieldValue("protocol", nextProtocol);
            form.setFieldValue("capabilityConfig", changed.capability === "text" || changed.capability === "image" || changed.capability === "video" ? defaultModelCapabilityConfig(nextProtocol, form.getFieldValue("modelKey")) : undefined);
        }
		const nextTiers = (form.getFieldValue("priceTiers") || []).map((tier: PriceTierFormValues) => ({
			...tier,
			operation: tier.operation || "*",
			quality: changed.capability === "image" ? tier.quality || "*" : "*",
			size: changed.capability === "image" ? tier.size || "*" : "*",
						resolution: changed.capability === "video" ? tier.resolution || "*" : "*",
						videoSeconds: changed.capability === "video" ? tier.videoSeconds || 0 : 0,
						imageCount: changed.capability === "video" ? tier.imageCount || 0 : 0,
			billingMode: tier.billingMode === "per_second" && changed.capability !== "video" ? "fixed_request" : tier.billingMode,
		}));
		form.setFieldValue("priceTiers", nextTiers);
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
                        {item.providerModelKey && item.providerModelKey !== item.modelKey ? <div className="admin-monospace truncate text-xs text-foreground/35">上游：{item.providerModelKey}</div> : null}
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
                        <div className="text-xs font-medium">{modelProtocolLabel(value, availableProtocols)}</div>
                        <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value, availableProtocols)?.create}</div>
                    </div>
                ) : (
                    <AdminStatusBadge label="待配置" tone="warning" />
                ),
        },
		{ title: "规格价格", width: 280, render: (_, item) => (item.priceConfigured ? billingSummary(item) : <AdminStatusBadge label="未配置价格" tone="warning" />) },
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
                    <Popconfirm title="删除模型" description="已被前台供应线路或进行中任务使用的模型不能删除；删除后模型不再显示，且不能在页面恢复。" okText="删除" cancelText="取消" onConfirm={() => void remove(item)}>
                        <Button size="small" danger title="删除模型" aria-label="删除模型" icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.providerModelKey} ${item.displayName}`.toLowerCase().includes(query)) return false;
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
                onClose={() => !saving && setEditorOpen(false)}
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
                        <div className="grid gap-4 md:grid-cols-3">
                            <Form.Item name="modelKey" label="产品模型标识" rules={[{ required: true, message: "请输入产品模型标识" }]}>
                                <Input
                                    prefix={
                                        <span className="grid size-6 place-items-center">
                                            <ModelIcon model={modelKey} />
                                        </span>
                                    }
                                    placeholder="例如：seedance-2-5"
                                />
                            </Form.Item>
                            <Form.Item name="providerModelKey" label="上游模型 ID">
                                <Input placeholder="留空则使用产品模型标识" />
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
                            {availableProtocols.length ? <Form.Item className="mb-0" name="protocol" label="请求协议" rules={[{ required: true, message: "请选择模型请求协议" }]}>
                                <ProtocolCardPicker capability={modelCapability} density="compact" protocols={availableProtocols} />
                            </Form.Item> : null}
                        </div>
                        {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                            <Form.Item name="capabilityConfig" rules={[{ required: true, message: `请配置${capabilityLabel(modelCapability)}能力参数` }]}>
                                <ModelCapabilityEditor capability={modelCapability} model={providerModelKey || modelKey} protocol={form.getFieldValue("protocol")} />
                            </Form.Item>
                        ) : null}
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">规格价格档</h2>
                        </div>
						<Form.List name="priceTiers" rules={[{ validator: async (_, value) => { if (!value?.length) throw new Error("请至少配置一个价格档"); } }]}>
							{(fields, { add, remove }, { errors }) => (
								<div className="space-y-2">
									{fields.map((field, index) => (
										<PriceTierFields
											key={field.key}
											index={field.name}
											ordinal={index + 1}
											form={form}
											capability={modelCapability}
											protocol={modelProtocol}
											capabilityConfig={capabilityConfig}
											onRemove={() => remove(field.name)}
										/>
									))}
									<Button icon={<Plus className="size-4" />} onClick={() => add(defaultPriceTier())}>新增价格档</Button>
									<Form.ErrorList errors={errors} />
								</div>
							)}
						</Form.List>
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
        </AdminPageFrame>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value];
}

function PriceTierFields({
    index,
    ordinal,
    form,
    capability,
    protocol,
    capabilityConfig,
    onRemove,
}: {
    index: number;
    ordinal: number;
    form: FormInstance<FormValues>;
    capability: EditableCapability | undefined;
    protocol: ModelProtocol | undefined;
    capabilityConfig?: ModelCapabilityConfig;
    onRemove: () => void;
}) {
    const billingMode = Form.useWatch(["priceTiers", index, "billingMode"], form) || "fixed_request";
    const video = capabilityConfig?.video;
    const resolutionOptions = video?.resolutions || [];
    const durationOptions = video?.duration.selection === "enum" ? video.duration.values || [] : [];
	const tokenEnabled = Boolean(capability && protocol && modelProtocolSupportsTokenBilling(capability, protocol));
	const isVideo = capability === "video";
	const isImage = capability === "image";
	const selectorColumnClass = isVideo || isImage ? "lg:col-span-3" : "lg:col-span-6";
	const controlsColumnClass = billingMode === "token" && !isVideo ? "lg:col-span-3" : "lg:col-span-5";
    return (
        <div className="rounded-md border border-border bg-muted/10 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">价格档 {ordinal}</div>
                <Button type="text" danger aria-label={`删除价格档 ${ordinal}`} title="删除价格档" icon={<X className="size-4" />} onClick={onRemove} />
            </div>
			<div className="grid gap-3 lg:grid-cols-12">
				<Form.Item className={`mb-0 ${selectorColumnClass}`} name={[index, "operation"]} label="生成方式" rules={[{ required: true, message: "请选择生成方式" }]}>
					<Select options={operationOptions(capability)} />
				</Form.Item>
                {isVideo ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "resolution"]} label="分辨率" rules={[{ required: true, message: "请选择分辨率" }]}>
                        <Select options={[{ label: "任意分辨率", value: "*" }, ...resolutionOptions.map((value) => ({ label: value.toUpperCase(), value }))]} />
                    </Form.Item>
                ) : null}
	                {isVideo ? (
	                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "videoSeconds"]} label="时长" rules={[{ required: true, message: "请输入时长" }]}>
	                        {durationOptions.length ? <Select options={[{ label: "任意时长", value: 0 }, ...durationOptions.map((value) => ({ label: `${value} 秒`, value }))]} /> : <InputNumber className="w-full" min={0} precision={0} />}
	                    </Form.Item>
                ) : null}
				{isVideo ? (
					<Form.Item className="mb-0 lg:col-span-3" name={[index, "imageCount"]} label="参考图数量" rules={[{ required: true, message: "请输入参考图数量" }]}>
						<InputNumber className="w-full" min={0} max={9} precision={0} placeholder="0 表示任意数量" />
					</Form.Item>
				) : null}
				{isImage ? (
					<Form.Item className="mb-0 lg:col-span-3" name={[index, "quality"]} label="质量/分辨率" rules={[{ required: true, message: "请选择质量或分辨率" }]}>
						<Select options={[{ label: "任意质量", value: "*" }, { label: "1K", value: "1k" }, { label: "2K", value: "2k" }, { label: "4K", value: "4k" }]} />
					</Form.Item>
				) : null}
				{isImage ? (
					<Form.Item className="mb-0 lg:col-span-3" name={[index, "size"]} label="画幅/尺寸">
						<Input placeholder="任意，或 1:1、16:9、1024x1024" />
					</Form.Item>
				) : null}
                <Form.Item className={`mb-0 ${selectorColumnClass}`} name={[index, "providerModelKey"]} label="上游模型 ID">
                    <Input placeholder="留空则使用模型默认上游 ID" />
                </Form.Item>
            </div>
            <div className="grid items-end gap-3 lg:grid-cols-12">
                <Form.Item className="mb-0 lg:col-span-4" name={[index, "billingMode"]} label="计费方式" rules={[{ required: true }]}>
                    <Segmented
                        className="w-full"
                        options={[
                            { label: "按次", value: "fixed_request" },
                            { label: "按秒", value: "per_second", disabled: !isVideo },
                            { label: "Token", value: "token", disabled: !tokenEnabled },
                        ]}
                    />
                </Form.Item>
                {billingMode === "token" ? (
                    isVideo ? (
                        <Form.Item className="mb-0 lg:col-span-3" name={[index, "outputTokenPrice"]} label="视频 / 百万 Token" rules={[{ required: true, message: "请输入视频 Token 价格" }]}>
                            <InputNumber className="w-full" min={0.000001} max={1_000_000} precision={6} step={0.1} />
                        </Form.Item>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-3 lg:col-span-5">
                            <Form.Item className="mb-0" name={[index, "inputTokenPrice"]} label="输入 / 百万 Token" rules={[{ required: true, message: "请输入输入价格" }]}><InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} /></Form.Item>
                            <Form.Item className="mb-0" name={[index, "outputTokenPrice"]} label="输出 / 百万 Token" rules={[{ required: true, message: "请输入输出价格" }]}><InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} /></Form.Item>
                            <Form.Item className="mb-0" name={[index, "cachedTokenPrice"]} label="缓存 / 百万 Token" rules={[{ required: true, message: "请输入缓存价格" }]}><InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} /></Form.Item>
                        </div>
                    )
                ) : (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "unitPrice"]} label={billingMode === "per_second" ? "每秒消耗积分" : "每次消耗积分"} rules={[{ required: true, message: "请输入积分价格" }]}>
                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                    </Form.Item>
                )}
                <div className={`flex items-center gap-6 ${controlsColumnClass}`}>
                    <Form.Item name={[index, "priceConfigured"]} label="价格已配置" valuePropName="checked" className="mb-0"><Switch /></Form.Item>
                    <Form.Item name={[index, "enabled"]} label="启用此价格档" valuePropName="checked" className="mb-0"><Switch /></Form.Item>
                </div>
            </div>
        </div>
    );
}

function defaultPriceTier(): PriceTierFormValues {
	return { operation: "*", quality: "*", size: "*", resolution: "*", videoSeconds: 0, imageCount: 0, providerModelKey: "", billingMode: "fixed_request", unitPrice: 0, inputTokenPrice: 0, outputTokenPrice: 0, cachedTokenPrice: 0, priceConfigured: true, enabled: true };
}

function priceTierToForm(tier: ChannelModelPriceTier): PriceTierFormValues {
    return {
		operation: tier.selector?.operation || "*", quality: tier.selector?.quality || "*", size: tier.selector?.size || "*",
		resolution: tier.resolution || "*", videoSeconds: tier.videoSeconds || 0, imageCount: Number(tier.selector?.imageCount || 0), providerModelKey: tier.providerModelKey || "", billingMode: tier.billingMode,
        unitPrice: tier.unitPriceMicrocredits / 1_000_000, inputTokenPrice: tier.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: tier.outputTokenPriceMicrocredits / 1_000_000, cachedTokenPrice: tier.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: tier.priceConfigured, enabled: tier.enabled,
    };
}

function legacyPriceTierToForm(item: ChannelModel): PriceTierFormValues {
    return {
		operation: "*", quality: "*", size: "*", resolution: "*", videoSeconds: 0, imageCount: 0, providerModelKey: item.providerModelKey || "", billingMode: item.billingMode,
        unitPrice: item.unitPriceMicrocredits / 1_000_000, inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000, cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: item.priceConfigured, enabled: item.enabled,
    };
}

function billingSummary(item: ChannelModel) {
	const tiers = item.priceTiers?.filter((tier) => tier.enabled && tier.priceConfigured) || [];
	if (!tiers.length) return <AdminStatusBadge label="未配置价格" tone="warning" />;
	return <div className="space-y-1 text-xs leading-5">{tiers.slice(0, 3).map((tier) => <div key={tier.id}>{priceTierLabel(tier)}</div>)}{tiers.length > 3 ? <div className="text-foreground/45">另有 {tiers.length - 3} 个规格价格档</div> : null}</div>;
}

function priceTierLabel(tier: ChannelModelPriceTier) {
    const selector = tier.selector || {};
    const specParts = [
        selector.operation && selector.operation !== "*" ? operationLabel(selector.operation) : "任意生成方式",
        selector.quality && selector.quality !== "*" ? selector.quality.toUpperCase() : "",
        selector.size && selector.size !== "*" ? selector.size : "",
        tier.resolution === "*" ? "" : tier.resolution.toUpperCase(),
		tier.videoSeconds ? `${tier.videoSeconds} 秒` : "",
		selector.imageCount && selector.imageCount !== "*" ? `${selector.imageCount} 张参考图` : "",
    ].filter(Boolean);
    const spec = specParts.length ? specParts.join(" / ") : "默认规格";
    if (tier.billingMode === "token") return `${spec} · ${formatCredits(tier.outputTokenPriceMicrocredits)} / 百万 Token`;
    return `${spec} · ${formatCredits(tier.unitPriceMicrocredits)} 积分 / ${tier.billingMode === "per_second" ? "秒" : "次"}`;
}

function operationOptions(capability: EditableCapability | undefined) {
	const options = [{ label: "任意生成方式", value: "*" }];
	if (capability === "image") return [...options, { label: "文生图", value: "text_to_image" }, { label: "图生图", value: "image_to_image" }];
	if (capability === "video") return [...options, { label: "文生视频", value: "text_to_video" }, { label: "图生视频", value: "image_to_video" }, { label: "视频生视频", value: "video_to_video" }];
	if (capability === "text") return [...options, { label: "文本生成", value: "text_generation" }];
	return options;
}

function operationLabel(operation: string) {
	return ({ text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", video_to_video: "视频生视频", text_generation: "文本生成" } as Record<string, string>)[operation] || operation;
}

function skuSelectorFromForm(capability: EditableCapability, tier: PriceTierFormValues) {
	const selector: Record<string, string> = {};
	if (tier.operation && tier.operation !== "*") selector.operation = tier.operation;
	if (capability === "video") {
		if (tier.resolution && tier.resolution !== "*") selector.vquality = tier.resolution;
		if (Number(tier.videoSeconds) > 0) selector.videoSeconds = String(Number(tier.videoSeconds));
		if (Number(tier.imageCount) > 0) selector.imageCount = String(Number(tier.imageCount));
	}
	if (capability === "image") {
		if (tier.quality && tier.quality !== "*") selector.quality = tier.quality;
		if (tier.size && tier.size !== "*") selector.size = tier.size;
	}
	return selector;
}

function formatCredits(value: number) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
