import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, CalendarDays, ChevronDown, Clock, Compass, Eye, Info, MousePointerClick, RefreshCw, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { siteTrafficActionLabels, siteTrafficPageLabels } from "@/lib/site-traffic";
import { getSiteTrafficOverview, getSiteTrafficToday, type SiteTrafficOverview, type SiteTrafficPageEngagement } from "@/services/api/site-traffic";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminEmpty, AdminExportButton, ListToolbar, PaginationBar } from "../components/admin-ui";
import { createTrafficCsv, trafficCsvFileName, type TrafficCsvKind } from "./traffic-csv";
import { TrafficHeatmap } from "./traffic-heatmap";
import { TrafficJourneys } from "./traffic-journeys";
import { TrafficOperations } from "./traffic-operations";
import { trafficDateBounds, trafficEventTime, trafficPresetRange, trafficRangeError, type TrafficDateRange } from "./traffic-range";
import { TrafficTrendChart } from "./traffic-trend-chart";
import "./traffic-page.css";

type PageRow = { key: string; rank: number; page: string; pageViews: number | null; visitors: number | null; visits: number | null; share: number; engagement?: SiteTrafficPageEngagement };
type ActionRow = Omit<SiteTrafficOverview["actions"][number], "page" | "action"> & { key: number; rank: number; page: string; action: string; share: number };
type DailyRow = SiteTrafficOverview["trend"][number] & { coverageUnknown: boolean };

const count = new Intl.NumberFormat("zh-CN");
const ratio = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const safeLabel = (labels: Record<string, string>, key: string, fallback: string) => (Object.hasOwn(labels, key) ? labels[key]! : fallback);
const todayQueryKey = ["admin", "site-traffic", "today"] as const;

const pageColumns: ColumnsType<PageRow> = [
    {
        title: "页面",
        dataIndex: "page",
        width: 210,
        render: (value: string, row) => (
            <div className="admin-traffic-rank-entity">
                <span className="admin-traffic-rank-badge" data-top={row.rank <= 3 ? row.rank : undefined}>
                    {row.rank}
                </span>
                <span className="admin-traffic-rank-name">{value}</span>
            </div>
        ),
    },
    {
        title: "PV 浏览量",
        dataIndex: "pageViews",
        align: "right",
        width: 150,
        render: (value: number | null, row) =>
            value === null ? (
                <span className="admin-traffic-num">待同步</span>
            ) : (
                <div className="admin-traffic-metric-cell" data-accent="cyan">
                    <div className="admin-traffic-metric-row">
                        <strong>{count.format(value)}</strong>
                        <span>{Math.round(row.share)}%</span>
                    </div>
                    <div className="admin-traffic-metric-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(row.share, value > 0 ? 6 : 0)}%` }} />
                    </div>
                </div>
            ),
    },
    {
        title: "UV 访客",
        dataIndex: "visitors",
        align: "right",
        width: 96,
        render: (value: number | null) => <span className="admin-traffic-num">{value === null ? "待同步" : count.format(value)}</span>,
    },
    {
        title: "会话",
        dataIndex: "visits",
        align: "right",
        width: 96,
        render: (value: number | null) => <span className="admin-traffic-num">{value === null ? "待同步" : count.format(value)}</span>,
    },
    {
        title: "操作参与度",
        key: "engagement",
        align: "center",
        width: 200,
        render: (_, row) => {
            const item = row.engagement;
            if (!item) return <span className="admin-traffic-num">待同步</span>;
            if (item.measurement === "unsupported")
                return (
                    <span className="admin-traffic-num" title="此页面未接入关键操作采集，不表示参与度为 0">
                        N/A · 未支持操作采集
                    </span>
                );
            return (
                <div className="admin-traffic-page-engagement">
                    <strong>{item.measurement === "mixed" ? "N/A · 部分支持操作采集" : item.visits === 0 ? "无 PV 会话" : item.rate === null ? "不可用" : `${ratio.format(item.rate * 100)}%`}</strong>
                    <span>
                        {item.engagedVisits === null ? "不可用" : count.format(item.engagedVisits)} / {count.format(item.visits)} 个会话
                    </span>
                </div>
            );
        },
    },
];

const actionColumns: ColumnsType<ActionRow> = [
    {
        title: "关键操作",
        dataIndex: "action",
        width: 190,
        render: (value: string, row) => (
            <div className="admin-traffic-rank-entity">
                <span className="admin-traffic-rank-badge" data-top={row.rank <= 3 ? row.rank : undefined}>
                    {row.rank}
                </span>
                <span className="admin-traffic-rank-name">{value}</span>
            </div>
        ),
    },
    {
        title: "来源页面",
        dataIndex: "page",
        width: 136,
        render: (value: string) => <span className="admin-traffic-source-chip">{value}</span>,
    },
    {
        title: "触发次数",
        dataIndex: "count",
        align: "right",
        width: 146,
        render: (value: number, row) => (
            <div className="admin-traffic-metric-cell" data-accent="violet">
                <div className="admin-traffic-metric-row">
                    <strong>{count.format(value)}</strong>
                    <span>{Math.round(row.share)}%</span>
                </div>
                <div className="admin-traffic-metric-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(row.share, value > 0 ? 6 : 0)}%` }} />
                </div>
            </div>
        ),
    },
    {
        title: "操作访客",
        dataIndex: "visitors",
        align: "right",
        width: 96,
        render: (value: number) => <span className="admin-traffic-num">{count.format(value)}</span>,
    },
];

const dailyColumns: ColumnsType<DailyRow> = [
    {
        title: "日期（上海）",
        dataIndex: "date",
        width: 260,
        render: (date: string, row) => (
            <span className="admin-traffic-daily-date">
                {date}
                {row.coverageUnknown ? <span className="admin-traffic-section-pill">历史覆盖未知</span> : null}
            </span>
        ),
    },
    { title: "PV 浏览量", dataIndex: "pageViews", align: "center", render: (value: number) => count.format(value) },
    { title: "UV 访客", dataIndex: "visitors", align: "center", render: (value: number) => count.format(value) },
    { title: "访问次数", dataIndex: "visits", align: "center", render: (value: number) => count.format(value) },
    { title: "关键操作", dataIndex: "actions", align: "center", render: (value: number) => count.format(value) },
];

export default function TrafficPage() {
    const queryClient = useQueryClient();
    const [range, setRange] = useState<TrafficDateRange>(() => trafficPresetRange(7));
    const [draft, setDraft] = useState<TrafficDateRange>(range);
    const [preset, setPreset] = useState<7 | 30 | 60 | undefined>(7);
    const [inputError, setInputError] = useState("");
    const [sourcePage, setSourcePage] = useState("all");
    const [pageSort, setPageSort] = useState<"pv" | "engagement">("pv");
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [visible, setVisible] = useState(() => !document.hidden);
    const [dailyPage, setDailyPage] = useState(1);
    const [dailyPageSize, setDailyPageSize] = useState(10);
    const bounds = trafficDateBounds();
    const appliedRangeError = trafficRangeError(range);
    const rangeError = inputError || appliedRangeError;
    const query = useQuery({
        queryKey: ["admin", "site-traffic", range.from, range.to],
        queryFn: ({ signal }) => getSiteTrafficOverview(range, { signal }),
        enabled: !appliedRangeError && visible,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const todayQuery = useQuery({
        queryKey: todayQueryKey,
        queryFn: ({ signal }) => getSiteTrafficToday({ signal }),
        enabled: visible,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    useEffect(() => {
        const handleVisibility = () => {
            setVisible(!document.hidden);
            if (document.hidden) void queryClient.cancelQueries({ queryKey: ["admin", "site-traffic"] });
        };
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, [queryClient]);

    // 统一开关只建一个计时器；两个查询各自单飞，近期卡不额外触发范围排行计算。
    useEffect(() => {
        if (!autoRefresh || !visible) return;
        const timer = window.setInterval(() => {
            if (document.hidden) return;
            if (!rangeError && !queryClient.isFetching({ queryKey: ["admin", "site-traffic", range.from, range.to], exact: true })) void query.refetch({ cancelRefetch: false });
            if (!queryClient.isFetching({ queryKey: todayQueryKey, exact: true })) void todayQuery.refetch({ cancelRefetch: false });
        }, 15_000);
        return () => window.clearInterval(timer);
    }, [autoRefresh, visible, rangeError, range.from, range.to, query.refetch, todayQuery.refetch, queryClient]);

    const loading = !rangeError && query.isPending;
    // 后台读取保留成功快照；刷新失败则清空，不能让旧快照冒充本次成功。
    const data = !rangeError && query.isSuccess ? query.data : undefined;
    const todayData = todayQuery.isSuccess ? todayQuery.data : undefined;
    const updating = Boolean(data) && query.isFetching;
    const todayUpdating = Boolean(todayData) && todayQuery.isFetching;
    const unavailableValue = rangeError ? "未查询" : loading ? "读取中…" : "不可用";
    const todayValue = todayQuery.isPending ? "读取中…" : "不可用";
    const draftChanged = draft.from !== range.from || draft.to !== range.to;

    // 只将白名单文案投影给表格、行键和来源筛选，未知响应键不进入 DOM。
    const pagesByKey = new Map((data?.pages ?? []).map((row) => [row.page, row]));
    const engagementByPage = new Map((data?.insights.pageEngagement ?? []).map((row) => [row.page, row]));
    // 两条独立聚合按固定页面键合并；缺一侧是待同步，不强迫其分母等于 KPI 或页面会话。
    const sortedPages = [...new Set([...pagesByKey.keys(), ...engagementByPage.keys()])]
        .map((key) => {
            const row = pagesByKey.get(key);
            return { key, page: safeLabel(siteTrafficPageLabels, key, "未登记页面"), pageViews: row?.pageViews ?? null, visitors: row?.visitors ?? null, visits: row?.visits ?? null, engagement: engagementByPage.get(key) };
        })
        .sort((a, b) => (pageSort === "engagement" ? (b.engagement?.rate ?? -1) - (a.engagement?.rate ?? -1) || (b.pageViews ?? -1) - (a.pageViews ?? -1) : (b.pageViews ?? -1) - (a.pageViews ?? -1)));
    const maxPageViews = sortedPages.reduce((max, row) => Math.max(max, row.pageViews ?? 0), 0);
    const pageRows: PageRow[] = sortedPages.map((row, index) => ({
        ...row,
        rank: index + 1,
        share: maxPageViews > 0 && row.pageViews !== null ? (row.pageViews / maxPageViews) * 100 : 0,
    }));

    const rawActions = (data?.actions ?? [])
        .map((row) => ({
            ...row,
            page: safeLabel(siteTrafficPageLabels, row.page, "未登记页面"),
            action: safeLabel(siteTrafficActionLabels, row.action, "未登记操作"),
        }))
        .sort((a, b) => b.count - a.count);
    const sourceOptions = [...new Set(rawActions.map((row) => row.page))].map((page) => ({ value: page, label: page }));
    const visibleActions = sourcePage === "all" ? rawActions : rawActions.filter((row) => row.page === sourcePage);
    const maxActionCount = visibleActions.reduce((max, row) => Math.max(max, row.count), 0);
    const filteredActions: ActionRow[] = visibleActions.map((row, index) => ({
        ...row,
        key: index,
        rank: index + 1,
        share: maxActionCount > 0 ? (row.count / maxActionCount) * 100 : 0,
    }));
    const availableDay = data?.availableFrom ? trafficEventTime(data.availableFrom).slice(0, 10) : null;
    const dailyRows: DailyRow[] = (data?.trend ?? []).map((row) => ({
        ...row,
        coverageUnknown: Object.values({ visitors: row.visitors, pageViews: row.pageViews, visits: row.visits, actions: row.actions }).every((value) => value === 0) && (!availableDay || row.date < availableDay),
    }));
    const currentDailyPage = Math.min(dailyPage, Math.max(1, Math.ceil(dailyRows.length / dailyPageSize)));
    const emptyTitle = loading ? "正在读取统计…" : data ? "当前范围暂无采集记录" : rangeError ? "请先应用有效日期" : "统计数据不可用";
    const todayEmptyTitle = todayQuery.isPending ? "正在读取今日统计…" : "今日统计数据不可用";

    const kpiCards = [
        {
            metric: "visitors",
            accent: "indigo",
            label: "UV 访客",
            value: data ? count.format(data.kpi.visitors) : unavailableValue,
            pill: data ? (data.kpi.visitors > 0 ? `人均 ${ratio.format(data.kpi.pageViews / data.kpi.visitors)} PV` : "去重标识") : unavailableValue,
            detail: "范围内按浏览器去重，非人数",
            icon: <Users className="size-4" aria-hidden="true" />,
        },
        {
            metric: "pageViews",
            accent: "cyan",
            label: "PV 浏览量",
            value: data ? count.format(data.kpi.pageViews) : unavailableValue,
            pill: data ? `覆及 ${data.pages.length} 类页面` : unavailableValue,
            detail: "每次页面浏览，刷新也计入",
            icon: <Eye className="size-4" aria-hidden="true" />,
        },
        {
            metric: "visits",
            accent: "emerald",
            label: "访问次数",
            value: data ? count.format(data.kpi.visits) : unavailableValue,
            pill: data ? (data.kpi.visits > 0 ? `单次 ${ratio.format(data.kpi.pageViews / data.kpi.visits)} 页` : "30m 会话") : unavailableValue,
            detail: "会话按 30 分钟规则划分",
            icon: <Compass className="size-4" aria-hidden="true" />,
        },
        {
            metric: "actions",
            accent: "violet",
            label: "关键操作",
            value: data ? count.format(data.kpi.actions) : unavailableValue,
            pill: data ? (data.kpi.visits > 0 ? `场均 ${ratio.format(data.kpi.actions / data.kpi.visits)} 次` : "意图触发") : unavailableValue,
            detail: "操作点击，不代表生成成功",
            icon: <MousePointerClick className="size-4" aria-hidden="true" />,
        },
    ] as const;

    const applyPreset = (days: 7 | 30 | 60) => {
        const next = trafficPresetRange(days);
        setPreset(days);
        setDraft(next);
        setRange(next);
        setInputError("");
        setSourcePage("all");
        setDailyPage(1);
    };
    const applyDates = (event: FormEvent) => {
        event.preventDefault();
        const error = trafficRangeError(draft);
        setInputError(error);
        if (error) return;
        setPreset(undefined);
        setSourcePage("all");
        setDailyPage(1);
        if (draft.from === range.from && draft.to === range.to) void query.refetch({ cancelRefetch: false });
        else setRange({ ...draft });
    };
    const exportDisabled = !data || Boolean(trafficRangeError(draft));
    const exportSnapshot = (kind: TrafficCsvKind) => {
        // 点击即同步投影此成功快照；后台刷新可导旧快照，但错误态绝不绕过 data 读 query.data。
        const snapshot = data;
        if (!snapshot || trafficRangeError(draft)) throw new Error("请先读取有效日期范围的统计");
        return new Blob([createTrafficCsv(snapshot, kind, sourcePage)], { type: "text/csv;charset=utf-8" });
    };
    const refreshToday = () => {
        if (!todayQuery.isFetching) void todayQuery.refetch({ cancelRefetch: false });
    };
    const refresh = () => {
        const error = trafficRangeError(range);
        setInputError(error);
        if (!error && !query.isFetching) void query.refetch({ cancelRefetch: false });
        refreshToday();
    };

    return (
        <AdminPageFrame title="访问统计" description="独立统计站点访问与关键操作，不与运行总览的生成任务混算。" scroll>
            <div className="admin-traffic-page" aria-busy={loading}>
                <section className="admin-traffic-control-deck" aria-label="时间范围与筛选控制">
                    <ListToolbar
                        className="admin-traffic-toolbar"
                        trailing={
                            <div className="admin-traffic-toolbar-actions">
                                <button type="button" className="admin-traffic-live-toggle" aria-pressed={autoRefresh} onClick={() => setAutoRefresh((value) => !value)}>
                                    <span className="admin-traffic-live-dot" data-active={autoRefresh} aria-hidden="true" />
                                    <Activity className="size-3.5" aria-hidden="true" />
                                    <span>{autoRefresh ? "动态刷新中 · 15s" : "动态刷新"}</span>
                                </button>
                                <Button className="admin-traffic-refresh-btn" icon={<RefreshCw className="size-4" aria-hidden="true" />} loading={query.isFetching || todayQuery.isFetching} disabled={Boolean(rangeError)} onClick={refresh}>
                                    刷新
                                </Button>
                                <div className="admin-traffic-export-actions" role="group" aria-label="导出当前成功快照 CSV">
                                    {(
                                        [
                                            { kind: "daily", label: "每日明细 CSV" },
                                            { kind: "pages", label: "页面排行 CSV" },
                                            { kind: "actions", label: "功能排行 CSV" },
                                        ] as const
                                    ).map(({ kind, label }) => (
                                        <AdminExportButton
                                            key={kind}
                                            size="small"
                                            label={label}
                                            disabled={exportDisabled}
                                            title={kind === "actions" ? "应用日期与当前来源筛选；导出全部匹配功能" : "仅应用日期范围；不受来源筛选和明细分页影响"}
                                            exportFile={() => exportSnapshot(kind)}
                                            fileName={data ? trafficCsvFileName(data, kind) : `traffic-${kind}.csv`}
                                        />
                                    ))}
                                </div>
                            </div>
                        }
                    >
                        <div className="admin-traffic-toggle-group" role="group" aria-label="快捷日期范围">
                            {([7, 30, 60] as const).map((days) => (
                                <button key={days} type="button" aria-pressed={preset === days} onClick={() => applyPreset(days)}>
                                    {days} 天
                                </button>
                            ))}
                        </div>
                        <form className="admin-traffic-dates" noValidate onSubmit={applyDates}>
                            <span className="admin-traffic-custom-label">
                                <CalendarDays className="size-4" aria-hidden="true" />
                                自定义区间
                            </span>
                            <div className="admin-traffic-date-inputs">
                                <Input
                                    type="date"
                                    aria-label="访问统计开始日期"
                                    aria-describedby="admin-traffic-range-note"
                                    aria-invalid={Boolean(inputError)}
                                    value={draft.from}
                                    min={bounds.earliest}
                                    max={bounds.today}
                                    onChange={(event) => {
                                        setDraft((value) => ({ ...value, from: event.target.value }));
                                        setPreset(undefined);
                                        setInputError("");
                                    }}
                                />
                                <span className="admin-traffic-date-separator" aria-hidden="true">
                                    至
                                </span>
                                <Input
                                    type="date"
                                    aria-label="访问统计结束日期"
                                    aria-describedby="admin-traffic-range-note"
                                    aria-invalid={Boolean(inputError)}
                                    value={draft.to}
                                    min={bounds.earliest}
                                    max={bounds.today}
                                    onChange={(event) => {
                                        setDraft((value) => ({ ...value, to: event.target.value }));
                                        setPreset(undefined);
                                        setInputError("");
                                    }}
                                />
                            </div>
                            <Button htmlType="submit" className="admin-traffic-apply-btn">
                                应用日期
                            </Button>
                        </form>
                    </ListToolbar>
                    <div className="admin-traffic-range-note" id="admin-traffic-range-note" aria-live="polite">
                        <div className="admin-traffic-note-chips">
                            <span className="admin-traffic-meta-pill" data-tone="primary">
                                <span className="admin-traffic-status-dot" aria-hidden="true" />
                                统计范围：{range.from} 至 {range.to} · 上海时间（Asia/Shanghai）
                            </span>
                            {draftChanged ? (
                                <span className="admin-traffic-meta-pill" data-tone="warning">
                                    自定义日期尚未应用
                                </span>
                            ) : null}
                            {updating ? (
                                <span className="admin-traffic-meta-pill" role="status">
                                    范围统计更新中…
                                </span>
                            ) : null}
                        </div>
                        <div className="admin-traffic-note-chips">
                            <span className="admin-traffic-meta-pill">
                                <Clock className="size-3.5" aria-hidden="true" />
                                最早保留事件：{data ? trafficEventTime(data.availableFrom) : loading ? "读取中…" : "不可用"}
                            </span>
                            <span className="admin-traffic-meta-pill">
                                <ShieldCheck className="size-3.5" aria-hidden="true" />
                                保留 365 天 · 仅采集上线后的事件
                            </span>
                        </div>
                        {data ? (
                            <span className="admin-traffic-status">
                                等时段比较：上期 {data.comparison.range.from} 至 {data.comparison.range.to}；含今日按已过去时长截取。范围截至 {trafficEventTime(data.effectiveTo)}。CSV 快照截至 {trafficEventTime(data.asOf)}
                                ，刷新中仍可导出；仅功能排行继承来源筛选，其他导出仅按应用日期。
                            </span>
                        ) : null}
                    </div>
                </section>

                {rangeError ? <Alert type="error" showIcon title="日期范围未应用" description={rangeError} /> : null}
                {!rangeError && query.isError ? (
                    <Alert
                        type="error"
                        showIcon
                        title="访问统计读取失败"
                        description={query.error instanceof Error ? query.error.message : "当前范围的数据不可用，请重试。"}
                        action={
                            <Button size="small" onClick={refresh}>
                                重试
                            </Button>
                        }
                    />
                ) : null}
                {loading ? (
                    <p className="admin-traffic-status" role="status">
                        正在读取当前范围的访问统计…
                    </p>
                ) : null}
                {data && Object.values(data.kpi).every((value) => value === 0) ? (
                    <p className="admin-traffic-status" role="status">
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        当前范围暂无采集事件，零值表示读取成功；上线前的数据不会补录。
                    </p>
                ) : null}

                <section className="admin-traffic-kpis" aria-label="访问统计指标">
                    {kpiCards.map((item) => {
                        const previous = data?.comparison.status === "ready" ? data.comparison.kpi[item.metric] : undefined;
                        const delta = data && previous !== undefined ? data.kpi[item.metric] - previous : undefined;
                        return (
                            <article key={item.label} className="admin-stat-tile admin-traffic-kpi-card" data-accent={item.accent}>
                                <div className="admin-traffic-kpi-top">
                                    <div className="admin-traffic-kpi-heading">
                                        <span className="admin-traffic-kpi-icon">{item.icon}</span>
                                        <span className="admin-stat-tile-label">{item.label}</span>
                                    </div>
                                    <span className="admin-traffic-kpi-pill">{item.pill}</span>
                                </div>
                                <div className="admin-stat-tile-value">{item.value}</div>
                                <div className="admin-traffic-kpi-footer">
                                    <span className="admin-stat-tile-detail">{item.detail}</span>
                                    <div className="admin-traffic-comparison" aria-label={`${item.label}等时段比较`}>
                                        {previous !== undefined && delta !== undefined ? (
                                            <>
                                                <span>上期 {count.format(previous)}</span>
                                                <span>
                                                    变化 {delta > 0 ? "+" : ""}
                                                    {count.format(delta)}
                                                </span>
                                                <span>{previous === 0 ? "上期为 0，不计算增长率" : `增长 ${delta > 0 ? "+" : ""}${ratio.format((delta / previous) * 100)}%`}</span>
                                            </>
                                        ) : (
                                            <span>{data ? (data.comparison.status === "outside_retention" ? "上期超出保留窗口，暂不可比" : "历史不足，暂不可比") : unavailableValue}</span>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </section>

                <TrafficOperations data={data?.insights.operations} loading={loading} unavailableValue={unavailableValue} partial={Boolean(data?.insights.featureTrend.some((point) => point.partial))} />

                <section className="admin-traffic-insights" aria-label="近期活跃与参与度">
                    <article className="admin-traffic-insight" aria-labelledby="admin-traffic-active-title" aria-busy={todayQuery.isFetching}>
                        <div className="admin-traffic-title-row">
                            <Activity className="size-4" aria-hidden="true" />
                            <h2 id="admin-traffic-active-title">近 5 分钟活跃访客</h2>
                            {todayUpdating ? <span role="status">更新中…</span> : null}
                        </div>
                        <strong className="admin-traffic-insight-value">{todayData ? count.format(todayData.active.visitors) : todayValue}</strong>
                        <p>PV / 关键操作的浏览器去重估算，非准确在线人数；窗口可跨午夜。</p>
                        <p>
                            服务器更新时间：{todayData ? trafficEventTime(todayData.asOf) : todayValue}
                            {todayData ? ` · 窗口 ${trafficEventTime(todayData.active.windowFrom)} 至 ${trafficEventTime(todayData.active.windowTo)}` : ""}
                        </p>
                        {todayQuery.isError ? (
                            <Alert
                                type="error"
                                showIcon
                                title="近期统计读取失败"
                                description={todayQuery.error instanceof Error ? todayQuery.error.message : "今日与近期统计不可用，请重试。"}
                                action={
                                    <Button size="small" onClick={refreshToday}>
                                        重试近期统计
                                    </Button>
                                }
                            />
                        ) : null}
                    </article>
                    <article className="admin-traffic-insight" aria-labelledby="admin-traffic-engagement-title">
                        <div className="admin-traffic-title-row">
                            <MousePointerClick className="size-4" aria-hidden="true" />
                            <h2 id="admin-traffic-engagement-title">关键操作参与度</h2>
                            {updating ? <span role="status">更新中…</span> : null}
                        </div>
                        <strong className="admin-traffic-insight-value">{data ? (data.engagement.rate === null ? "暂无访问会话" : `${ratio.format(data.engagement.rate * 100)}%`) : unavailableValue}</strong>
                        {data ? (
                            <p>
                                {count.format(data.engagement.engagedVisits)} / {count.format(data.engagement.visits)} 个访问会话发生关键操作
                            </p>
                        ) : null}
                        <p>所选范围内有 PV 的会话，与同期关键操作会话取交集；不随来源筛选，不代表生成成功。</p>
                    </article>
                </section>

                <section className="admin-traffic-depth" aria-labelledby="admin-traffic-depth-title">
                    <div className="admin-traffic-title-row">
                        <h2 id="admin-traffic-depth-title">访问深度</h2>
                        <span className="admin-traffic-section-pill">按单次会话 PV 分档</span>
                        <span>{data ? `分布内 ${count.format(data.insights.depth.visits)} 个访问会话` : unavailableValue}</span>
                    </div>
                    {data ? (
                        <>
                            <div className="admin-traffic-depth-bar" aria-hidden="true">
                                {(["1", "2-3", "4+"] as const).map((key) => {
                                    const bucket = data.insights.depth.buckets.find((item) => item.key === key);
                                    return <span key={key} data-bucket={key} style={{ width: `${(bucket?.rate ?? 0) * 100}%` }} />;
                                })}
                            </div>
                            <ul className="admin-traffic-depth-labels">
                                {(["1", "2-3", "4+"] as const).map((key) => {
                                    const bucket = data.insights.depth.buckets.find((item) => item.key === key);
                                    return (
                                        <li key={key} data-bucket={key}>
                                            <i aria-hidden="true" />
                                            <strong>{key === "2-3" ? "2–3" : key} PV</strong>
                                            <span>
                                                {bucket ? count.format(bucket.visits) : "待同步"} 个会话 · {bucket?.rate == null ? "无 PV 会话" : `${ratio.format(bucket.rate * 100)}%`}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    ) : null}
                    <p>同一会话在所选范围内的 PV 次数，不是独立页数或跳出率；比例使用本分布自己的会话分母，不强等上方 KPI。</p>
                </section>

                <TrafficTrendChart overview={data} today={todayData} emptyTitle={emptyTitle} todayEmptyTitle={todayEmptyTitle} updating={updating} todayUpdating={todayUpdating} />
                <TrafficHeatmap cells={data?.insights.heatmap} emptyTitle={emptyTitle} updating={updating} />

                <details className="admin-traffic-daily admin-traffic-methodology" aria-label="每日明细">
                    <summary>
                        <span className="admin-traffic-methodology-title">
                            <CalendarDays className="size-4" aria-hidden="true" />
                            每日明细
                        </span>
                        <span className="admin-traffic-methodology-hint">
                            {dailyRows.length} 天<ChevronDown className="size-4 admin-traffic-methodology-chevron" aria-hidden="true" />
                        </span>
                    </summary>
                    <p>复用当前范围日趋势，分页不重新请求。每日 UV、会话不能累计冒充范围总计；早于最早保留事件的零值标为历史覆盖未知，不证明当日确实没有访问；最早保留事件也不是准确启用时间。</p>
                    <AdminDataTable<DailyRow>
                        skeletonColumns={5}
                        table={{ rowKey: "date", size: "small", loading, columns: dailyColumns, dataSource: dailyRows.slice((currentDailyPage - 1) * dailyPageSize, currentDailyPage * dailyPageSize), pagination: false, scroll: { x: 640 } }}
                        footer={
                            <PaginationBar
                                current={currentDailyPage}
                                pageSize={dailyPageSize}
                                total={dailyRows.length}
                                pageSizeOptions={[10, 20, 50]}
                                itemLabel="天"
                                alwaysShow
                                onChange={(page, size) => {
                                    setDailyPage(page);
                                    setDailyPageSize(size);
                                }}
                            />
                        }
                        empty={<AdminEmpty title={emptyTitle} />}
                    />
                </details>

                <TrafficJourneys data={data?.insights.operations} loading={loading} unavailableValue={unavailableValue} partial={Boolean(data?.insights.featureTrend.some((point) => point.partial))} />

                <div className="admin-traffic-rankings">
                    <section className="admin-traffic-ranking" aria-labelledby="admin-traffic-pages-title">
                        <div className="admin-traffic-heading">
                            <div className="admin-traffic-heading-main flex-1">
                                <span className="admin-traffic-section-icon" data-accent="cyan">
                                    <Eye className="size-4" aria-hidden="true" />
                                </span>
                                <div>
                                    <div className="admin-traffic-title-row">
                                        <h2 id="admin-traffic-pages-title">热门页面</h2>
                                        {data ? <span className="admin-traffic-section-pill">共 {pageRows.length} 项</span> : null}
                                    </div>
                                    <p>PV / 参与度排序 · 参与度按同会话、同页面的 PV 与操作交集；N/A 是未支持采集，缺少聚合为待同步。</p>
                                </div>
                            </div>
                            <Select
                                aria-label="页面排行排序"
                                size="small"
                                className="w-32 max-w-full shrink-0 self-start"
                                value={pageSort}
                                disabled={!data}
                                onChange={setPageSort}
                                options={[
                                    { value: "pv", label: "按 PV 排序" },
                                    { value: "engagement", label: "按参与度排序" },
                                ]}
                            />
                        </div>
                        <div className="admin-traffic-table-wrap">
                            <AdminDataTable<PageRow> skeletonColumns={5} table={{ rowKey: "key", size: "small", loading, columns: pageColumns, dataSource: pageRows, pagination: false, scroll: { x: 740 } }} empty={<AdminEmpty title={emptyTitle} />} />
                        </div>
                    </section>

                    <section className="admin-traffic-ranking" aria-labelledby="admin-traffic-actions-title">
                        <div className="admin-traffic-heading">
                            <div className="admin-traffic-heading-main">
                                <span className="admin-traffic-section-icon" data-accent="violet">
                                    <MousePointerClick className="size-4" aria-hidden="true" />
                                </span>
                                <div>
                                    <div className="admin-traffic-title-row">
                                        <h2 id="admin-traffic-actions-title">功能排行</h2>
                                        {data ? <span className="admin-traffic-section-pill">共 {filteredActions.length} 项</span> : null}
                                    </div>
                                    <p>来源筛选仅作用于下表，不影响上方指标或趋势。</p>
                                </div>
                            </div>
                            <ListToolbar className="admin-traffic-source-toolbar">
                                <Select aria-label="功能排行来源页面" className="admin-traffic-source" value={sourcePage} disabled={!data} onChange={setSourcePage} options={[{ value: "all", label: "全部来源页面" }, ...sourceOptions]} />
                            </ListToolbar>
                        </div>
                        <div className="admin-traffic-table-wrap">
                            <AdminDataTable<ActionRow>
                                skeletonColumns={4}
                                table={{ rowKey: "key", size: "small", loading, columns: actionColumns, dataSource: filteredActions, pagination: false, scroll: { x: 560 } }}
                                empty={<AdminEmpty title={data && sourcePage !== "all" ? "该来源页面暂无关键操作" : emptyTitle} />}
                            />
                        </div>
                    </section>
                </div>

                <details className="admin-traffic-methodology">
                    <summary>
                        <span className="admin-traffic-methodology-title">
                            <span className="admin-traffic-section-icon" data-accent="amber">
                                <Info className="size-4" aria-hidden="true" />
                            </span>
                            <span>统计口径与采集范围说明</span>
                        </span>
                        <span className="admin-traffic-methodology-hint">
                            <span>8 项核心规则</span>
                            <ChevronDown className="size-4 admin-traffic-methodology-chevron" aria-hidden="true" />
                        </span>
                    </summary>
                    <ul className="admin-traffic-methodology-grid">
                        <li>
                            <strong>访客去重口径</strong>
                            <span>UV 按浏览器标识去重，不等于真实人数；区间 UV 由服务端独立去重，不相加每日 UV。</span>
                        </li>
                        <li>
                            <strong>浏览与会话划分</strong>
                            <span>页面加载与刷新均计入 PV；访问次数按 30 分钟无活动自动切分会话规则统计。</span>
                        </li>
                        <li>
                            <strong>关键操作边界</strong>
                            <span>关键操作记录入口或提交点击意图，不代表任务创建、模型生成或计费成功。</span>
                        </li>
                        <li>
                            <strong>页面登记与实际路由</strong>
                            <span>登记 13 类页面，当前实际路由覆盖 11 类；/ 与 /create 均计创作。灵感嵌于创作，电商流水线暂无独立路由。</span>
                        </li>
                        <li>
                            <strong>Agent 提交采集边界</strong>
                            <span>登记 7 项操作，当前采集其中 6 项；画布独立 Agent 提交当前无采集，入口点击与自动跳转不计该提交。</span>
                        </li>
                        <li>
                            <strong>365 天保留窗口</strong>
                            <span>仅保留最近 365 个上海自然日，数据从本功能上线后实际采集，不补录过去 365 天。</span>
                        </li>
                        <li>
                            <strong>隐私与覆盖说明</strong>
                            <span>DNT / GPC 隐私偏好会停报；无痕、多设备、屏蔽或断网会影响去重与覆盖，统计不保证完整。</span>
                        </li>
                        <li>
                            <strong>保留起点状态</strong>
                            <span>最早保留事件：{data ? trafficEventTime(data.availableFrom) : loading ? "读取中…" : "不可用"}。这不是准确启用时间。</span>
                        </li>
                    </ul>
                </details>
            </div>
        </AdminPageFrame>
    );
}
