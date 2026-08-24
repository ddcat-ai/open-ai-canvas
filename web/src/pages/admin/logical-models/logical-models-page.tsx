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
            message.error(error instanceof Error ? error.message : "读取前台模型配置失败");
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
            message.error("请至少添加一条供应线路");
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
            message.success(editingModel ? "前台模型已更新" : "前台模型已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存前台模型失败");
        } finally {
            setSaving(false);
        }
    };

    const toggleModel = async (item: AdminLogicalModel) => {
        try {
            await updateAdminLogicalModel(item.id, logicalModelPayload({ ...logicalModelToForm(item), enabled: !item.enabled }));
            await reload();
            message.success(item.enabled ? "前台模型已停用" : "前台模型已启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新模型状态失败");
        }
    };

    const removeModel = async (item: AdminLogicalModel) => {
        setDeletingModelId(item.id);
        try {
            await deleteAdminLogicalModel(item.id);
            setModels((current) => current.filter((model) => model.id !== item.id));
            if (paginatedModels.length === 1 && page > 1) setPage(page - 1);
            message.success("前台模型已归档");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "归档前台模型失败");
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
            message.error(error instanceof Error ? error.message : "路由模拟失败");
        } finally {
            setSimulating(false);
        }
    };

    const modelColumns: ColumnsType<AdminLogicalModel> = [
        {
            title: "前台模型",
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
        { title: "类型", dataIndex: "capability", width: 90, render: (value: CapabilityKind) => capabilityLabel(value) },
        { title: "创作端能力", width: 360, render: (_, item) => <CapabilitySummary spec={item.capabilitySpec} /> },
        {
            title: "供应线路",
            width: 110,
            render: (_, item) => (
                <div className="text-xs">
                    <div>{(item.routes || []).filter((route) => route.enabled && route.available).length} 条可用</div>
                    <div className="text-foreground/45">共 {(item.routes || []).length} 条</div>
                </div>
            ),
        },
        { title: "用户价格", width: 160, render: (_, item) => logicalPriceLabel(item) },
        { title: "状态", width: 130, render: (_, item) => logicalModelStatusTag(item) },
        {
            title: "操作",
            width: 230,
            align: "right",
            render: (_, item) => (
                <AdminRowActions
                    primary={{ label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => openModel(item) }}
                    visibleActionCount={1}
                    actions={[
                        { key: "simulate", label: "模拟供应线路匹配", icon: <FlaskConical className="size-3.5" />, onClick: () => openSimulation(item) },
                        { key: "toggle", label: item.enabled ? "停用" : "启用", onClick: () => void toggleModel(item) },
                        {
                            key: "archive",
                            label: "归档模型",
                            icon: <Archive className="size-3.5" />,
                            danger: true,
                            disabled: deletingModelId === item.id,
                            confirm: {
                                title: `归档前台模型“${item.name}”？`,
                                description: "归档后模型将从公开目录中移除，不能在页面恢复；历史任务和版本记录会保留。排队中或进行中的任务仍在使用时无法归档。",
                                okText: "确认归档",
                            },
                            onClick: () => removeModel(item),
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="前台模型目录"
            actions={
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openModel()}>
                    新增模型
                </Button>
            }
        >
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
                        placeholder="搜索模型名称、代码或能力"
                        className="app-list-search"
                    />
                }
                toolbarActiveFilters={
                    keyword ? (
                        <AdminFilterChip
                            label={`搜索：${keyword}`}
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
                empty={<AdminTableEmpty filtered={Boolean(deferredKeyword)} title="暂无模型" />}
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
                title={editingModel ? "编辑前台模型" : "新增前台模型"}
                open={editingModel !== undefined}
                size="min(1120px, 100vw)"
                destroyOnHidden
                maskClosable={!saving}
                onClose={() => !saving && setEditingModel(undefined)}
                rootClassName="admin-drawer"
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving} onClick={() => setEditingModel(undefined)}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} onClick={() => void saveModel()}>
                            保存
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
                            message={editingModel.configurationError ? "当前供应线路无法覆盖全部创作端能力" : "当前供应线路暂不可结算"}
                            description={editingModel.configurationError || editingModel.availabilityError}
                        />
                    ) : null}
                    <DrawerSection icon={<Layers3 className="size-4" />} title="前台展示">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Form.Item name="name" label="显示名称" rules={[{ required: true, message: "请填写显示名称" }]}>
                                <Input placeholder="例如：Seedance 视频" />
                            </Form.Item>
                            <Form.Item name="code" label="模型代码" rules={[{ required: true, message: "请填写模型代码" }]}>
                                <Input placeholder="例如：seedance-video" />
                            </Form.Item>
                            <Form.Item name="icon" label="模型 Logo">
                                <ModelIconPicker />
                            </Form.Item>
                        </div>
                        <Form.Item name="description" label="简短说明">
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="说明适合的创作场景，不描述供应渠道。" />
                        </Form.Item>
                        <Form.Item name="capability" label="类型">
                            <CapabilityCardPicker density="compact" />
                        </Form.Item>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item name="sortOrder" label="前台排序">
                                <InputNumber className="w-full" precision={0} />
                            </Form.Item>
                            <Form.Item name="enabled" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </div>
                    </DrawerSection>
                    <DrawerSection icon={<GitBranch className="size-4" />} title="供应线路">
                        <RouteFields channelModels={modelChannelModels} channelNames={channelNames} channelEnabled={channelEnabled} form={modelForm} capability={modelCapability} />
                    </DrawerSection>
                    <DrawerSection title="创作端可选能力">
                        <Form.Item name="capabilitySpec" noStyle>
                            <CapabilityScopeEditor capability={modelCapability} sourceSpecs={modelSourceSpecs} mode="front" />
                        </Form.Item>
                    </DrawerSection>
                    <DrawerSection title="默认参数">
                        <Form.Item name="defaultOptions" noStyle>
                            <DefaultOptionsEditor spec={modelCapabilitySpec} />
                        </Form.Item>
                    </DrawerSection>
                    <DrawerSection title="系统规格价格">
                        <PricingFields />
                    </DrawerSection>
                </Form>
            </Drawer>

            <Modal
                title={simulatingModel ? `供应线路匹配模拟 - ${simulatingModel.name}` : "供应线路匹配模拟"}
                open={Boolean(simulatingModel)}
                className="workspace-modal workspace-modal-wide admin-simulation-modal"
                rootClassName="admin-modal-root"
                centered
                destroyOnHidden
                onCancel={() => setSimulatingModel(undefined)}
                styles={{ body: { maxHeight: "min(72vh, 720px)", overflowY: "auto" } }}
                footer={[
                    <Button key="cancel" onClick={() => setSimulatingModel(undefined)}>
                        关闭
                    </Button>,
                    <Button key="submit" type="primary" icon={<FlaskConical className="size-4" />} loading={simulating} onClick={() => void runSimulation()}>
                        模拟匹配
                    </Button>,
                ]}
            >
                {simulatingModel && simulationIntent ? (
                    <div className="space-y-5">
                        {simulatingModel.capabilitySpec.operations?.length ? (
                            <label className="block">
                                <span className="mb-1 block text-xs text-foreground/55">生成方式</span>
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
                                    <h2 className="text-sm font-semibold">匹配结果</h2>
                                    <Tag variant="filled" color={simulationResult.productMatch.matched ? "success" : "error"}>
                                        {simulationResult.productMatch.matched ? "请求能力通过" : "请求能力不匹配"}
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
    const selectOptions = channelModels.map((item) => {
        const unavailableReason = channelEnabled[item.channelId] === false ? "渠道已停用" : !item.enabled ? "渠道模型已停用" : "";
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
                            <span className="text-xs text-foreground/50">共 {fields.length} 条供应线路</span>
                            <Button size="small" icon={<Plus className="size-3.5" />} disabled={!canAdd} onClick={() => add({ channelModelId: "", enabled: true, priority: 100, weight: 100 })}>
                                添加供应线路
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
                                                    <div className="text-xs font-semibold">供应线路 {fields.indexOf(field) + 1}</div>
                                                    <div className="mt-0.5 truncate text-xs text-foreground/50">{selected ? `${channelNames[selected.channelId]} / ${selected.displayName || selected.modelKey}` : "选择一个可承接请求的渠道模型"}</div>
                                                </div>
                                                <Button type="text" size="small" danger onClick={() => remove(field.name)}>
                                                    移除
                                                </Button>
                                            </div>
                                            <Form.Item name={[field.name, "channelModelId"]} rules={[{ required: true, message: "请选择渠道模型" }]} className="mb-3">
                                                <Select
                                                    aria-label={`供应线路 ${fields.indexOf(field) + 1}`}
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder="选择渠道模型"
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
                                                <Form.Item name={[field.name, "priority"]} label="优先级" className="mb-0 min-w-0 flex-1">
                                                    <InputNumber className="w-full" precision={0} />
                                                </Form.Item>
                                                <Form.Item name={[field.name, "weight"]} label="权重" className="mb-0 min-w-0 flex-1">
                                                    <InputNumber className="w-full" min={0} precision={0} />
                                                </Form.Item>
                                                <Form.Item name={[field.name, "enabled"]} label="启用" valuePropName="checked" className="mb-0 shrink-0">
                                                    <Switch />
                                                </Form.Item>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                        {!fields.length ? <div className="rounded-md bg-muted/20 px-3 py-4 text-center text-xs text-foreground/50">尚未添加供应线路</div> : null}
                    </div>
                );
            }}
        </Form.List>
    );
}

function logicalModelStatusTag(item: AdminLogicalModel) {
    if (!item.enabled) return <AdminStatusBadge label="已停用" tone="neutral" />;
    if (item.configurationError) return <AdminStatusBadge label="能力配置需调整" tone="warning" title={item.configurationError} />;
    if (item.availabilityError) return <AdminStatusBadge label="线路价格需调整" tone="warning" title={item.availabilityError} />;
    if (!item.available) return <AdminStatusBadge label="暂无可用线路" tone="warning" />;
    return <AdminStatusBadge label="可用" tone="success" />;
}

function PricingFields() {
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
    return <div className="rounded-md bg-muted/20 px-3 py-3 text-xs leading-5 text-foreground/55">价格、上游 SKU 和可用规格只在“系统渠道 / 模型管理”配置。前台模型只负责展示、能力范围和故障切换，不再保存第二份价格。</div>;
}

function logicalPriceLabel(item: AdminLogicalModel) {
    const priceTiers = item.priceTiers || [];
    if (!priceTiers.length) return <span className="text-xs text-foreground/45">待配置系统规格价格</span>;
    return <span className="text-xs">{priceTiers.length} 个系统规格档</span>;
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
            title: "供应线路",
            render: (_, candidate) => `${candidate.channelModelName}（${candidate.channelModelKey}）`,
        },
        { title: "优先级", dataIndex: "priority", width: 80 },
        { title: "权重", dataIndex: "weight", width: 70 },
        {
            title: "结果",
            width: 110,
            render: (_, candidate) => (
                <Tag variant="filled" color={candidate.inPool ? "success" : candidate.blocked ? "warning" : "default"}>
                    {candidate.inPool ? "进入候选池" : candidate.blocked ? "冷却中" : candidate.matched ? "低优先级" : "不匹配"}
                </Tag>
            ),
        },
        { title: "原因", render: (_, candidate) => candidate.reasons?.join("；") || "-" },
    ];
}
