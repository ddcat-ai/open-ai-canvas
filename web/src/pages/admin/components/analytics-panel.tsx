import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { BarChart3, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export default function AnalyticsPanel({ users, channels }: Props) {
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
            message.error(error instanceof Error ? error.message : "读取统计数据失败");
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
            message.error(error instanceof Error ? error.message : "搜索用户失败");
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
            message.success("模型价格已保存，后续调用将按新价格记录费用快照");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存价格失败");
        } finally {
            setSavingPricing(false);
        }
    };

    const removePricing = async (id: string) => {
        try {
            await deleteAdminModelPricing(id);
            setPricings((items) => items.filter((item) => item.id !== id));
            message.success("价格配置已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除价格失败");
        }
    };

    const modelColumns: ColumnsType<AdminAnalytics["models"][number]> = [
        {
            title: "模型",
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
        { title: "任务 / 请求", width: 120, render: (_, row) => `${row.tasks} / ${row.requests}` },
        { title: "用户", dataIndex: "uniqueUsers", width: 80 },
        { title: "任务成功率", dataIndex: "taskSuccessRate", width: 110, render: percent },
        { title: "请求成功率", dataIndex: "requestSuccessRate", width: 110, render: percent },
        { title: "P50 / P95", width: 145, render: (_, row) => `${formatDuration(row.p50DurationMs)} / ${formatDuration(row.p95DurationMs)}` },
        { title: "Token（入 / 出 / 缓存）", width: 190, render: (_, row) => (row.usageAvailable ? `${formatNumber(row.inputTokens)} / ${formatNumber(row.outputTokens)} / ${formatNumber(row.cachedTokens)}` : "--") },
        { title: "媒体 / 视频秒", width: 125, render: (_, row) => `${row.mediaCount} / ${row.videoSeconds}` },
        { title: "估算费用", width: 120, render: (_, row) => formatCost(row.estimatedCostMicros, row.currency, row.costAvailable) },
    ];

    const userColumns: ColumnsType<AdminAnalytics["users"][number]> = [
        {
            title: "用户",
            dataIndex: "name",
            width: 180,
            render: (name, row) => (
                <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-foreground/45">{row.userId}</div>
                </div>
            ),
        },
        { title: "活跃天数", dataIndex: "activeDays", width: 95 },
        { title: "任务", dataIndex: "tasks", width: 80 },
        { title: "Agent 消息", dataIndex: "agentMessages", width: 105 },
        { title: "画布活跃天数", dataIndex: "canvasDays", width: 120 },
        { title: "素材 / 资源", width: 110, render: (_, row) => `${row.assets} / ${row.resources}` },
        { title: "常用模型", dataIndex: "commonModel", ellipsis: true, render: (value) => value || "--" },
    ];

    const failureColumns: ColumnsType<AdminAnalytics["failures"][number]> = [
        { title: "错误类型", dataIndex: "type", width: 120, render: (value) => <AdminStatusBadge label={value} tone={value === "超时" ? "warning" : "error"} /> },
        { title: "模型", dataIndex: "model", width: 220 },
        { title: "次数", dataIndex: "count", width: 90 },
        { title: "最近错误", dataIndex: "lastError", ellipsis: true, render: (value) => <Tooltip title={value}>{value || "--"}</Tooltip> },
        { title: "最近发生", dataIndex: "lastSeenAt", width: 170, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    ];

    const pricingColumns: ColumnsType<ModelPricing> = [
        {
            title: "模型",
            dataIndex: "model",
            width: 210,
            render: (value, row) => (
                <div>
                    <div className="font-medium">{value}</div>
                    <div className="text-xs text-foreground/45">{row.channelId ? channels.find((channel) => channel.id === row.channelId)?.name || row.channelId : "全部渠道"}</div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: "输入 / 输出 / 缓存（每百万 Token）",
            width: 250,
            render: (_, row) => `${formatMoney(fromMicros(row.inputPerMillionMicros), row.currency)} / ${formatMoney(fromMicros(row.outputPerMillionMicros), row.currency)} / ${formatMoney(fromMicros(row.cachedPerMillionMicros), row.currency)}`,
        },
        {
            title: "每请求 / 每媒体 / 每视频秒",
            width: 220,
            render: (_, row) => `${formatMoney(fromMicros(row.perRequestMicros), row.currency)} / ${formatMoney(fromMicros(row.perMediaMicros), row.currency)} / ${formatMoney(fromMicros(row.perVideoSecondMicros), row.currency)}`,
        },
        {
            title: "操作",
            width: 170,
            render: (_, row) => (
                <AdminRowActions
                    primary={{ label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => openPricing(row) }}
                    actions={[
                        {
                            key: "delete",
                            label: "删除",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: "删除价格配置？", description: "删除后新的调用不再使用这条价格配置，历史费用不受影响。", okText: "确认删除" },
                            onClick: () => removePricing(row.id),
                        },
                    ]}
                />
            ),
        },
    ];

    const trend = data?.trend || [];
    const hasTrendActivity = trend.some((item) => item.tasks > 0 || item.requests > 0);
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
                        {model ? <AdminFilterChip label={`模型：${model}`} onRemove={() => setModel(undefined)} /> : null}
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
                            刷新
                        </Button>
                        <AdminExportButton exportFile={() => exportAdminAnalytics(filters)} fileName={() => `usage-${filters.from}-${filters.to}.csv`} label="导出 CSV" />
                    </>
                }
                filters={
                    <>
                        <FilterSelect
                            label="用户"
                            value={userId}
                            onChange={setUserId}
                            options={userOptions.map((user) => ({ label: user.displayName || user.username, value: user.id }))}
                            filterOption={false}
                            loading={searchingUsers}
                            onSearch={(value) => void searchUsers(value)}
                        />
                        <FilterSelect label="模型" value={model} onChange={setModel} options={modelOptions} width={210} />
                        <FilterSelect label="渠道" value={channelId} onChange={setChannelId} options={channels.map((channel) => ({ label: channel.name, value: channel.id }))} />
                        <FilterSelect label="能力" value={capability} onChange={setCapability} options={capabilityOptions} />
                    </>
                }
            >
                <div>
                    <div className="mb-1 text-xs text-foreground/55">时间范围</div>
                    <DatePicker.RangePicker allowClear={false} value={range} onChange={(value) => value?.[0] && value?.[1] && setRange([value[0], value[1]])} />
                </div>
            </ListToolbar>

            <div className="grid overflow-hidden rounded-md border border-border sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatTile
                    label="活跃用户"
                    value={data ? formatNumber(data.kpi.activeUsers) : "--"}
                    trend={formatCountDelta(currentTrend?.activeUsers, previousTrend?.activeUsers)}
                    detail={data ? `DAU ${formatNumber(data.kpi.dau)} · WAU ${formatNumber(data.kpi.wau)} · MAU ${formatNumber(data.kpi.mau)}` : undefined}
                />
                <AdminStatTile label="上游请求" value={data ? formatNumber(data.kpi.upstreamRequests) : "--"} trend={formatCountDelta(currentTrend?.requests, previousTrend?.requests)} detail="当前统计范围" />
                <AdminStatTile
                    label="生成任务"
                    value={data ? formatNumber(data.kpi.generationTasks) : "--"}
                    trend={formatCountDelta(currentTrend?.tasks, previousTrend?.tasks)}
                    detail={data ? `队列 ${formatNumber(data.kpi.currentQueuedTasks)}` : undefined}
                />
                <AdminStatTile
                    label="请求成功率"
                    value={data ? percent(data.kpi.successRate) : "--"}
                    trend={formatRateDelta(currentTrend?.requestSuccessRate, previousTrend?.requestSuccessRate)}
                    detail={data ? `P95 ${formatDuration(data.kpi.p95DurationMs)}` : undefined}
                />
            </div>
            <div className="grid gap-x-4 gap-y-2 border-b border-border pb-4 text-xs text-foreground/55 sm:grid-cols-3">
                <div>
                    当前队列 <span className="ml-1 font-medium text-foreground">{data ? formatNumber(data.kpi.currentQueuedTasks) : "--"}</span>
                </div>
                <div>
                    P95 耗时 <span className="ml-1 font-medium text-foreground">{data ? formatDuration(data.kpi.p95DurationMs) : "--"}</span>
                </div>
                <div>
                    估算费用 <span className="ml-1 font-medium text-foreground">{data ? formatCost(data.kpi.estimatedCostMicros, data.kpi.currency, data.kpi.costAvailable) : "--"}</span>
                </div>
            </div>

            <section className="admin-analytics-trend-section">
                <div className="mb-3">
                    <h3 className="text-sm font-medium">使用趋势</h3>
                    <p className="text-xs text-foreground/50">生成任务与真实上游请求分开统计，成功率按上游请求计算。</p>
                </div>
                {hasTrendActivity ? (
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data?.trend || []} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                                <CartesianGrid stroke="currentColor" className="text-foreground/10" vertical={false} />
                                <XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 11 }} />
                                <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 11 }} />
                                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                                <ChartTooltip labelFormatter={(value) => `日期 ${value}`} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Area yAxisId="count" type="monotone" dataKey="tasks" name="生成任务" stroke="var(--admin-chart-primary)" fill="var(--admin-chart-primary)" fillOpacity={0.1} />
                                <Area yAxisId="count" type="monotone" dataKey="requests" name="上游请求" stroke="var(--admin-chart-secondary)" fill="var(--admin-chart-secondary)" fillOpacity={0.08} />
                                <Line yAxisId="rate" type="monotone" dataKey="requestSuccessRate" name="成功率" stroke="var(--admin-chart-warning)" dot={false} strokeWidth={2} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="admin-analytics-empty-chart">
                        <span>
                            <BarChart3 className="size-5" />
                        </span>
                        <div className="font-medium">当前范围暂无使用数据</div>
                        <p>可以调整时间范围或筛选条件后重新查看。</p>
                    </div>
                )}
            </section>

            <Tabs
                items={[
                    {
                        key: "models",
                        label: "模型分析",
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
                        label: "用户活动",
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
                        label: `异常定位${data?.failures.length ? ` (${data.failures.reduce((sum, item) => sum + item.count, 0)})` : ""}`,
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
                        label: "模型价格",
                        children: (
                            <div>
                                <div className="mb-3 flex items-center justify-end">
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openPricing()}>
                                        新增价格
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

            <Modal title={editingPricing ? "编辑模型价格" : "新增模型价格"} open={pricingModalOpen} onCancel={() => setPricingModalOpen(false)} onOk={() => void savePricing()} confirmLoading={savingPricing} okText="保存" cancelText="取消" width={760}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                        <Form.Item name="model" label="模型" rules={[{ required: true, message: "请填写模型名" }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="channelId" label="渠道范围">
                            <Select allowClear placeholder="全部渠道" options={channels.map((channel) => ({ label: channel.name, value: channel.id }))} />
                        </Form.Item>
                        <Form.Item name="capability" label="能力类型" rules={[{ required: true }]}>
                            <Select options={capabilityOptions} />
                        </Form.Item>
                        <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
                            <Input maxLength={12} />
                        </Form.Item>
                        <PriceInput name="inputPerMillion" label="每百万输入 Token" />
                        <PriceInput name="outputPerMillion" label="每百万输出 Token" />
                        <PriceInput name="cachedPerMillion" label="每百万缓存 Token" />
                        <PriceInput name="perRequest" label="每次请求" />
                        <PriceInput name="perMedia" label="每个输出媒体" />
                        <PriceInput name="perVideoSecond" label="每视频秒" />
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
    return (
        <div>
            <div className="mb-1 text-xs text-foreground/55">{label}</div>
            <Select allowClear showSearch optionFilterProp="label" filterOption={filterOption} loading={loading} placeholder="全部" value={value} onChange={onChange} onSearch={onSearch} options={options} style={{ width }} />
        </div>
    );
}

function PriceInput({ name, label }: { name: keyof PricingFormValues; label: string }) {
    return (
        <Form.Item name={name} label={`${label}（币种单位）`} rules={[{ type: "number", min: 0, message: "价格不能小于 0" }]}>
            <InputNumber min={0} precision={6} step={0.000001} className="w-full" />
        </Form.Item>
    );
}

function capabilityLabel(value: string) {
    return capabilityOptions.find((item) => item.value === value)?.label || "未分类";
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
