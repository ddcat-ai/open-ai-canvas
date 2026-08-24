import { useEffect, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, type FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FlaskConical, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { ModelIcon } from "@/components/model-picker";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker, type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { MODEL_PROTOCOLS, modelProtocolCapability, modelProtocolDefinition, modelProtocolLabel, modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import { createAdminChannelModel, deleteAdminChannelModel, fetchAdminChannelModels, listAdminChannelModels, testAdminChannelModel, updateAdminChannelModel, type ChannelModel, type ChannelModelPriceTier } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { AdminPageFrame } from "./admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatusBadge } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type EditableCapability = ModelCapabilityChoice;

type FormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    capability: EditableCapability;
    protocol: ModelProtocol;
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
    const { t } = useTranslation("canvas");
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
            message.error(error instanceof Error ? error.message : t("admin:failed-to-load-channel-models"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
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
            if (result.models.length === 0) message.warning(t("admin:upstream-returned-no-usable-models"));
            else if (result.added > 0) message.success(t("admin:fetched-param-models-param-new-ones-pending-configuration", { length: result.models.length, added: result.added }));
            else message.info(t("admin:fetched-param-models-nothing-new-to-add", { length: result.models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-fetch-models"));
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
            protocol: "chat-completion",
            priceTiers: [defaultPriceTier()],
            enabled: true,
            capabilityConfig: defaultModelCapabilityConfig("chat-completion", ""),
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
            capabilityConfig:
                item.capability === "text" || item.capability === "image" || item.capability === "video"
                    ? normalizeModelCapabilityConfig(item.capabilityConfig || defaultModelCapabilityConfig(item.protocol, item.providerModelKey || item.modelKey))
                    : undefined,
        });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
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
                    resolution: values.capability === "video" ? tier.resolution || "*" : "*",
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
            message.success(editing ? t("admin:model-configuration-updated") : t("admin:model-added"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-model"));
        } finally {
            setSaving(false);
        }
    };

    const testModel = async () => {
        const values = await form.validateFields(["modelKey", "providerModelKey", "capability", "protocol", ...(modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? ["capabilityConfig"] : [])]);
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
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
            message.error(error instanceof Error ? error.message : t("admin:model-test-failed"));
        } finally {
            setTesting(false);
        }
    };

    const remove = async (item: ChannelModel) => {
        try {
            await deleteAdminChannelModel(channel.id, item.id);
            await reload();
            await onChanged();
            message.success(t("admin:model-deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-delete-model"));
        }
    };

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        if (changed.protocol && (modelCapability === "image" || modelCapability === "video")) {
            form.setFieldValue("capabilityConfig", defaultModelCapabilityConfig(changed.protocol, form.getFieldValue("modelKey")));
        }
        if (!changed.capability) return;
        const current = form.getFieldValue("protocol") as ModelProtocol | undefined;
        if (modelProtocolCapability(current) !== changed.capability) {
            const nextProtocol = MODEL_PROTOCOLS.find((item) => item.capability === changed.capability)?.value;
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
            title: t("admin:models"),
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35">
                        <ModelIcon model={item.modelKey} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium">{item.displayName || item.modelKey}</div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                        {item.providerModelKey && item.providerModelKey !== item.modelKey ? (
                            <div className="admin-monospace truncate text-xs text-foreground/35">
                                {t("admin:upstream")}
                                {item.providerModelKey}
                            </div>
                        ) : null}
                    </div>
                </div>
            ),
        },
        { title: t("admin:capability"), dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: t("admin:request-protocol"),
            dataIndex: "protocol",
            width: 230,
            render: (value: ModelProtocol) =>
                value ? (
                    <div>
                        <div className="text-xs font-medium">{modelProtocolLabel(value)}</div>
                        <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value)?.create}</div>
                    </div>
                ) : (
                    <AdminStatusBadge label={t("admin:pending-config")} tone="warning" />
                ),
        },
        { title: t("admin:spec-pricing"), width: 280, render: (_, item) => (item.priceConfigured ? billingSummary(item) : <AdminStatusBadge label={t("admin:no-pricing-configured")} tone="warning" />) },
        { title: t("admin:version"), dataIndex: "priceVersion", width: 75, render: (value) => `v${value}` },
        { title: t("admin:status"), dataIndex: "enabled", width: 85, render: (enabled) => <AdminStatusBadge label={enabled ? t("admin:enabled-2") : t("admin:disabled-2")} tone={enabled ? "success" : "neutral"} /> },
        {
            title: t("admin:actions"),
            width: 180,
            render: (_, item) => (
                <Space>
                    <Button size="small" onClick={() => startEdit(item)}>
                        {t("admin:edit-2")}
                    </Button>
                    <Popconfirm
                        title={t("admin:delete-model")}
                        description={t("admin:models-used-by-frontend-routes-or-in-flight-tasks-cannot-be-deleted-dele")}
                        okText={t("admin:delete")}
                        cancelText={t("admin:cancel-4")}
                        onConfirm={() => void remove(item)}
                    >
                        <Button size="small" danger title={t("admin:delete-model")} aria-label={t("admin:delete-model")} icon={<Trash2 className="size-3.5" />} />
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
            title={t("admin:param-model-management", { name: channel.name })}
            back={{ label: t("admin:back-to-system-channels"), onClick: onClose }}
            actions={
                <Space wrap>
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        {t("admin:fetch-models")}
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        {t("admin:add-model-4")}
                    </Button>
                </Space>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={t("admin:search-model-identifiers-or-display-names")}
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
                        {capability !== "all" ? (
                            <AdminFilterChip
                                label={t("admin:capability-param", { capability: capability })}
                                onRemove={() => {
                                    setCapability("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {status !== "all" ? (
                            <AdminFilterChip
                                label={`状态：${status === "enabled" ? t("admin:enabled") : t("admin:disabled")}`}
                                onRemove={() => {
                                    setStatus("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                    </>
                }
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
                            options={[
                                { label: t("admin:all-capabilities"), value: "all" },
                                { label: t("admin:text"), value: "text" },
                                { label: t("admin:image"), value: "image" },
                                { label: t("admin:video"), value: "video" },
                                { label: t("admin:audio"), value: "audio" },
                            ]}
                        />
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: t("admin:all-statuses"), value: "all" },
                                { label: t("admin:enabled"), value: "enabled" },
                                { label: t("admin:disabled"), value: "disabled" },
                            ]}
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
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filteredItems.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            <Drawer
                title={editing ? `编辑模型 / ${editing.displayName || editing.modelKey}` : t("admin:add-model-4")}
                open={editorOpen}
                size="min(1080px, 100vw)"
                onClose={() => !saving && setEditorOpen(false)}
                rootClassName="admin-drawer"
                footer={
                    <div className="flex items-center justify-between gap-3">
                        <Button icon={<FlaskConical className="size-4" />} loading={testing} disabled={saving} onClick={() => void testModel()}>
                            {t("admin:test-model")}
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button disabled={saving || testing} onClick={() => setEditorOpen(false)}>
                                {t("admin:cancel-4")}
                            </Button>
                            <Button type="primary" loading={saving} disabled={testing} onClick={() => void save()}>
                                {editing ? t("admin:save-changes") : t("admin:add-model-3")}
                            </Button>
                        </div>
                    </div>
                }
                extra={
                    editing ? (
                        <Button size="small" icon={<Plus className="size-3.5" />} onClick={startCreate}>
                            {t("admin:add-model-4")}
                        </Button>
                    ) : null
                }
            >
                <Form form={form} layout="vertical" requiredMark={false} onValuesChange={handleFormValuesChange}>
                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">{t("admin:model-identity")}</h2>
                        </div>
                        <div className="grid gap-4 md:grid-cols-3">
                            <Form.Item name="modelKey" label={t("admin:product-model-identifier")} rules={[{ required: true, message: t("admin:enter-the-product-model-identifier") }]}>
                                <Input
                                    prefix={
                                        <span className="grid size-6 place-items-center">
                                            <ModelIcon model={modelKey} />
                                        </span>
                                    }
                                    placeholder={t("admin:e-g-seedance-2-5")}
                                />
                            </Form.Item>
                            <Form.Item name="providerModelKey" label={t("admin:upstream-model-id")}>
                                <Input placeholder={t("admin:leave-blank-to-use-the-product-model-identifier")} />
                            </Form.Item>
                            <Form.Item name="displayName" label={t("admin:admin-display-name")}>
                                <Input placeholder={t("admin:defaults-to-the-model-identifier")} />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">{t("admin:capabilities-and-protocol")}</h2>
                        </div>
                        <div className="space-y-4">
                            <Form.Item className="mb-0" name="capability" label={t("admin:model-capabilities")} rules={[{ required: true }]}>
                                <CapabilityCardPicker density="compact" />
                            </Form.Item>
                            <Form.Item className="mb-0" name="protocol" label={t("admin:request-protocol")} rules={[{ required: true, message: t("admin:choose-the-request-protocol") }]}>
                                <ProtocolCardPicker capability={modelCapability} density="compact" />
                            </Form.Item>
                        </div>
                        {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                            <Form.Item name="capabilityConfig" rules={[{ required: true, message: `请配置${capabilityLabel(modelCapability)}能力参数` }]}>
                                <ModelCapabilityEditor capability={modelCapability} model={providerModelKey || modelKey} protocol={form.getFieldValue("protocol")} />
                            </Form.Item>
                        ) : null}
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">{t("admin:spec-pricing-tiers")}</h2>
                        </div>
                        <Form.List
                            name="priceTiers"
                            rules={[
                                {
                                    validator: async (_, value) => {
                                        if (!value?.length) throw new Error(t("admin:configure-at-least-one-price-tier"));
                                    },
                                },
                            ]}
                        >
                            {(fields, { add, remove }, { errors }) => (
                                <div className="space-y-2">
                                    {fields.map((field, index) => (
                                        <PriceTierFields key={field.key} index={field.name} ordinal={index + 1} form={form} capability={modelCapability} protocol={modelProtocol} capabilityConfig={capabilityConfig} onRemove={() => remove(field.name)} />
                                    ))}
                                    <Button icon={<Plus className="size-4" />} onClick={() => add(defaultPriceTier())}>
                                        {t("admin:add-pricing-tier")}
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </div>
                            )}
                        </Form.List>
                    </section>

                    <section className="admin-form-section">
                        <div className="mb-4">
                            <h2 className="text-sm font-semibold">{t("admin:enabled-3")}</h2>
                        </div>
                        <Form.Item name="enabled" label={t("admin:enabled-2")} valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </section>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: t("admin:text"), image: t("admin:image"), video: t("admin:video"), audio: t("admin:audio"), "": t("admin:pending-config") }[value];
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
    const { t } = useTranslation("canvas");
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
                <div className="text-sm font-medium">
                    {t("admin:pricing-tier")} {ordinal}
                </div>
                <Button type="text" danger aria-label={t("admin:delete-pricing-tier-param", { ordinal: ordinal })} title={t("admin:delete-pricing-tier")} icon={<X className="size-4" />} onClick={onRemove} />
            </div>
            <div className="grid gap-3 lg:grid-cols-12">
                <Form.Item className={`mb-0 ${selectorColumnClass}`} name={[index, "operation"]} label={t("admin:generation-method-2")} rules={[{ required: true, message: t("admin:choose-a-generation-method") }]}>
                    <Select options={operationOptions(capability)} />
                </Form.Item>
                {isVideo ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "resolution"]} label={t("admin:resolution")} rules={[{ required: true, message: t("admin:choose-a-resolution") }]}>
                        <Select options={[{ label: t("admin:any-resolution"), value: "*" }, ...resolutionOptions.map((value) => ({ label: value.toUpperCase(), value }))]} />
                    </Form.Item>
                ) : null}
                {isVideo ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "videoSeconds"]} label={t("admin:duration")} rules={[{ required: true, message: t("admin:enter-a-duration") }]}>
                        {durationOptions.length ? (
                            <Select options={[{ label: t("admin:any-duration"), value: 0 }, ...durationOptions.map((value) => ({ label: t("admin:params", { value: value }), value }))]} />
                        ) : (
                            <InputNumber className="w-full" min={0} precision={0} />
                        )}
                    </Form.Item>
                ) : null}
                {isVideo ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "imageCount"]} label={t("admin:reference-image-count")} rules={[{ required: true, message: t("admin:enter-the-reference-image-count") }]}>
                        <InputNumber className="w-full" min={0} max={9} precision={0} placeholder={t("admin:0-means-any-count")} />
                    </Form.Item>
                ) : null}
                {isImage ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "quality"]} label={t("admin:quality-resolution")} rules={[{ required: true, message: t("admin:choose-quality-or-resolution") }]}>
                        <Select
                            options={[
                                { label: t("admin:any-quality"), value: "*" },
                                { label: "1K", value: "1k" },
                                { label: "2K", value: "2k" },
                                { label: "4K", value: "4k" },
                            ]}
                        />
                    </Form.Item>
                ) : null}
                {isImage ? (
                    <Form.Item className="mb-0 lg:col-span-3" name={[index, "size"]} label={t("admin:aspect-size")}>
                        <Input placeholder={t("admin:any-or-1-1-16-9-1024x1024")} />
                    </Form.Item>
                ) : null}
                <Form.Item className={`mb-0 ${selectorColumnClass}`} name={[index, "providerModelKey"]} label={t("admin:upstream-model-id")}>
                    <Input placeholder={t("admin:leave-blank-to-use-the-model-s-default-upstream-id")} />
                </Form.Item>
            </div>
            <div className="grid items-end gap-3 lg:grid-cols-12">
                <Form.Item className="mb-0 lg:col-span-4" name={[index, "billingMode"]} label={t("admin:billing-basis")} rules={[{ required: true }]}>
                    <Segmented
                        className="w-full"
                        options={[
                            { label: t("admin:per-request-2"), value: "fixed_request" },
                            { label: t("admin:per-second"), value: "per_second", disabled: !isVideo },
                            { label: "Token", value: "token", disabled: !tokenEnabled },
                        ]}
                    />
                </Form.Item>
                {billingMode === "token" ? (
                    isVideo ? (
                        <Form.Item className="mb-0 lg:col-span-3" name={[index, "outputTokenPrice"]} label={t("admin:video-per-1m-tokens")} rules={[{ required: true, message: t("admin:enter-the-video-token-price") }]}>
                            <InputNumber className="w-full" min={0.000001} max={1_000_000} precision={6} step={0.1} />
                        </Form.Item>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-3 lg:col-span-5">
                            <Form.Item className="mb-0" name={[index, "inputTokenPrice"]} label={t("admin:input-per-1m-tokens-2")} rules={[{ required: true, message: t("admin:enter-the-input-price") }]}>
                                <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                            <Form.Item className="mb-0" name={[index, "outputTokenPrice"]} label={t("admin:output-per-1m-tokens-2")} rules={[{ required: true, message: t("admin:enter-the-output-price") }]}>
                                <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                            <Form.Item className="mb-0" name={[index, "cachedTokenPrice"]} label={t("admin:cached-per-1m-tokens-2")} rules={[{ required: true, message: t("admin:enter-the-cached-price") }]}>
                                <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                        </div>
                    )
                ) : (
                    <Form.Item
                        className="mb-0 lg:col-span-3"
                        name={[index, "unitPrice"]}
                        label={billingMode === "per_second" ? t("admin:credits-per-second") : t("admin:credits-per-request")}
                        rules={[{ required: true, message: t("admin:enter-the-credit-price") }]}
                    >
                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                    </Form.Item>
                )}
                <div className={`flex items-center gap-6 ${controlsColumnClass}`}>
                    <Form.Item name={[index, "priceConfigured"]} label={t("admin:pricing-configured")} valuePropName="checked" className="mb-0">
                        <Switch />
                    </Form.Item>
                    <Form.Item name={[index, "enabled"]} label={t("admin:enable-this-pricing-tier")} valuePropName="checked" className="mb-0">
                        <Switch />
                    </Form.Item>
                </div>
            </div>
        </div>
    );
}

function defaultPriceTier(): PriceTierFormValues {
    return {
        operation: "*",
        quality: "*",
        size: "*",
        resolution: "*",
        videoSeconds: 0,
        imageCount: 0,
        providerModelKey: "",
        billingMode: "fixed_request",
        unitPrice: 0,
        inputTokenPrice: 0,
        outputTokenPrice: 0,
        cachedTokenPrice: 0,
        priceConfigured: true,
        enabled: true,
    };
}

function priceTierToForm(tier: ChannelModelPriceTier): PriceTierFormValues {
    return {
        operation: tier.selector?.operation || "*",
        quality: tier.selector?.quality || "*",
        size: tier.selector?.size || "*",
        resolution: tier.resolution || "*",
        videoSeconds: tier.videoSeconds || 0,
        imageCount: Number(tier.selector?.imageCount || 0),
        providerModelKey: tier.providerModelKey || "",
        billingMode: tier.billingMode,
        unitPrice: tier.unitPriceMicrocredits / 1_000_000,
        inputTokenPrice: tier.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: tier.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: tier.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: tier.priceConfigured,
        enabled: tier.enabled,
    };
}

function legacyPriceTierToForm(item: ChannelModel): PriceTierFormValues {
    return {
        operation: "*",
        quality: "*",
        size: "*",
        resolution: "*",
        videoSeconds: 0,
        imageCount: 0,
        providerModelKey: item.providerModelKey || "",
        billingMode: item.billingMode,
        unitPrice: item.unitPriceMicrocredits / 1_000_000,
        inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: item.priceConfigured,
        enabled: item.enabled,
    };
}

function billingSummary(item: ChannelModel) {
    const tiers = item.priceTiers?.filter((tier) => tier.enabled && tier.priceConfigured) || [];
    if (!tiers.length) return <AdminStatusBadge label={t("admin:no-pricing-configured")} tone="warning" />;
    return (
        <div className="space-y-1 text-xs leading-5">
            {tiers.slice(0, 3).map((tier) => (
                <div key={tier.id}>{priceTierLabel(tier)}</div>
            ))}
            {tiers.length > 3 ? (
                <div className="text-foreground/45">
                    {t("admin:plus")} {tiers.length - 3} {t("admin:pricing-tiers")}
                </div>
            ) : null}
        </div>
    );
}

function priceTierLabel(tier: ChannelModelPriceTier) {
    const selector = tier.selector || {};
    const specParts = [
        selector.operation && selector.operation !== "*" ? operationLabel(selector.operation) : t("admin:any-generation-method"),
        selector.quality && selector.quality !== "*" ? selector.quality.toUpperCase() : "",
        selector.size && selector.size !== "*" ? selector.size : "",
        tier.resolution === "*" ? "" : tier.resolution.toUpperCase(),
        tier.videoSeconds ? t("admin:params-2", { videoSeconds: tier.videoSeconds }) : "",
        selector.imageCount && selector.imageCount !== "*" ? t("admin:param-reference-images", { imageCount: selector.imageCount }) : "",
    ].filter(Boolean);
    const spec = specParts.length ? specParts.join(" / ") : t("admin:default-spec");
    if (tier.billingMode === "token") return `${spec} · ${formatCredits(tier.outputTokenPriceMicrocredits)} / 百万 Token`;
    return `${spec} · ${formatCredits(tier.unitPriceMicrocredits)} 积分 / ${tier.billingMode === "per_second" ? t("admin:s") : t("admin:requests-2")}`;
}

function operationOptions(capability: EditableCapability | undefined) {
    const options = [{ label: t("admin:any-generation-method"), value: "*" }];
    if (capability === "image") return [...options, { label: t("admin:text-to-image"), value: "text_to_image" }, { label: t("admin:image-to-image"), value: "image_to_image" }];
    if (capability === "video") return [...options, { label: t("admin:text-to-video"), value: "text_to_video" }, { label: t("admin:image-to-video"), value: "image_to_video" }, { label: t("admin:video-to-video"), value: "video_to_video" }];
    if (capability === "text") return [...options, { label: t("admin:text-generation"), value: "text_generation" }];
    return options;
}

function operationLabel(operation: string) {
    return (
        (
            {
                text_to_image: t("admin:text-to-image"),
                image_to_image: t("admin:image-to-image"),
                text_to_video: t("admin:text-to-video"),
                image_to_video: t("admin:image-to-video"),
                video_to_video: t("admin:video-to-video"),
                text_generation: t("admin:text-generation"),
            } as Record<string, string>
        )[operation] || operation
    );
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
