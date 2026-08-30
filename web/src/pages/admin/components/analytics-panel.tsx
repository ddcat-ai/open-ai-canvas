import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, DatePicker, Drawer, Form, Input, Modal, Select, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { AlertTriangle, BarChart3, CircleDollarSign, Clock3, Gauge, Pencil, Plus, RefreshCw, Settings2, Trash2, UsersRound, Workflow } from "lucide-react";
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
import { AdminDataTable, AdminExportButton, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";

type Props = {
    users: AdminReferenceData["users"];
    channels: AdminReferenceData["channels"];
};

type PricingFormValues = {
    channelId?: string;
    model: string;
    capability: ModelPricing["capability"];
    currency: string;
    inputPerMillion?: string;
    outputPerMillion?: string;
    cachedPerMillion?: string;
    perRequest?: string;
    perMedia?: string;
    perVideoSecond?: string;
};

type TrendMetric = "volume" | "quality" | "activity";
type AnalysisTab = "models" | "users" | "failures";
type RangePreset = "7d" | "30d" | "60d";

const capabilityOptions = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export default function AnalyticsPanel({ users, channels }: Props) {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const [rangePreset, setRangePreset] = useState<RangePreset | undefined>(() => initialRangePreset(searchParams));
    const [range, setRange] = useState<[Dayjs, Dayjs]>(() => initialAnalyticsRange(searchParams, rangePreset));
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
    const [trendMetric, setTrendMetric] = useState<TrendMetric>("volume");
    const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("models");
    const [pricingWorkspaceOpen, setPricingWorkspaceOpen] = useState(false);
    const [pendingPricing, setPendingPricing] = useState<ModelPricing | null | undefined>(undefined);
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
        if (rangePreset) next.set("rangePreset", rangePreset);
        else next.delete("rangePreset");
        setSearchParams(next, { replace: true });
        void reload();
    }, [filters, rangePreset]);

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

    const pricingModelOptions = useMemo(() => {
        const names = new Set<string>();
        const sourceChannels = channels.filter((channel) => channel.enabled !== false);
        sourceChannels.forEach((channel) => channel.models?.forEach((name) => names.add(name)));
        if (editingPricing?.model) names.add(editingPricing.model);
        return [...names].sort().map((name) => ({ label: name, value: name }));
    }, [channels, editingPricing?.model]);

    const preparePricingForm = (pricing: ModelPricing | null) => {
        setEditingPricing(pricing);
        form.resetFields();
        form.setFieldsValue(
            pricing
                ? {
                      channelId: pricing.channelId || undefined,
                      model: pricing.model,
                      capability: pricing.capability,
                      currency: pricing.currency,
                      inputPerMillion: formatPriceInput(pricing.inputPerMillionMicros),
                      outputPerMillion: formatPriceInput(pricing.outputPerMillionMicros),
                      cachedPerMillion: formatPriceInput(pricing.cachedPerMillionMicros),
                      perRequest: formatPriceInput(pricing.perRequestMicros),
                      perMedia: formatPriceInput(pricing.perMediaMicros),
                      perVideoSecond: formatPriceInput(pricing.perVideoSecondMicros),
                  }
                : { channelId: undefined, model: "", capability: "text", currency: "USD", inputPerMillion: "", outputPerMillion: "", cachedPerMillion: "", perRequest: "", perMedia: "", perVideoSecond: "" },
        );
        setPricingModalOpen(true);
    };

    const openPricing = (pricing?: ModelPricing) => {
        const nextPricing = pricing || null;
        if (pricingWorkspaceOpen) {
            setPendingPricing(nextPricing);
            setPricingWorkspaceOpen(false);
        } else {
            preparePricingForm(nextPricing);
        }
    };

    const handlePricingValuesChange = (changedValues: Partial<PricingFormValues>, values: PricingFormValues) => {
        if (Object.prototype.hasOwnProperty.call(changedValues, "channelId")) {
            const nextModels = channels
                .filter((channel) => channel.enabled !== false && (!values.channelId || channel.id === values.channelId))
                .flatMap((channel) => channel.models || []);
            if (values.model && !nextModels.includes(values.model)) form.setFieldValue("model", undefined);
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(changedValues, "model") || !values.model) return;
        const matchingChannels = channels.filter((channel) => channel.enabled !== false && channel.models?.includes(values.model));
        if (values.channelId && matchingChannels.some((channel) => channel.id === values.channelId)) return;
        if (matchingChannels.length) form.setFieldValue("channelId", matchingChannels[0].id);
    };

    const handlePricingModelChange = (modelName: string) => {
        const currentChannelId = form.getFieldValue("channelId") as string | undefined;
        const matchingChannels = channels.filter((channel) => channel.enabled !== false && channel.models?.includes(modelName));
        const matchingChannel = matchingChannels.find((channel) => channel.id === currentChannelId) || matchingChannels[0];
        form.setFieldsValue({ model: modelName, channelId: matchingChannel?.id || currentChannelId });
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
                        <Tag className="admin-analytics-capability-tag">{capabilityLabel(row.capability)}</Tag>
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
    const currentTrend = trend[trend.length - 1];
    const previousTrend = trend[trend.length - 2];
    const modelRows = data?.models || [];
    const userRows = data?.users || [];
    const failureRows = data?.failures || [];
    const pricingRows = pricings;
    const failureTotal = failureRows.reduce((sum, item) => sum + item.count, 0);
    const topFailure = failureRows.reduce<AdminAnalytics["failures"][number] | undefined>((current, item) => (!current || item.count > current.count ? item : current), undefined);
    const pricedModelCount = modelRows.filter((item) => item.costAvailable).length;
    const trendHasData = trendMetric === "volume" ? trend.some((item) => item.tasks > 0 || item.requests > 0) : trendMetric === "quality" ? trend.some((item) => item.requests > 0) : trend.some((item) => item.activeUsers > 0);
    const trendTitle = trendMetric === "volume" ? "任务与请求趋势" : trendMetric === "quality" ? "请求质量趋势" : "用户活跃趋势";
    const pageRows = <T,>(rows: T[], page: number) => rows.slice((page - 1) * analyticsPageSize, page * analyticsPageSize);

    const applyRangePreset = (preset: RangePreset) => {
        const end = dayjs();
        const start = preset === "7d" ? end.subtract(6, "day") : preset === "30d" ? end.subtract(29, "day") : end.subtract(59, "day");
        setRangePreset(preset);
        setRange([start, end]);
    };

    const openAnalysis = (tab: AnalysisTab) => {
        setAnalysisTab(tab);
        window.requestAnimationFrame(() => document.getElementById("admin-analytics-analysis")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    };

    return (
        <div className="admin-analytics-panel space-y-5">
            <ListToolbar
                className="admin-analytics-toolbar"
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
                        <div className="admin-analytics-range-picker" role="group" aria-label="时间范围">
                            <span className="sr-only">时间范围</span>
                            <DatePicker.RangePicker
                                allowClear={false}
                                value={range}
                                onChange={(value) => {
                                    if (value?.[0] && value?.[1]) {
                                        setRangePreset(undefined);
                                        setRange([value[0], value[1]]);
                                    }
                                }}
                            />
                        </div>
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
                <div className="admin-analytics-range-presets" role="group" aria-label="快捷时间范围">
                    {(
                        [
                            ["7d", "7 天"],
                            ["30d", "30 天"],
                            ["60d", "60 天"],
                        ] as const
                    ).map(([value, label]) => (
                        <button key={value} type="button" className={rangePreset === value ? "is-active" : undefined} aria-pressed={rangePreset === value} onClick={() => applyRangePreset(value)}>
                            {label}
                        </button>
                    ))}
                </div>
            </ListToolbar>

            <section className="admin-analytics-health-grid" aria-label="运营健康指标">
                <AnalyticsHealthCard
                    icon={<UsersRound className="size-4" />}
                    label="活跃用户"
                    value={data ? formatNumber(data.kpi.activeUsers) : "--"}
                    trend={formatCountDelta(currentTrend?.activeUsers, previousTrend?.activeUsers)}
                    detail={data ? `DAU ${formatNumber(data.kpi.dau)} · WAU ${formatNumber(data.kpi.wau)} · MAU ${formatNumber(data.kpi.mau)}` : undefined}
                />
                <AnalyticsHealthCard
                    icon={<Workflow className="size-4" />}
                    label="生成任务"
                    value={data ? formatNumber(data.kpi.generationTasks) : "--"}
                    trend={formatCountDelta(currentTrend?.tasks, previousTrend?.tasks)}
                    detail={data ? `上游请求 ${formatNumber(data.kpi.upstreamRequests)} · 队列 ${formatNumber(data.kpi.currentQueuedTasks)}` : undefined}
                />
                <AnalyticsHealthCard
                    icon={<Gauge className="size-4" />}
                    label="服务质量"
                    value={data ? percent(data.kpi.successRate) : "--"}
                    trend={formatRateDelta(currentTrend?.requestSuccessRate, previousTrend?.requestSuccessRate)}
                    detail={data ? `P95 ${formatDuration(data.kpi.p95DurationMs)}` : undefined}
                    tone={data && data.kpi.successRate < 90 ? "warning" : "success"}
                />
                <AnalyticsHealthCard
                    icon={<CircleDollarSign className="size-4" />}
                    label="估算费用"
                    value={data ? (data.kpi.costAvailable ? formatCost(data.kpi.estimatedCostMicros, data.kpi.currency, true) : "待配置") : "--"}
                    detail={data ? (data.kpi.costAvailable ? `${pricedModelCount}/${modelRows.length} 个模型可估算` : "价格未完整配置，暂不能汇总") : undefined}
                    tone={data?.kpi.costAvailable ? "neutral" : "warning"}
                />
            </section>

            <div className="admin-analytics-overview-grid">
                <section className="admin-analytics-trend-section" aria-labelledby="admin-analytics-trend-title">
                    <div className="admin-analytics-section-heading">
                        <div>
                            <h2 id="admin-analytics-trend-title">{trendTitle}</h2>
                            <p>{trendMetric === "volume" ? "生成任务与真实上游请求分开统计。" : trendMetric === "quality" ? "成功率按真实上游请求计算。" : "活跃用户按自然日去重统计。"}</p>
                        </div>
                        <div className="admin-analytics-trend-switch" role="group" aria-label="趋势指标">
                            {(
                                [
                                    ["volume", "用量"],
                                    ["quality", "质量"],
                                    ["activity", "活跃"],
                                ] as const
                            ).map(([value, label]) => (
                                <button key={value} type="button" className={trendMetric === value ? "is-active" : undefined} aria-pressed={trendMetric === value} onClick={() => setTrendMetric(value)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {trendHasData ? (
                        <div className="admin-analytics-chart" role="img" aria-label={`${trendTitle}图`}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={data?.trend || []} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                                    <CartesianGrid stroke="currentColor" className="text-foreground/10" vertical={false} />
                                    <XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 11 }} />
                                    {trendMetric === "quality" ? <YAxis yAxisId="primary" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} /> : <YAxis yAxisId="primary" allowDecimals={false} tick={{ fontSize: 11 }} />}
                                    <ChartTooltip labelFormatter={(value) => `日期 ${value}`} />
                                    {trendMetric === "volume" ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                                    {trendMetric === "volume" ? (
                                        <>
                                            <Area yAxisId="primary" type="monotone" dataKey="tasks" name="生成任务" stroke="var(--admin-chart-primary)" fill="var(--admin-chart-primary)" fillOpacity={0.1} />
                                            <Area yAxisId="primary" type="monotone" dataKey="requests" name="上游请求" stroke="var(--admin-chart-secondary)" fill="var(--admin-chart-secondary)" fillOpacity={0.08} />
                                        </>
                                    ) : null}
                                    {trendMetric === "quality" ? <Line yAxisId="primary" type="monotone" dataKey="requestSuccessRate" name="成功率" stroke="var(--admin-chart-warning)" dot={false} strokeWidth={2} /> : null}
                                    {trendMetric === "activity" ? <Area yAxisId="primary" type="monotone" dataKey="activeUsers" name="活跃用户" stroke="var(--admin-chart-primary)" fill="var(--admin-chart-primary)" fillOpacity={0.1} /> : null}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="admin-analytics-empty-chart">
                            <span>
                                <BarChart3 className="size-5" />
                            </span>
                            <div className="font-medium">当前范围暂无{trendMetric === "quality" ? "质量" : trendMetric === "activity" ? "活跃" : "使用"}数据</div>
                            <p>可以调整时间范围或筛选条件后重新查看。</p>
                        </div>
                    )}
                </section>

                <aside className="admin-analytics-attention" aria-labelledby="admin-analytics-attention-title">
                    <div className="admin-analytics-attention-heading">
                        <div>
                            <h2 id="admin-analytics-attention-title">需要关注</h2>
                            <p>优先展示可能需要处理的运行状态。</p>
                        </div>
                        <AdminStatusBadge label={failureTotal > 0 ? `${formatNumber(failureTotal)} 次异常` : "运行平稳"} tone={failureTotal > 0 ? "warning" : "success"} />
                    </div>
                    <div className="admin-analytics-attention-list">
                        <AnalyticsAttentionItem
                            icon={<AlertTriangle className="size-4" />}
                            label="异常请求"
                            value={data ? formatNumber(failureTotal) : "--"}
                            description={topFailure ? `${topFailure.type} · ${topFailure.model}` : "当前范围未记录异常"}
                            tone={failureTotal > 0 ? "warning" : "success"}
                            onClick={failureTotal > 0 ? () => openAnalysis("failures") : undefined}
                        />
                        <AnalyticsAttentionItem
                            icon={<Clock3 className="size-4" />}
                            label="当前队列"
                            value={data ? formatNumber(data.kpi.currentQueuedTasks) : "--"}
                            description={data?.kpi.currentQueuedTasks ? "存在等待执行的生成任务" : "没有排队中的生成任务"}
                            tone={data?.kpi.currentQueuedTasks ? "warning" : "success"}
                        />
                        <AnalyticsAttentionItem
                            icon={<CircleDollarSign className="size-4" />}
                            label="费用可估算模型"
                            value={data ? `${pricedModelCount}/${modelRows.length}` : "--"}
                            description={data?.kpi.costAvailable ? "当前范围费用可以汇总" : "仍有调用无法完成费用估算"}
                            tone={data?.kpi.costAvailable ? "success" : "warning"}
                            onClick={() => setPricingWorkspaceOpen(true)}
                        />
                    </div>
                </aside>
            </div>

            <section id="admin-analytics-analysis" className="admin-analytics-analysis-section">
                <div className="admin-analytics-analysis-heading">
                    <div>
                        <h2>深度分析</h2>
                        <p>按模型、用户或异常类型继续核对当前统计范围。</p>
                    </div>
                    <Button icon={<Settings2 className="size-4" />} onClick={() => setPricingWorkspaceOpen(true)}>
                        模型价格配置
                    </Button>
                </div>
                <Tabs
                    activeKey={analysisTab}
                    onChange={(key) => setAnalysisTab(key as AnalysisTab)}
                    className="admin-analytics-tabs"
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
                    ]}
                />
            </section>

            <Drawer
                rootClassName="admin-secondary-drawer admin-analytics-pricing-drawer"
                title="模型价格配置"
                open={pricingWorkspaceOpen}
                width="min(1120px, calc(100vw - 48px))"
                onClose={() => setPricingWorkspaceOpen(false)}
                afterOpenChange={(open) => {
                    if (open || pendingPricing === undefined) return;
                    const nextPricing = pendingPricing;
                    setPendingPricing(undefined);
                    preparePricingForm(nextPricing);
                }}
                extra={
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openPricing()}>
                        新增价格
                    </Button>
                }
            >
                <p className="admin-analytics-pricing-description">价格只影响后续调用的费用快照，历史统计不会被重新计算。</p>
                <AdminDataTable
                    table={{ rowKey: "id", size: "small", loading, columns: pricingColumns, dataSource: pageRows(pricingRows, pricingPage), pagination: false, scroll: { x: 980 } }}
                    empty={<AdminTableEmpty title="暂无模型价格" description="新增价格后，后续调用才能形成可汇总的费用快照。" />}
                    skeletonColumns={5}
                    footer={<PaginationBar alwaysShow current={pricingPage} pageSize={analyticsPageSize} total={pricingRows.length} onChange={(page) => setPricingPage(page)} pageSizeOptions={[analyticsPageSize]} />}
                />
            </Drawer>

            <Modal rootClassName="admin-modal-root admin-analytics-pricing-modal" title={editingPricing ? "编辑模型价格" : "新增模型价格"} open={pricingModalOpen} onCancel={() => setPricingModalOpen(false)} onOk={() => void savePricing()} confirmLoading={savingPricing} okText="保存" cancelText="取消" width={760} zIndex={1200} destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false} onValuesChange={handlePricingValuesChange}>
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                        <Form.Item name="model" label="模型" rules={[{ required: true, message: "请选择模型" }]}>
                            <Select showSearch optionFilterProp="label" placeholder={pricingModelOptions.length ? "选择已启用模型" : "暂无已启用模型"} options={pricingModelOptions} disabled={!pricingModelOptions.length} onChange={handlePricingModelChange} />
                        </Form.Item>
                        <Form.Item name="channelId" label="渠道范围">
                            <Select allowClear placeholder="全部渠道" options={channels.filter((channel) => channel.enabled !== false).map((channel) => ({ label: channel.name, value: channel.id }))} />
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

function AnalyticsHealthCard({ icon, label, value, trend, detail, tone = "neutral" }: { icon: ReactNode; label: string; value: ReactNode; trend?: { value: string; tone?: AdminStatusTone }; detail?: string; tone?: AdminStatusTone }) {
    return (
        <article className="admin-analytics-health-card" data-tone={tone}>
            <div className="admin-analytics-health-card-heading">
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
            </div>
            <div className="admin-analytics-health-card-value">{value}</div>
            <div className="admin-analytics-health-card-meta">
                {trend ? <AdminStatusBadge label={trend.value} tone={trend.tone || "neutral"} /> : null}
                {detail ? <span>{detail}</span> : null}
            </div>
        </article>
    );
}

function AnalyticsAttentionItem({ icon, label, value, description, tone = "neutral", onClick }: { icon: ReactNode; label: string; value: ReactNode; description: string; tone?: AdminStatusTone; onClick?: () => void }) {
    const content = (
        <>
            <span className="admin-analytics-attention-icon" aria-hidden="true">
                {icon}
            </span>
            <span className="admin-analytics-attention-copy">
                <span className="admin-analytics-attention-label">{label}</span>
                <span className="admin-analytics-attention-description">{description}</span>
            </span>
            <strong>{value}</strong>
        </>
    );

    return onClick ? (
        <button type="button" className="admin-analytics-attention-item is-action" data-tone={tone} onClick={onClick}>
            {content}
        </button>
    ) : (
        <div className="admin-analytics-attention-item" data-tone={tone}>
            {content}
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
            <Select aria-label={`${label}筛选`} allowClear showSearch optionFilterProp="label" filterOption={filterOption} loading={loading} placeholder="全部" value={value} onChange={onChange} onSearch={onSearch} options={options} style={{ width }} />
        </div>
    );
}

function PriceInput({ name, label }: { name: keyof PricingFormValues; label: string }) {
    return (
        <Form.Item className="admin-analytics-price-field" name={name} label={`${label}（币种单位）`} rules={[{ validator: validatePriceInput }]}>
            <Input aria-label={`${label}价格`} disabled={false} readOnly={false} inputMode="decimal" maxLength={30} className="admin-analytics-price-input" style={{ width: "100%" }} />
        </Form.Item>
    );
}

function validatePriceInput(_: unknown, value?: string) {
    const normalized = value?.trim() || "";
    if (!normalized || /^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(normalized)) return Promise.resolve();
    return Promise.reject(new Error("请输入非负价格，最多 6 位小数"));
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
    return { value: `较前一日 ${direction} ${value}`, tone: delta >= 0 ? ("success" as const) : ("warning" as const) };
}

function formatRateDelta(current?: number, previous?: number) {
    if (current === undefined || previous === undefined) return undefined;
    const delta = current - previous;
    const direction = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    return { value: `较前一日 ${direction} ${Math.abs(delta).toFixed(1)}pp`, tone: delta >= 0 ? ("success" as const) : ("warning" as const) };
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

function formatPriceInput(micros: number) {
    return fromMicros(micros).toFixed(6);
}

function toMicros(value?: string | number) {
    const parsed = typeof value === "number" ? value : Number(value?.trim() || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : 0;
}

function filterDate(value: string | null, fallback: Dayjs) {
    if (!value) return fallback;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : fallback;
}

function resolveRangePreset(range: [Dayjs, Dayjs]): RangePreset | undefined {
    const end = dayjs();
    if (!range[1].isSame(end, "day")) return undefined;
    if (range[0].isSame(end.subtract(6, "day"), "day")) return "7d";
    if (range[0].isSame(end.subtract(29, "day"), "day")) return "30d";
    if (range[0].isSame(end.subtract(59, "day"), "day")) return "60d";
    return undefined;
}

function parseRangePreset(value: string | null): RangePreset | undefined {
    return value === "7d" || value === "30d" || value === "60d" ? value : undefined;
}

function initialRangePreset(searchParams: URLSearchParams): RangePreset | undefined {
    const explicit = parseRangePreset(searchParams.get("rangePreset"));
    if (explicit) return explicit;
    if (searchParams.has("from") || searchParams.has("to")) return resolveRangePresetFromQuery(searchParams.get("from"), searchParams.get("to"));
    return "30d";
}

function initialAnalyticsRange(searchParams: URLSearchParams, preset: RangePreset | undefined): [Dayjs, Dayjs] {
    const end = dayjs();
    if (preset) {
        const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 59;
        return [end.subtract(days, "day"), end];
    }
    return [filterDate(searchParams.get("from"), end.subtract(29, "day")), filterDate(searchParams.get("to"), end)];
}

function resolveRangePresetFromQuery(from: string | null, to: string | null): RangePreset | undefined {
    const start = from ? dayjs(from) : null;
    const end = to ? dayjs(to) : null;
    if (!start?.isValid() || !end?.isValid()) return undefined;
    return resolveRangePreset([start, end]);
}
