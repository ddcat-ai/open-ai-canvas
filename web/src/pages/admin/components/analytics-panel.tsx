import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { useSearchParams } from "react-router";

import { ListToolbar, PaginationBar } from "@/components/layout/workspace-page";
import {
    createAdminModelPricing,
    deleteAdminModelPricing,
    exportAdminAnalytics,
    getAdminAnalytics,
    listAdminUsers,
    listAdminModelPricings,
    updateAdminModelPricing,
    type AdminReferenceData,
    type AdminAnalytics,
    type AnalyticsFilters,
    type ModelPricing,
} from "@/services/api/auth";
import { AdminDataTable, AdminExportButton, AdminFilterChip, AdminRowActions, AdminStatTile, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type Props = {
    users: AdminReferenceData["users"];
    channels: AdminReferenceData["channels"];
};

type PricingFormValues = {
    channelId?: string;
    model: string;
    capability: ModelPricing["capability"];
    currency: string;
    inputPerMillion?: number;
    outputPerMillion?: number;
    cachedPerMillion?: number;
    perRequest?: number;
    perMedia?: number;
    perVideoSecond?: number;
};

const capabilityOptions = [
    { label: t("admin:text"), value: "text" },
    { label: t("admin:image"), value: "image" },
    { label: t("admin:video"), value: "video" },
    { label: t("admin:audio"), value: "audio" },
];

export default function AnalyticsPanel({ users, channels }: Props) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [filterDate(searchParams.get("from"), dayjs().subtract(29, "day")), filterDate(searchParams.get("to"), dayjs())]);
    const [userId, setUserId] = useState(searchParams.get("userId") || undefined);
    const [model, setModel] = useState(searchParams.get("model") || undefined);
    const [channelId, setChannelId] = useState(searchParams.get("channelId") || undefined);
    const [capability, setCapability] = useState(searchParams.get("capability") || undefined);
    const [data, setData] = useState<AdminAnalytics | null>(null);
    const [pricings, setPricings] = useState<ModelPricing[]>([]);
    const [loading, setLoading] = useState(false);
    const [pricingModalOpen, setPricingModalOpen] = useState(false);
    const [editingPricing, setEditingPricing] = useState<ModelPricing | null>(null);
    const [savingPricing, setSavingPricing] = useState(false);
    const [userOptions, setUserOptions] = useState(users);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [modelPage, setModelPage] = useState(1);
    const [userPage, setUserPage] = useState(1);
    const [failurePage, setFailurePage] = useState(1);
    const [pricingPage, setPricingPage] = useState(1);
    const [form] = Form.useForm<PricingFormValues>();
    const analyticsPageSize = 20;

    const filters = useMemo<AnalyticsFilters>(
        () => ({
            from: range[0].format("YYYY-MM-DD"),
            to: range[1].format("YYYY-MM-DD"),
            userId,
            model,
            channelId,
            capability,
        }),
        [capability, channelId, model, range, userId],
    );

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [analytics, pricingData] = await Promise.all([getAdminAnalytics(filters), listAdminModelPricings()]);
            setData(analytics);
            setPricings(pricingData.pricings);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-load-statistics"));
        } finally {
            setLoading(false);
        }
    }, [filters, message]);

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(filters)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setSearchParams(next, { replace: true });
        void reload();
    }, [filters]);

    useEffect(() => {
        setModelPage(1);
        setUserPage(1);
        setFailurePage(1);
        setPricingPage(1);
    }, [filters]);

    useEffect(() => {
        setUserOptions(users);
    }, [users]);

    const searchUsers = async (keyword: string) => {
        setSearchingUsers(true);
        try {
            const result = await listAdminUsers({ keyword: keyword.trim() || undefined, page: 1, limit: 50 });
            setUserOptions(result.users);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-search-users"));
        } finally {
            setSearchingUsers(false);
        }
    };

    const modelOptions = useMemo(() => {
        const names = new Set<string>();
        channels.forEach((channel) => channel.models?.forEach((name) => names.add(name)));
        data?.models.forEach((item) => item.model !== "未识别" && names.add(item.model));
        return [...names].sort().map((name) => ({ label: name, value: name }));
    }, [channels, data?.models]);

    const openPricing = (pricing?: ModelPricing) => {
        setEditingPricing(pricing || null);
        form.setFieldsValue(
            pricing
                ? {
                      channelId: pricing.channelId || undefined,
                      model: pricing.model,
                      capability: pricing.capability,
                      currency: pricing.currency,
                      inputPerMillion: fromMicros(pricing.inputPerMillionMicros),
                      outputPerMillion: fromMicros(pricing.outputPerMillionMicros),
                      cachedPerMillion: fromMicros(pricing.cachedPerMillionMicros),
                      perRequest: fromMicros(pricing.perRequestMicros),
                      perMedia: fromMicros(pricing.perMediaMicros),
                      perVideoSecond: fromMicros(pricing.perVideoSecondMicros),
                  }
                : { channelId: undefined, model: "", capability: "text", currency: "USD", inputPerMillion: 0, outputPerMillion: 0, cachedPerMillion: 0, perRequest: 0, perMedia: 0, perVideoSecond: 0 },
        );
        setPricingModalOpen(true);
    };

    const savePricing = async () => {
        const values = await form.validateFields();
        const payload = {
            channelId: values.channelId || "",
            model: values.model.trim(),
            capability: values.capability,
            currency: values.currency.trim().toUpperCase(),
            inputPerMillionMicros: toMicros(values.inputPerMillion),
            outputPerMillionMicros: toMicros(values.outputPerMillion),
            cachedPerMillionMicros: toMicros(values.cachedPerMillion),
            perRequestMicros: toMicros(values.perRequest),
            perMediaMicros: toMicros(values.perMedia),
            perVideoSecondMicros: toMicros(values.perVideoSecond),
        };
        setSavingPricing(true);
        try {
            const result = editingPricing ? await updateAdminModelPricing(editingPricing.id, payload) : await createAdminModelPricing(payload);
            setPricings((items) => (editingPricing ? items.map((item) => (item.id === result.pricing.id ? result.pricing : item)) : [...items, result.pricing]));
            setPricingModalOpen(false);
            message.success(t("admin:model-pricing-saved-subsequent-calls-record-cost-snapshots-at-the-new-pr"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-pricing"));
        } finally {
            setSavingPricing(false);
        }
    };

    const removePricing = async (id: string) => {
        try {
            await deleteAdminModelPricing(id);
            setPricings((items) => items.filter((item) => item.id !== id));
            message.success(t("admin:pricing-configuration-deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-delete-pricing"));
        }
    };

    const modelColumns: ColumnsType<AdminAnalytics["models"][number]> = [
        {
            title: t("admin:models"),
            dataIndex: "model",
            fixed: "left",
            width: 210,
            render: (value, row) => (
                <div>
                    <div className="font-medium">{value}</div>
                    <div className="mt-1">
                        <Tag variant="filled">{capabilityLabel(row.capability)}</Tag>
                    </div>
                </div>
            ),
        },
        { title: t("admin:tasks-requests"), width: 120, render: (_, row) => `${row.tasks} / ${row.requests}` },
        { title: t("admin:users-2"), dataIndex: "uniqueUsers", width: 80 },
        { title: t("admin:task-success-rate"), dataIndex: "taskSuccessRate", width: 110, render: percent },
        { title: t("admin:request-success-rate"), dataIndex: "requestSuccessRate", width: 110, render: percent },
        { title: "P50 / P95", width: 145, render: (_, row) => `${formatDuration(row.p50DurationMs)} / ${formatDuration(row.p95DurationMs)}` },
        { title: t("admin:tokens-in-out-cached"), width: 190, render: (_, row) => (row.usageAvailable ? `${formatNumber(row.inputTokens)} / ${formatNumber(row.outputTokens)} / ${formatNumber(row.cachedTokens)}` : "--") },
        { title: t("admin:media-video-seconds"), width: 125, render: (_, row) => `${row.mediaCount} / ${row.videoSeconds}` },
        { title: t("admin:estimated-cost-3"), width: 120, render: (_, row) => formatCost(row.estimatedCostMicros, row.currency, row.costAvailable) },
    ];

    const userColumns: ColumnsType<AdminAnalytics["users"][number]> = [
        {
            title: t("admin:users-2"),
            dataIndex: "name",
            width: 180,
            render: (name, row) => (
                <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-foreground/45">{row.userId}</div>
                </div>
            ),
        },
        { title: t("admin:active-days"), dataIndex: "activeDays", width: 95 },
        { title: t("admin:tasks"), dataIndex: "tasks", width: 80 },
        { title: t("admin:agent-messages"), dataIndex: "agentMessages", width: 105 },
        { title: t("admin:canvas-active-days"), dataIndex: "canvasDays", width: 120 },
        { title: t("admin:assets-resources"), width: 110, render: (_, row) => `${row.assets} / ${row.resources}` },
        { title: t("admin:top-models"), dataIndex: "commonModel", ellipsis: true, render: (value) => value || "--" },
    ];

    const failureColumns: ColumnsType<AdminAnalytics["failures"][number]> = [
        { title: t("admin:error-types"), dataIndex: "type", width: 120, render: (value) => <AdminStatusBadge label={value} tone={value === "超时" ? "warning" : "error"} /> },
        { title: t("admin:models"), dataIndex: "model", width: 220 },
        { title: t("admin:count"), dataIndex: "count", width: 90 },
        { title: t("admin:recent-errors"), dataIndex: "lastError", ellipsis: true, render: (value) => <Tooltip title={value}>{value || "--"}</Tooltip> },
        { title: t("admin:last-seen"), dataIndex: "lastSeenAt", width: 170, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    ];

    const pricingColumns: ColumnsType<ModelPricing> = [
        {
            title: t("admin:models"),
            dataIndex: "model",
            width: 210,
            render: (value, row) => (
                <div>
                    <div className="font-medium">{value}</div>
                    <div className="text-xs text-foreground/45">{row.channelId ? channels.find((channel) => channel.id === row.channelId)?.name || row.channelId : t("admin:all-channels")}</div>
                </div>
            ),
        },
        { title: t("admin:capability"), dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: t("admin:in-out-cached-per-1m-tokens"),
            width: 250,
            render: (_, row) => `${formatMoney(fromMicros(row.inputPerMillionMicros), row.currency)} / ${formatMoney(fromMicros(row.outputPerMillionMicros), row.currency)} / ${formatMoney(fromMicros(row.cachedPerMillionMicros), row.currency)}`,
        },
        {
            title: t("admin:per-request-per-media-per-video-second"),
            width: 220,
            render: (_, row) => `${formatMoney(fromMicros(row.perRequestMicros), row.currency)} / ${formatMoney(fromMicros(row.perMediaMicros), row.currency)} / ${formatMoney(fromMicros(row.perVideoSecondMicros), row.currency)}`,
        },
        {
            title: t("admin:actions"),
            width: 170,
            render: (_, row) => (
                <AdminRowActions
                    primary={{ label: t("admin:edit-2"), icon: <Pencil className="size-3.5" />, onClick: () => openPricing(row) }}
                    actions={[
                        {
                            key: "delete",
                            label: t("admin:delete"),
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: t("admin:delete-this-pricing-configuration"), description: t("admin:new-calls-stop-using-this-pricing-after-deletion-historical-costs-are-un"), okText: t("admin:confirm-delete") },
                            onClick: () => removePricing(row.id),
                        },
                    ]}
                />
            ),
        },
    ];

    const trend = data?.trend || [];
    const currentTrend = trend[trend.length - 1];
    const previousTrend = trend[trend.length - 2];
    const modelRows = data?.models || [];
    const userRows = data?.users || [];
    const failureRows = data?.failures || [];
    const pricingRows = pricings;
    const pageRows = <T,>(rows: T[], page: number) => rows.slice((page - 1) * analyticsPageSize, page * analyticsPageSize);

    return (
        <div className="space-y-5">
            <ListToolbar
                active={Boolean(userId || model || channelId || capability)}
                activeFilters={
                    <>
                        {userId ? <AdminFilterChip label={`用户：${userOptions.find((user) => user.id === userId)?.displayName || userId}`} onRemove={() => setUserId(undefined)} /> : null}
                        {model ? <AdminFilterChip label={t("admin:model-param", { model: model })} onRemove={() => setModel(undefined)} /> : null}
                        {channelId ? <AdminFilterChip label={`渠道：${channels.find((channel) => channel.id === channelId)?.name || channelId}`} onRemove={() => setChannelId(undefined)} /> : null}
                        {capability ? <AdminFilterChip label={`能力：${capabilityLabel(capability)}`} onRemove={() => setCapability(undefined)} /> : null}
                    </>
                }
                onReset={() => {
                    setUserId(undefined);
                    setModel(undefined);
                    setChannelId(undefined);
                    setCapability(undefined);
                }}
                trailing={
                    <>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                            {t("admin:refresh-3")}
                        </Button>
                        <AdminExportButton exportFile={() => exportAdminAnalytics(filters)} fileName={() => `usage-${filters.from}-${filters.to}.csv`} label={t("admin:export-csv")} />
                    </>
                }
                filters={
                    <>
                        <FilterSelect
                            label={t("admin:users-2")}
                            value={userId}
                            onChange={setUserId}
                            options={userOptions.map((user) => ({ label: user.displayName || user.username, value: user.id }))}
                            filterOption={false}
                            loading={searchingUsers}
                            onSearch={(value) => void searchUsers(value)}
                        />
                        <FilterSelect label={t("admin:models")} value={model} onChange={setModel} options={modelOptions} width={210} />
                        <FilterSelect label={t("admin:channels")} value={channelId} onChange={setChannelId} options={channels.map((channel) => ({ label: channel.name, value: channel.id }))} />
                        <FilterSelect label={t("admin:capability")} value={capability} onChange={setCapability} options={capabilityOptions} />
                    </>
                }
            >
                <div>
                    <div className="mb-1 text-xs text-foreground/55">{t("admin:time-range")}</div>
                    <DatePicker.RangePicker allowClear={false} value={range} onChange={(value) => value?.[0] && value?.[1] && setRange([value[0], value[1]])} />
                </div>
            </ListToolbar>

            <div className="grid overflow-hidden rounded-md border border-border sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatTile
                    label={t("admin:active-users")}
                    value={data ? formatNumber(data.kpi.activeUsers) : "--"}
                    trend={formatCountDelta(currentTrend?.activeUsers, previousTrend?.activeUsers)}
                    detail={data ? `DAU ${formatNumber(data.kpi.dau)} · WAU ${formatNumber(data.kpi.wau)} · MAU ${formatNumber(data.kpi.mau)}` : undefined}
                />
                <AdminStatTile label={t("admin:upstream-requests")} value={data ? formatNumber(data.kpi.upstreamRequests) : "--"} trend={formatCountDelta(currentTrend?.requests, previousTrend?.requests)} detail={t("admin:current-stats-scope")} />
                <AdminStatTile
                    label={t("admin:generation-tasks")}
                    value={data ? formatNumber(data.kpi.generationTasks) : "--"}
                    trend={formatCountDelta(currentTrend?.tasks, previousTrend?.tasks)}
                    detail={data ? `队列 ${formatNumber(data.kpi.currentQueuedTasks)}` : undefined}
                />
                <AdminStatTile
                    label={t("admin:request-success-rate")}
                    value={data ? percent(data.kpi.successRate) : "--"}
                    trend={formatRateDelta(currentTrend?.requestSuccessRate, previousTrend?.requestSuccessRate)}
                    detail={data ? `P95 ${formatDuration(data.kpi.p95DurationMs)}` : undefined}
                />
            </div>
            <div className="grid gap-x-4 gap-y-2 border-b border-border pb-4 text-xs text-foreground/55 sm:grid-cols-3">
                <div>
                    {t("admin:current-queue")} <span className="ml-1 font-medium text-foreground">{data ? formatNumber(data.kpi.currentQueuedTasks) : "--"}</span>
                </div>
                <div>
                    {t("admin:p95-latency")} <span className="ml-1 font-medium text-foreground">{data ? formatDuration(data.kpi.p95DurationMs) : "--"}</span>
                </div>
                <div>
                    {t("admin:estimated-cost-3")} <span className="ml-1 font-medium text-foreground">{data ? formatCost(data.kpi.estimatedCostMicros, data.kpi.currency, data.kpi.costAvailable) : "--"}</span>
                </div>
            </div>

            <section className="border-y border-border py-4">
                <div className="mb-3">
                    <h3 className="text-sm font-medium">{t("admin:usage-trends")}</h3>
                    <p className="text-xs text-foreground/50">{t("admin:generation-tasks-and-real-upstream-requests-are-tracked-separately-succe")}</p>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data?.trend || []} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                            <CartesianGrid stroke="currentColor" className="text-foreground/10" vertical={false} />
                            <XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                            <ChartTooltip labelFormatter={(value) => t("admin:date-param", { value: value })} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Area yAxisId="count" type="monotone" dataKey="tasks" name={t("admin:generation-tasks")} stroke="var(--admin-chart-primary)" fill="var(--admin-chart-primary)" fillOpacity={0.1} />
                            <Area yAxisId="count" type="monotone" dataKey="requests" name={t("admin:upstream-requests")} stroke="var(--admin-chart-secondary)" fill="var(--admin-chart-secondary)" fillOpacity={0.08} />
                            <Line yAxisId="rate" type="monotone" dataKey="requestSuccessRate" name={t("admin:success-rate")} stroke="var(--admin-chart-warning)" dot={false} strokeWidth={2} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </section>

            <Tabs
                items={[
                    {
                        key: "models",
                        label: t("admin:model-analytics"),
                        children: (
                            <AdminDataTable
                                table={{ rowKey: (row) => `${row.model}:${row.capability}`, size: "small", loading, columns: modelColumns, dataSource: pageRows(modelRows, modelPage), pagination: false, scroll: { x: 1250 } }}
                                empty={<AdminTableEmpty />}
                                skeletonColumns={9}
                                footer={<PaginationBar alwaysShow current={modelPage} pageSize={analyticsPageSize} total={modelRows.length} onChange={(page) => setModelPage(page)} pageSizeOptions={[analyticsPageSize]} />}
                            />
                        ),
                    },
                    {
                        key: "users",
                        label: t("admin:user-activity"),
                        children: (
                            <AdminDataTable
                                table={{ rowKey: "userId", size: "small", loading, columns: userColumns, dataSource: pageRows(userRows, userPage), pagination: false, scroll: { x: 900 } }}
                                empty={<AdminTableEmpty />}
                                skeletonColumns={7}
                                footer={<PaginationBar alwaysShow current={userPage} pageSize={analyticsPageSize} total={userRows.length} onChange={(page) => setUserPage(page)} pageSizeOptions={[analyticsPageSize]} />}
                            />
                        ),
                    },
                    {
                        key: "failures",
                        label: `${t("admin:failure-analysis")}${data?.failures.length ? ` (${data.failures.reduce((sum, item) => sum + item.count, 0)})` : ""}`,
                        children: (
                            <AdminDataTable
                                table={{ rowKey: (row) => `${row.type}:${row.model}`, size: "small", loading, columns: failureColumns, dataSource: pageRows(failureRows, failurePage), pagination: false, scroll: { x: 900 } }}
                                empty={<AdminTableEmpty />}
                                skeletonColumns={5}
                                footer={<PaginationBar alwaysShow current={failurePage} pageSize={analyticsPageSize} total={failureRows.length} onChange={(page) => setFailurePage(page)} pageSizeOptions={[analyticsPageSize]} />}
                            />
                        ),
                    },
                    {
                        key: "pricing",
                        label: t("admin:model-pricing"),
                        children: (
                            <div>
                                <div className="mb-3 flex items-center justify-end">
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openPricing()}>
                                        {t("admin:add-pricing")}
                                    </Button>
                                </div>
                                <AdminDataTable
                                    table={{ rowKey: "id", size: "small", loading, columns: pricingColumns, dataSource: pageRows(pricingRows, pricingPage), pagination: false, scroll: { x: 980 } }}
                                    empty={<AdminTableEmpty />}
                                    skeletonColumns={5}
                                    footer={<PaginationBar alwaysShow current={pricingPage} pageSize={analyticsPageSize} total={pricingRows.length} onChange={(page) => setPricingPage(page)} pageSizeOptions={[analyticsPageSize]} />}
                                />
                            </div>
                        ),
                    },
                ]}
            />

            <Modal
                title={editingPricing ? t("admin:edit-model-pricing") : t("admin:add-model-pricing")}
                open={pricingModalOpen}
                onCancel={() => setPricingModalOpen(false)}
                onOk={() => void savePricing()}
                confirmLoading={savingPricing}
                okText={t("admin:save-4")}
                cancelText={t("admin:cancel-4")}
                width={760}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                        <Form.Item name="model" label={t("admin:models")} rules={[{ required: true, message: t("admin:enter-a-model-name") }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="channelId" label={t("admin:channel-scope")}>
                            <Select allowClear placeholder={t("admin:all-channels")} options={channels.map((channel) => ({ label: channel.name, value: channel.id }))} />
                        </Form.Item>
                        <Form.Item name="capability" label={t("admin:capability-type")} rules={[{ required: true }]}>
                            <Select options={capabilityOptions} />
                        </Form.Item>
                        <Form.Item name="currency" label={t("admin:currency")} rules={[{ required: true }]}>
                            <Input maxLength={12} />
                        </Form.Item>
                        <PriceInput name="inputPerMillion" label={t("admin:input-per-1m-tokens")} />
                        <PriceInput name="outputPerMillion" label={t("admin:output-per-1m-tokens")} />
                        <PriceInput name="cachedPerMillion" label={t("admin:cached-per-1m-tokens")} />
                        <PriceInput name="perRequest" label={t("admin:per-request")} />
                        <PriceInput name="perMedia" label={t("admin:per-output-media")} />
                        <PriceInput name="perVideoSecond" label={t("admin:per-video-second")} />
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

function FilterSelect({
    label,
    value,
    onChange,
    options,
    width = 150,
    filterOption = true,
    loading,
    onSearch,
}: {
    label: string;
    value?: string;
    onChange: (value?: string) => void;
    options: Array<{ label: string; value: string }>;
    width?: number;
    filterOption?: boolean;
    loading?: boolean;
    onSearch?: (value: string) => void;
}) {
    const { t } = useTranslation("canvas");
    return (
        <div>
            <div className="mb-1 text-xs text-foreground/55">{label}</div>
            <Select allowClear showSearch optionFilterProp="label" filterOption={filterOption} loading={loading} placeholder={t("admin:all")} value={value} onChange={onChange} onSearch={onSearch} options={options} style={{ width }} />
        </div>
    );
}

function PriceInput({ name, label }: { name: keyof PricingFormValues; label: string }) {
    const { t } = useTranslation("canvas");
    return (
        <Form.Item name={name} label={t("admin:param-currency-unit", { label: label })} rules={[{ type: "number", min: 0, message: t("admin:price-cannot-be-negative") }]}>
            <InputNumber min={0} precision={6} step={0.000001} className="w-full" />
        </Form.Item>
    );
}

function capabilityLabel(value: string) {
    return capabilityOptions.find((item) => item.value === value)?.label || t("admin:uncategorized");
}

function percent(value: number) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function formatDuration(value: number) {
    if (!value) return "--";
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("zh-CN", { notation: value >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatCountDelta(current?: number, previous?: number) {
    if (current === undefined || previous === undefined) return undefined;
    const delta = current - previous;
    const direction = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    const value = previous === 0 ? formatNumber(Math.abs(delta)) : `${Math.abs((delta / previous) * 100).toFixed(1)}%`;
    return { value: `${direction} ${value}`, tone: delta >= 0 ? ("success" as const) : ("warning" as const) };
}

function formatRateDelta(current?: number, previous?: number) {
    if (current === undefined || previous === undefined) return undefined;
    const delta = current - previous;
    const direction = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    return { value: `${direction} ${Math.abs(delta).toFixed(1)}pp`, tone: delta >= 0 ? ("success" as const) : ("warning" as const) };
}

function formatCost(micros: number, currency?: string, available?: boolean) {
    return available ? formatMoney(fromMicros(micros), currency || "USD") : "--";
}

function formatMoney(value: number, currency = "USD") {
    if (currency === "MIXED") return `${value.toFixed(6)}（混合币种）`;
    try {
        return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
    } catch {
        return `${currency} ${value.toFixed(6)}`;
    }
}

function fromMicros(value: number) {
    return value / 1_000_000;
}

function toMicros(value?: number) {
    return Math.round((value || 0) * 1_000_000);
}

function filterDate(value: string | null, fallback: Dayjs) {
    if (!value) return fallback;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : fallback;
}
