import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from "antd";
import type { FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Archive, FlaskConical, GitBranch, Layers3, Pencil, Plus, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { ModelIconPicker, ModelLogo } from "@/components/model-logo";
import { CapabilityCardPicker } from "@/components/model-protocol-picker";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import { listAdminChannels } from "@/services/api/auth";
import { listAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";
import {
    createAdminLogicalModel,
    deleteAdminLogicalModel,
    listAdminLogicalModels,
    simulateAdminLogicalModel,
    updateAdminLogicalModel,
    type AdminLogicalModel,
    type CapabilitySpec,
    type LogicalModelMutation,
    type ModelRequestIntent,
    type RouteSimulationResult,
} from "@/services/api/logical-models";
import {
    CapabilityRequestEditor,
    CapabilityScopeEditor,
    CapabilitySummary,
    DefaultOptionsEditor,
    capabilityLabel,
    capabilitySpecFromChannelModel,
    capabilitySourceError,
    emptyCapabilitySpec,
    mergeCapabilitySpecs,
    normalizeCapabilitySpecForSources,
    operationLabel,
    sanitizeDefaults,
    type CapabilityKind,
} from "./model-routing-capabilities";

type RouteRuleRow = { channelModelId: string; enabled: boolean; priority: number; weight: number };
type LogicalModelFormValues = {
    code: string;
    name: string;
    icon: string;
    description: string;
    capability: CapabilityKind;
    enabled: boolean;
    sortOrder: number;
    pricePolicy: LogicalModelMutation["pricePolicy"];
    billingMode: LogicalModelMutation["billingMode"];
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    capabilitySpec: CapabilitySpec;
    defaultOptions: Record<string, unknown>;
    routes: RouteRuleRow[];
};
export default function LogicalModelsPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
    const [loading, setLoading] = useState(true);
    const [models, setModels] = useState<AdminLogicalModel[]>([]);
    const [channelModels, setChannelModels] = useState<ChannelModel[]>([]);
    const [channelNames, setChannelNames] = useState<Record<string, string>>({});
    const [channelEnabled, setChannelEnabled] = useState<Record<string, boolean>>({});
    const [editingModel, setEditingModel] = useState<AdminLogicalModel | null | undefined>();
    const [saving, setSaving] = useState(false);
    const [deletingModelId, setDeletingModelId] = useState<string>();
    const [simulatingModel, setSimulatingModel] = useState<AdminLogicalModel>();
    const [simulationIntent, setSimulationIntent] = useState<ModelRequestIntent>();
    const [simulationResult, setSimulationResult] = useState<RouteSimulationResult>();
    const [simulating, setSimulating] = useState(false);
    const [modelForm] = Form.useForm<LogicalModelFormValues>();
    const modelCapability = Form.useWatch("capability", modelForm) || "image";
    const modelRoutes = Form.useWatch("routes", modelForm) || [];
    const modelCapabilitySpec = Form.useWatch("capabilitySpec", modelForm);

    const reload = async () => {
        setLoading(true);
        try {
            const [modelResult, firstChannelPage] = await Promise.all([listAdminLogicalModels(), listAdminChannels({ page: 1, limit: 100 })]);
            const remainingChannelPages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(firstChannelPage.total / firstChannelPage.limit) - 1) }, (_, index) => listAdminChannels({ page: index + 2, limit: firstChannelPage.limit })));
            const channels = [firstChannelPage, ...remainingChannelPages].flatMap((result) => result.channels);
            const channelModelResults = await Promise.all(channels.map((channel) => listAdminChannelModels(channel.id)));
            setModels(modelResult.models);
            setChannelModels(channelModelResults.flatMap((result) => result.models));
            setChannelNames(Object.fromEntries(channels.map((channel) => [channel.id, channel.name])));
            setChannelEnabled(Object.fromEntries(channels.map((channel) => [channel.id, channel.enabled !== false])));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-read-frontend-model-config"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const filteredModels = useMemo(() => models.filter((item) => !deferredKeyword || [item.name, item.code, item.capability].some((value) => value.toLowerCase().includes(deferredKeyword))), [models, deferredKeyword]);
    const paginatedModels = useMemo(() => filteredModels.slice((page - 1) * pageSize, page * pageSize), [filteredModels, page, pageSize]);
    const modelChannelModels = useMemo(() => channelModels.filter((item) => item.capability === modelCapability), [channelModels, modelCapability]);
    const modelSourceSpecs = useMemo(
        () =>
            modelRoutes
                .filter((route) => route.enabled && route.weight > 0)
                .map((route) => channelModels.find((item) => item.id === route.channelModelId && item.enabled && channelEnabled[item.channelId] !== false))
                .map((item) => (item ? capabilitySpecFromChannelModel(item) : undefined))
                .filter((item): item is CapabilitySpec => Boolean(item)),
        [channelEnabled, channelModels, modelRoutes],
    );

    const openModel = (item?: AdminLogicalModel) => {
        const capability = item?.capability || "image";
        modelForm.resetFields();
        modelForm.setFieldsValue(
            item
                ? logicalModelToForm(item)
                : {
                      code: "",
                      name: "",
                      icon: "",
                      description: "",
                      capability,
                      enabled: true,
                      sortOrder: models.length,
                      pricePolicy: "channel",
                      billingMode: "fixed_request",
                      unitPriceMicrocredits: 0,
                      inputPriceMicrocredits: 0,
                      outputPriceMicrocredits: 0,
                      cachedPriceMicrocredits: 0,
                      capabilitySpec: emptyCapabilitySpec(capability),
                      defaultOptions: {},
                      routes: [],
                  },
        );
        setEditingModel(item || null);
    };

    const saveModel = async () => {
        const values = await modelForm.validateFields();
        if (values.enabled && !values.routes.length) {
            message.error(t("admin:add-at-least-one-supply-route"));
            return;
        }
        const sourceError = capabilitySourceError(values.capability, modelSourceSpecs, values.capabilitySpec);
        if (values.enabled && sourceError) {
            message.error(sourceError);
            return;
        }
        setSaving(true);
        try {
            const payload = logicalModelPayload(values, modelSourceSpecs);
            await (editingModel ? updateAdminLogicalModel(editingModel.id, payload) : createAdminLogicalModel(payload));
            setEditingModel(undefined);
            await reload();
            message.success(editingModel ? t("admin:frontend-model-updated") : t("admin:frontend-model-created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-frontend-model"));
        } finally {
            setSaving(false);
        }
    };

    const toggleModel = async (item: AdminLogicalModel) => {
        try {
            await updateAdminLogicalModel(item.id, logicalModelPayload({ ...logicalModelToForm(item), enabled: !item.enabled }));
            await reload();
            message.success(item.enabled ? t("admin:frontend-model-disabled") : t("admin:frontend-model-enabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-update-model-status"));
        }
    };

    const removeModel = async (item: AdminLogicalModel) => {
        setDeletingModelId(item.id);
        try {
            await deleteAdminLogicalModel(item.id);
            setModels((current) => current.filter((model) => model.id !== item.id));
            if (paginatedModels.length === 1 && page > 1) setPage(page - 1);
            message.success(t("admin:frontend-model-archived"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-archive-frontend-model"));
            throw error;
        } finally {
            setDeletingModelId(undefined);
        }
    };

    const openSimulation = (item: AdminLogicalModel) => {
        setSimulationIntent({
            capability: item.capability,
            operation: item.capabilitySpec.operations?.[0],
            inputs: Object.fromEntries(Object.entries(item.capabilitySpec.inputs || {}).map(([name, value]) => [name, value.min])),
            options: { ...item.defaultOptions },
        });
        setSimulationResult(undefined);
        setSimulatingModel(item);
    };

    const runSimulation = async () => {
        if (!simulatingModel || !simulationIntent) return;
        setSimulating(true);
        try {
            setSimulationResult(await simulateAdminLogicalModel(simulatingModel.id, simulationIntent));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:routing-simulation-failed"));
        } finally {
            setSimulating(false);
        }
    };

    const modelColumns: ColumnsType<AdminLogicalModel> = [
        {
            title: t("admin:frontend-models"),
            dataIndex: "name",
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2">
                    <ModelLogo icon={item.icon} size={20} />
                    <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="mt-0.5 truncate text-xs text-foreground/45">{item.code}</div>
                    </div>
                </div>
            ),
        },
        { title: t("admin:type"), dataIndex: "capability", width: 90, render: (value: CapabilityKind) => capabilityLabel(value) },
        { title: t("admin:creator-capabilities"), width: 360, render: (_, item) => <CapabilitySummary spec={item.capabilitySpec} /> },
        {
            title: t("admin:supply-routes-3"),
            width: 110,
            render: (_, item) => (
                <div className="text-xs">
                    <div>
                        {(item.routes || []).filter((route) => route.enabled && route.available).length} {t("admin:available-3")}
                    </div>
                    <div className="text-foreground/45">
                        {t("admin:total-2")} {(item.routes || []).length} {t("admin:item-5")}
                    </div>
                </div>
            ),
        },
        { title: t("admin:user-price"), width: 160, render: (_, item) => logicalPriceLabel(item) },
        { title: t("admin:status"), width: 130, render: (_, item) => logicalModelStatusTag(item) },
        {
            title: t("admin:actions"),
            width: 230,
            align: "right",
            render: (_, item) => (
                <AdminRowActions
                    primary={{ label: t("admin:edit-2"), icon: <Pencil className="size-3.5" />, onClick: () => openModel(item) }}
                    visibleActionCount={1}
                    actions={[
                        { key: "simulate", label: t("admin:simulate-route-matching"), icon: <FlaskConical className="size-3.5" />, onClick: () => openSimulation(item) },
                        { key: "toggle", label: item.enabled ? t("admin:disabled-2") : t("admin:enabled-2"), onClick: () => void toggleModel(item) },
                        {
                            key: "archive",
                            label: t("admin:archive-model"),
                            icon: <Archive className="size-3.5" />,
                            danger: true,
                            disabled: deletingModelId === item.id,
                            confirm: {
                                title: t("admin:archive-frontend-model-param", { name: item.name }),
                                description: t("admin:archiving-removes-the-model-from-the-public-catalog-and-it-cannot-be-res"),
                                okText: t("admin:confirm-archive"),
                            },
                            onClick: () => removeModel(item),
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame title={t("admin:frontend-model-catalog")}>
            <AdminDataTable
                toolbar={
                    <Input
                        prefix={<Search className="size-4 text-foreground/40" />}
                        allowClear
                        value={keyword}
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                        placeholder={t("admin:search-by-model-name-code-or-capability")}
                        className="app-list-search"
                    />
                }
                toolbarActiveFilters={
                    keyword ? (
                        <AdminFilterChip
                            label={t("admin:search-param", { keyword: keyword })}
                            onRemove={() => {
                                setKeyword("");
                                setPage(1);
                            }}
                        />
                    ) : null
                }
                toolbarActive={Boolean(keyword)}
                onReset={() => {
                    setKeyword("");
                    setPage(1);
                }}
                table={{ className: "admin-logical-model-table", rowKey: "id", size: "small", loading, pagination: false, columns: modelColumns, dataSource: paginatedModels, scroll: { x: 980 } }}
                empty={<AdminTableEmpty filtered={Boolean(deferredKeyword)} title={t("admin:no-models-yet")} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filteredModels.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />

            <Drawer
                title={editingModel ? t("admin:edit-frontend-model") : t("admin:new-frontend-model")}
                open={editingModel !== undefined}
                size="min(1120px, 100vw)"
                destroyOnHidden
                maskClosable={!saving}
                onClose={() => !saving && setEditingModel(undefined)}
                rootClassName="admin-drawer"
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving} onClick={() => setEditingModel(undefined)}>
                            {t("admin:cancel-4")}
                        </Button>
                        <Button type="primary" loading={saving} onClick={() => void saveModel()}>
                            {t("admin:save-4")}
                        </Button>
                    </div>
                }
            >
                <Form
                    form={modelForm}
                    layout="vertical"
                    requiredMark={false}
                    className="space-y-3"
                    onValuesChange={(changedValues: Partial<LogicalModelFormValues>) => {
                        const capability = changedValues.capability;
                        if (!capability) return;
                        modelForm.setFieldsValue({
                            routes: [],
                            capabilitySpec: emptyCapabilitySpec(capability),
                            defaultOptions: {},
                            pricePolicy: "channel",
                            billingMode: "fixed_request",
                        });
                    }}
                >
                    {editingModel?.configurationError || editingModel?.availabilityError ? (
                        <Alert
                            className="mb-4"
                            type="warning"
                            showIcon
                            message={editingModel.configurationError ? t("admin:current-supply-routes-do-not-cover-all-creator-capabilities") : t("admin:current-supply-routes-cannot-settle-yet")}
                            description={editingModel.configurationError || editingModel.availabilityError}
                        />
                    ) : null}
                    <DrawerSection icon={<Layers3 className="size-4" />} title={t("admin:frontend-display")}>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Form.Item name="name" label={t("admin:display-name")} rules={[{ required: true, message: t("admin:enter-a-display-name") }]}>
                                <Input placeholder={t("admin:e-g-seedance-video")} />
                            </Form.Item>
                            <Form.Item name="code" label={t("admin:model-code")} rules={[{ required: true, message: t("admin:enter-a-model-code") }]}>
                                <Input placeholder={t("admin:e-g-seedance-video-2")} />
                            </Form.Item>
                            <Form.Item name="icon" label={t("admin:model-logo")}>
                                <ModelIconPicker />
                            </Form.Item>
                        </div>
                        <Form.Item name="description" label={t("admin:short-description")}>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("admin:describe-suitable-creation-scenarios-not-supply-channels")} />
                        </Form.Item>
                        <Form.Item name="capability" label={t("admin:type")}>
                            <CapabilityCardPicker density="compact" />
                        </Form.Item>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item name="sortOrder" label={t("admin:frontend-sort-order")}>
                                <InputNumber className="w-full" precision={0} />
                            </Form.Item>
                            <Form.Item name="enabled" label={t("admin:enabled-2")} valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </div>
                    </DrawerSection>
                    <DrawerSection icon={<GitBranch className="size-4" />} title={t("admin:supply-routes-3")}>
                        <RouteFields channelModels={modelChannelModels} channelNames={channelNames} channelEnabled={channelEnabled} form={modelForm} capability={modelCapability} />
                    </DrawerSection>
                    <DrawerSection title={t("admin:selectable-creator-capabilities")}>
                        <Form.Item name="capabilitySpec" noStyle>
                            <CapabilityScopeEditor capability={modelCapability} sourceSpecs={modelSourceSpecs} mode="front" />
                        </Form.Item>
                    </DrawerSection>
                    <DrawerSection title={t("admin:default-parameters")}>
                        <Form.Item name="defaultOptions" noStyle>
                            <DefaultOptionsEditor spec={modelCapabilitySpec} />
                        </Form.Item>
                    </DrawerSection>
                    <DrawerSection title={t("admin:system-spec-pricing")}>
                        <PricingFields />
                    </DrawerSection>
                </Form>
            </Drawer>

            <Modal
                title={simulatingModel ? t("admin:route-matching-simulation-param", { name: simulatingModel.name }) : t("admin:route-matching-simulation")}
                open={Boolean(simulatingModel)}
                className="workspace-modal workspace-modal-wide admin-simulation-modal"
                rootClassName="admin-modal-root"
                centered
                destroyOnHidden
                onCancel={() => setSimulatingModel(undefined)}
                styles={{ body: { maxHeight: "min(72vh, 720px)", overflowY: "auto" } }}
                footer={[
                    <Button key="cancel" onClick={() => setSimulatingModel(undefined)}>
                        {t("admin:close-4")}
                    </Button>,
                    <Button key="submit" type="primary" icon={<FlaskConical className="size-4" />} loading={simulating} onClick={() => void runSimulation()}>
                        {t("admin:simulate-match")}
                    </Button>,
                ]}
            >
                {simulatingModel && simulationIntent ? (
                    <div className="space-y-5">
                        {simulatingModel.capabilitySpec.operations?.length ? (
                            <label className="block">
                                <span className="mb-1 block text-xs text-foreground/55">{t("admin:generation-method-2")}</span>
                                <Select
                                    className="w-full"
                                    value={simulationIntent.operation}
                                    options={simulatingModel.capabilitySpec.operations.map((value) => ({ value, label: operationLabel(value) }))}
                                    onChange={(operation) => setSimulationIntent({ ...simulationIntent, operation })}
                                />
                            </label>
                        ) : null}
                        <CapabilityRequestEditor
                            spec={simulatingModel.capabilitySpec}
                            inputs={simulationIntent.inputs || {}}
                            options={simulationIntent.options || {}}
                            onInputsChange={(inputs) => setSimulationIntent({ ...simulationIntent, inputs })}
                            onOptionsChange={(options) => setSimulationIntent({ ...simulationIntent, options })}
                        />
                        {simulationResult ? (
                            <section className="pt-1">
                                <div className="mb-3 flex items-center justify-between">
                                    <h2 className="text-sm font-semibold">{t("admin:match-result")}</h2>
                                    <Tag variant="filled" color={simulationResult.productMatch.matched ? "success" : "error"}>
                                        {simulationResult.productMatch.matched ? t("admin:request-capabilities-pass") : t("admin:request-capabilities-mismatch")}
                                    </Tag>
                                </div>
                                {simulationResult.productMatch.reasons?.length ? <p className="mb-4 text-sm text-error">{simulationResult.productMatch.reasons.join("；")}</p> : null}
                                <Table size="small" pagination={false} rowKey="routeId" dataSource={simulationResult.candidates} columns={simulationColumns()} />
                            </section>
                        ) : null}
                    </div>
                ) : null}
            </Modal>
        </AdminPageFrame>
    );
}

function DrawerSection({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: string; children: ReactNode }) {
    return (
        <section className="rounded-lg bg-muted/20 p-4">
            <div className="mb-4 flex items-center gap-2.5">
                {icon ? <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/50 text-foreground/55">{icon}</span> : null}
                <div>
                    <h2 className="text-[var(--fs-body)] font-semibold">{title}</h2>
                    {description ? <p className="mt-1 text-xs leading-5 text-foreground/50">{description}</p> : null}
                </div>
            </div>
            {children}
        </section>
    );
}

function RouteFields({
    channelModels,
    channelNames,
    channelEnabled,
    form,
    capability,
}: {
    channelModels: ChannelModel[];
    channelNames: Record<string, string>;
    channelEnabled: Record<string, boolean>;
    form: FormInstance<LogicalModelFormValues>;
    capability: CapabilityKind;
}) {
    const { t } = useTranslation("canvas");
    const selectOptions = channelModels.map((item) => {
        const unavailableReason = channelEnabled[item.channelId] === false ? t("admin:channel-disabled") : !item.enabled ? t("admin:channel-model-disabled") : "";
        return {
            value: item.id,
            label: `${channelNames[item.channelId]} / ${item.displayName || item.modelKey}${unavailableReason ? `（${unavailableReason}）` : ""}`,
            disabled: Boolean(unavailableReason),
        };
    });
    const availableChannelModelCount = selectOptions.filter((item) => !item.disabled).length;
    return (
        <Form.List name="routes">
            {(fields, { add, remove }) => {
                const currentRoutes = (form.getFieldValue("routes") || []) as RouteRuleRow[];
                const selectedChannelModelCount = new Set(currentRoutes.map((route) => route?.channelModelId).filter(Boolean)).size;
                const canAdd = selectedChannelModelCount < availableChannelModelCount;
                return (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-foreground/50">
                                {t("admin:total-2")} {fields.length} {t("admin:supply-routes-2")}
                            </span>
                            <Button size="small" icon={<Plus className="size-3.5" />} disabled={!canAdd} onClick={() => add({ channelModelId: "", enabled: true, priority: 100, weight: 100 })}>
                                {t("admin:add-supply-route")}
                            </Button>
                        </div>
                        {fields.length ? (
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {fields.map((field) => {
                                    const routes = (form.getFieldValue("routes") || []) as RouteRuleRow[];
                                    const selectedByOthers = new Set(routes.map((route, index) => (index === field.name ? "" : route?.channelModelId)).filter(Boolean));
                                    const options = selectOptions.map((option) => ({ ...option, disabled: option.disabled || selectedByOthers.has(option.value) }));
                                    const selected = channelModels.find((item) => item.id === routes[field.name]?.channelModelId);
                                    return (
                                        <div key={field.key} className="rounded-lg border border-border bg-muted/5 p-4">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold">
                                                        {t("admin:supply-routes-3")} {fields.indexOf(field) + 1}
                                                    </div>
                                                    <div className="mt-0.5 truncate text-xs text-foreground/50">
                                                        {selected ? `${channelNames[selected.channelId]} / ${selected.displayName || selected.modelKey}` : t("admin:choose-a-channel-model-that-can-serve-this-request")}
                                                    </div>
                                                </div>
                                                <Button type="text" size="small" danger onClick={() => remove(field.name)}>
                                                    {t("admin:remove")}
                                                </Button>
                                            </div>
                                            <Form.Item name={[field.name, "channelModelId"]} rules={[{ required: true, message: t("admin:select-a-channel-model") }]} className="mb-3">
                                                <Select
                                                    aria-label={`供应线路 ${fields.indexOf(field) + 1}`}
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder={t("admin:select-channel-model")}
                                                    options={options}
                                                    onChange={(channelModelId) => {
                                                        const nextRoutes = [...(form.getFieldValue("routes") || [])];
                                                        nextRoutes[field.name] = { ...nextRoutes[field.name], channelModelId };
                                                        const specs = nextRoutes
                                                            .filter((route) => route.enabled && route.weight > 0)
                                                            .map((route) => channelModels.find((item) => item.id === route.channelModelId && item.enabled && channelEnabled[item.channelId] !== false))
                                                            .map((item) => (item ? capabilitySpecFromChannelModel(item) : undefined))
                                                            .filter((item): item is CapabilitySpec => Boolean(item));
                                                        form.setFieldValue("routes", nextRoutes);
                                                        if (!hasCapabilityRules(form.getFieldValue("capabilitySpec"))) form.setFieldValue("capabilitySpec", mergeCapabilitySpecs(capability, specs));
                                                    }}
                                                />
                                            </Form.Item>
                                            <div className="flex items-end gap-2">
                                                <Form.Item name={[field.name, "priority"]} label={t("admin:priority")} className="mb-0 min-w-0 flex-1">
                                                    <InputNumber className="w-full" precision={0} />
                                                </Form.Item>
                                                <Form.Item name={[field.name, "weight"]} label={t("admin:weight")} className="mb-0 min-w-0 flex-1">
                                                    <InputNumber className="w-full" min={0} precision={0} />
                                                </Form.Item>
                                                <Form.Item name={[field.name, "enabled"]} label={t("admin:enabled-2")} valuePropName="checked" className="mb-0 shrink-0">
                                                    <Switch />
                                                </Form.Item>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                        {!fields.length ? <div className="rounded-md bg-muted/20 px-3 py-4 text-center text-xs text-foreground/50">{t("admin:no-supply-routes-added-yet")}</div> : null}
                    </div>
                );
            }}
        </Form.List>
    );
}

function logicalModelStatusTag(item: AdminLogicalModel) {
    if (!item.enabled) return <AdminStatusBadge label={t("admin:disabled")} tone="neutral" />;
    if (item.configurationError) return <AdminStatusBadge label={t("admin:capability-config-needs-adjustment")} tone="warning" title={item.configurationError} />;
    if (item.availabilityError) return <AdminStatusBadge label={t("admin:route-pricing-needs-adjustment")} tone="warning" title={item.availabilityError} />;
    if (!item.available) return <AdminStatusBadge label={t("admin:no-routes-available")} tone="warning" />;
    return <AdminStatusBadge label={t("admin:available-2")} tone="success" />;
}

function PricingFields() {
    const { t } = useTranslation("canvas");
    const form = Form.useFormInstance<LogicalModelFormValues>();
    useEffect(() => {
        form.setFieldsValue({
            pricePolicy: "channel",
            billingMode: "fixed_request",
            unitPriceMicrocredits: 0,
            inputPriceMicrocredits: 0,
            outputPriceMicrocredits: 0,
            cachedPriceMicrocredits: 0,
        });
    }, [form]);
    return <div className="rounded-md bg-muted/20 px-3 py-3 text-xs leading-5 text-foreground/55">{t("admin:prices-upstream-skus-and-available-specs-are-configured-only-in-system-c")}</div>;
}

function logicalPriceLabel(item: AdminLogicalModel) {
    const priceTiers = item.priceTiers || [];
    if (!priceTiers.length) return <span className="text-xs text-foreground/45">{t("admin:system-spec-pricing-not-configured-yet")}</span>;
    return (
        <span className="text-xs">
            {priceTiers.length} {t("admin:system-spec-tiers")}
        </span>
    );
}

function logicalModelToForm(item: AdminLogicalModel): LogicalModelFormValues {
    return {
        code: item.code,
        name: item.name,
        icon: item.icon || "",
        description: item.description,
        capability: item.capability,
        enabled: item.enabled,
        sortOrder: item.sortOrder,
        pricePolicy: "channel",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 0,
        inputPriceMicrocredits: 0,
        outputPriceMicrocredits: 0,
        cachedPriceMicrocredits: 0,
        capabilitySpec: item.capabilitySpec,
        defaultOptions: item.defaultOptions,
        routes: (item.routes || []).map((route) => ({ channelModelId: route.channelModelId, enabled: route.enabled, priority: route.priority, weight: route.weight })),
    };
}

function logicalModelPayload(values: LogicalModelFormValues, sourceSpecs: CapabilitySpec[] = []): LogicalModelMutation {
    const capabilitySpec = normalizeCapabilitySpecForSources({ ...values.capabilitySpec, capability: values.capability, version: 1 as const }, sourceSpecs) || emptyCapabilitySpec(values.capability);
    return {
        code: values.code.trim(),
        name: values.name.trim(),
        icon: values.icon.trim(),
        description: values.description?.trim() || "",
        capability: values.capability,
        enabled: values.enabled,
        sortOrder: values.sortOrder || 0,
        pricePolicy: "channel",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 0,
        inputPriceMicrocredits: 0,
        outputPriceMicrocredits: 0,
        cachedPriceMicrocredits: 0,
        capabilitySpec,
        defaultOptions: sanitizeDefaults(capabilitySpec, values.defaultOptions),
        routes: values.routes.map((route) => ({ ...route, priority: route.priority || 0, weight: route.weight || 0 })),
    };
}

function hasCapabilityRules(spec?: CapabilitySpec) {
    return Boolean(spec && ((spec.operations?.length || 0) > 0 || Object.keys(spec.inputs || {}).length > 0 || Object.keys(spec.options || {}).length > 0));
}

function simulationColumns(): ColumnsType<RouteSimulationResult["candidates"][number]> {
    return [
        {
            title: t("admin:supply-routes-3"),
            render: (_, candidate) => `${candidate.channelModelName}（${candidate.channelModelKey}）`,
        },
        { title: t("admin:priority"), dataIndex: "priority", width: 80 },
        { title: t("admin:weight"), dataIndex: "weight", width: 70 },
        {
            title: t("admin:result"),
            width: 110,
            render: (_, candidate) => (
                <Tag variant="filled" color={candidate.inPool ? "success" : candidate.blocked ? "warning" : "default"}>
                    {candidate.inPool ? t("admin:entered-candidate-pool") : candidate.blocked ? t("admin:cooling-down") : candidate.matched ? t("admin:low-priority") : t("admin:mismatched")}
                </Tag>
            ),
        },
        { title: t("admin:reason"), render: (_, candidate) => candidate.reasons?.join("；") || "-" },
    ];
}
