import { ChartNoAxesCombined, Eye, MousePointerClick } from "lucide-react";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { siteTrafficActionLabels } from "@/lib/site-traffic";
import type { SiteTrafficAction, SiteTrafficCounts, SiteTrafficHistoryStatus, SiteTrafficOverview, SiteTrafficToday } from "@/services/api/site-traffic";
import { AdminEmpty } from "../components/admin-ui";
import { trafficEventTime } from "./traffic-range";

type TrendPoint = { [Key in keyof SiteTrafficCounts]: number | null } & { date: string; partial?: boolean; historyStatus?: SiteTrafficHistoryStatus; features?: Record<SiteTrafficAction, number> | null };
type VisitSeriesKey = "pageViews" | "visitors" | "visits";
const count = new Intl.NumberFormat("zh-CN");
const visitSeriesConfig: ReadonlyArray<{
    key: VisitSeriesKey;
    label: string;
    seriesTone: "pv" | "uv" | "visits";
    color: string;
    width: number;
}> = [
    { key: "pageViews", label: "PV 浏览量", seriesTone: "pv", color: "var(--admin-perf-accent-indigo)", width: 2.5 },
    { key: "visitors", label: "UV 访客", seriesTone: "uv", color: "var(--admin-perf-accent-cyan)", width: 2.4 },
    { key: "visits", label: "会话", seriesTone: "visits", color: "var(--admin-perf-accent-amber)", width: 2.4 },
];

const featureSeriesConfig: ReadonlyArray<{ key: SiteTrafficAction; color: string; dash?: string }> = [
    { key: "open_create", color: "var(--admin-perf-accent-indigo)" },
    { key: "new_canvas", color: "var(--admin-perf-accent-cyan)" },
    { key: "open_ecommerce", color: "var(--admin-perf-accent-amber)" },
    { key: "creation_submit_text", color: "var(--admin-perf-accent-emerald)" },
    { key: "creation_submit_image", color: "var(--admin-perf-accent-violet)" },
    { key: "creation_submit_video", color: "var(--admin-perf-accent-cyan)", dash: "6 3" },
    { key: "creation_submit_agent", color: "var(--admin-perf-accent-indigo)", dash: "3 3" },
];
const coverageLabel = (status?: SiteTrafficHistoryStatus) => (status === "unknown" ? "历史覆盖未知" : status === "partial" ? "历史不足" : "保留范围内，不保证完整采集");
const displayCount = (value: number | null) => (value === null ? "历史覆盖未知" : count.format(value));

type DynamicTooltipEntry = {
    dataKey?: string | number;
    name?: string | number;
    value?: unknown;
    color?: string;
};

function TrafficTrendTooltip({ active, label, payload, trend, hourly, features }: { active?: boolean; label?: unknown; payload?: ReadonlyArray<DynamicTooltipEntry>; trend: ReadonlyArray<TrendPoint>; hourly: boolean; features: boolean }) {
    if (!active) return null;
    // 过滤纯视觉渐变 Area，仅展示真实折线序列；未知日点保留文字，不补零。
    const items = (payload ?? []).filter((entry) => typeof entry.name === "string" && entry.name.length > 0);
    const dateStr = typeof label === "string" ? label : "";
    const idx = trend.findIndex((point) => point.date === dateStr);
    if (!items.length && (!features || idx < 0)) return null;
    const prevPoint = idx > 0 ? trend[idx - 1] : undefined;
    const partial = trend[idx]?.partial;
    return (
        <div className="admin-traffic-tooltip">
            <div className="admin-traffic-tooltip-head">
                <span className="admin-traffic-tooltip-date">
                    {hourly ? "时段" : "日期"} · {dateStr}
                </span>
                <span className="admin-traffic-tooltip-tag">{partial ? "进行中" : hourly ? "上海小时" : "上海自然日"}</span>
            </div>
            {features ? (
                <p className="admin-traffic-status">
                    {coverageLabel(trend[idx]?.historyStatus)}
                    {trend[idx]?.features === null ? " · 数值不可用，不视作 0" : ""}
                </p>
            ) : null}
            <div className="admin-traffic-tooltip-rows">
                {items.map((item) => {
                    const key = String(item.dataKey) as keyof SiteTrafficCounts;
                    const featureKey = String(item.dataKey).replace(/^features\./, "") as SiteTrafficAction;
                    const val = typeof item.value === "number" ? item.value : undefined;
                    const previous = features ? prevPoint?.features?.[featureKey] : prevPoint?.[key];
                    const prevVal = typeof previous === "number" ? previous : undefined;
                    const delta = val !== undefined && prevVal !== undefined ? val - prevVal : undefined;
                    return (
                        <div key={String(item.dataKey)} className="admin-traffic-tooltip-row">
                            <span className="admin-traffic-tooltip-name">
                                <i style={{ backgroundColor: item.color }} />
                                {item.name}
                            </span>
                            <span className="admin-traffic-tooltip-values">
                                <strong>{val !== undefined ? count.format(val) : "不可用"}</strong>
                                {delta !== undefined && delta !== 0 ? (
                                    <em data-delta={delta > 0 ? "up" : "down"} title={hourly ? "较前一小时；当前小时尚未结束" : "较前一日"}>
                                        {delta > 0 ? `+${count.format(delta)}` : count.format(delta)}
                                    </em>
                                ) : null}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function TrafficTrendChart({
    overview,
    today,
    emptyTitle,
    todayEmptyTitle,
    updating,
    todayUpdating,
}: {
    overview?: SiteTrafficOverview;
    today?: SiteTrafficToday;
    emptyTitle: string;
    todayEmptyTitle: string;
    updating: boolean;
    todayUpdating: boolean;
}) {
    const gradPrefix = useId().replace(/:/g, "");
    const [granularity, setGranularity] = useState<"daily" | "hourly">("daily");
    const [trendView, setTrendView] = useState<"visits" | "actions" | "features">("visits");
    const [hiddenSeries, setHiddenSeries] = useState<Partial<Record<VisitSeriesKey, boolean>>>({});
    const [hiddenFeatures, setHiddenFeatures] = useState<Partial<Record<SiteTrafficAction, boolean>>>({});
    const [focusedSeries, setFocusedSeries] = useState<VisitSeriesKey | SiteTrafficAction | null>(null);
    const [hoveredDate, setHoveredDate] = useState<string | null>(null);
    const [reducedMotion, setReducedMotion] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false));
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const handleChange = () => setReducedMotion(media.matches);
        media.addEventListener?.("change", handleChange);
        return () => media.removeEventListener?.("change", handleChange);
    }, []);

    const features = trendView === "features";
    // 功能只支持范围日聚合；保留原访问/操作与日/小时两轴的选择，不造小时功能数据。
    const hourly = !features && granularity === "hourly";
    const hasData = hourly ? Boolean(today) : Boolean(overview);
    const trendPoints: TrendPoint[] = features
        ? (overview?.insights.featureTrend ?? []).map((point) => ({
              date: point.date,
              partial: point.partial,
              historyStatus: point.historyStatus,
              features: point.counts,
              pageViews: null,
              visitors: null,
              visits: null,
              actions: point.counts === null ? null : featureSeriesConfig.reduce((sum, series) => sum + point.counts![series.key], 0),
          }))
        : hourly
          ? (today?.hours ?? []).map((point) => ({ ...point, date: `${today!.date} ${String(point.hour).padStart(2, "0")}:00` }))
          : (overview?.trend ?? []);
    const trendTitle = features ? "功能使用日趋势" : trendView === "visits" ? "访问趋势" : "关键操作趋势";
    const activePeriods = trendPoints.filter((point) => (trendView === "visits" ? (point.pageViews ?? 0) > 0 || (point.visitors ?? 0) > 0 || (point.visits ?? 0) > 0 : (point.actions ?? 0) > 0)).length;
    const peakValue = trendPoints.reduce((max, point) => Math.max(max, (trendView === "visits" ? point.pageViews : point.actions) ?? 0), 0);
    const unknownPeriods = features ? trendPoints.filter((point) => point.features === null).length : 0;
    const hoveredPoint = hoveredDate ? trendPoints.find((point) => point.date === hoveredDate) : undefined;
    const spotlightPoint = hoveredPoint ?? trendPoints.at(-1);
    const chartAnimated = !reducedMotion;
    const gradientId = (tone: string) => `traffic-${tone}-${gradPrefix}`;
    const toggleVisitSeries = (key: VisitSeriesKey) => {
        setHiddenSeries((current) => {
            const next = { ...current, [key]: !current[key] };
            // 至少保留一条可见曲线，防止全部点灭导致空图。
            return visitSeriesConfig.every((item) => next[item.key]) ? current : next;
        });
    };

    const toggleFeatureSeries = (key: SiteTrafficAction) => {
        setHiddenFeatures((current) => {
            const next = { ...current, [key]: !current[key] };
            return featureSeriesConfig.every((item) => next[item.key]) ? current : next;
        });
    };

    return (
        <section className="admin-traffic-trend" aria-labelledby="admin-traffic-trend-title">
            <div className="admin-traffic-heading">
                <div className="admin-traffic-heading-main">
                    <span className="admin-traffic-section-icon" data-accent={trendView === "visits" ? "indigo" : "violet"}>
                        <ChartNoAxesCombined className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <div className="admin-traffic-title-row">
                            <h2 id="admin-traffic-trend-title">{trendTitle}</h2>
                            {hasData ? (
                                <span className="admin-traffic-section-pill">
                                    活跃 {activePeriods} {hourly ? "小时" : "天"} · {features ? "已知日操作合计" : hourly ? "小时" : "单日"}峰值 {features && unknownPeriods === trendPoints.length ? "不可用" : count.format(peakValue)}
                                    {features ? ` · 未知 ${unknownPeriods} 天` : ""}
                                </span>
                            ) : null}
                            {spotlightPoint ? (
                                <span className="admin-traffic-spotlight-pill" data-hovered={Boolean(hoveredPoint)}>
                                    <span className="admin-traffic-spotlight-dot" aria-hidden="true" />
                                    {hoveredPoint ? "焦点" : "最新"} {spotlightPoint.date.slice(hourly ? 11 : 5)}
                                    {spotlightPoint.partial ? " · 进行中" : ""}
                                    {trendView === "visits" ? (
                                        <>
                                            {" · "}PV <strong>{displayCount(spotlightPoint.pageViews)}</strong>
                                            {" · "}UV <strong>{displayCount(spotlightPoint.visitors)}</strong>
                                            {" · "}会话 <strong>{displayCount(spotlightPoint.visits)}</strong>
                                        </>
                                    ) : (
                                        <>
                                            {" · "}
                                            {features ? "七项合计" : "关键操作"} <strong>{displayCount(spotlightPoint.actions)}</strong>
                                            {features ? ` · ${coverageLabel(spotlightPoint.historyStatus)}` : ""}
                                        </>
                                    )}
                                </span>
                            ) : null}
                            {(hourly ? todayUpdating : updating) ? (
                                <span className="admin-traffic-section-pill" role="status">
                                    更新中…
                                </span>
                            ) : null}
                        </div>
                        <p>
                            {features
                                ? "所选范围的七项关键操作日趋势，不随来源筛选；点击图例显隐，未知日保留断点，历史不足不冒充完整采集。没有小时功能趋势。"
                                : hourly
                                  ? `服务器今日${today ? ` ${today.date}` : ""} · 当前小时进行中，未来小时不补零；不随日期或来源筛选。`
                                  : "上海自然日 · 每日 UV 独立去重，不能相加作为区间 UV；会话也不能逐日累加。点击图例可单独显隐曲线。"}
                        </p>
                        <p>
                            {hourly ? "今日" : "范围"}服务器更新时间：{(hourly ? today : overview) ? trafficEventTime((hourly ? today : overview)!.asOf) : "不可用"}
                        </p>
                    </div>
                </div>
                <div className="admin-traffic-trend-controls">
                    <div className="admin-traffic-toggle-group" role="group" aria-label="趋势时间粒度">
                        <button
                            type="button"
                            aria-pressed={!hourly}
                            onClick={() => {
                                setGranularity("daily");
                                setHoveredDate(null);
                            }}
                        >
                            范围日趋势
                        </button>
                        <button
                            type="button"
                            aria-pressed={hourly}
                            disabled={features}
                            title={features ? "功能趋势仅提供范围日聚合" : undefined}
                            onClick={() => {
                                setGranularity("hourly");
                                setHoveredDate(null);
                            }}
                        >
                            今日小时
                        </button>
                    </div>
                    <div className="admin-traffic-legend" role="group" aria-label="趋势图例筛选">
                        {features ? (
                            featureSeriesConfig.map((series) => (
                                <button
                                    key={series.key}
                                    type="button"
                                    className="admin-traffic-legend-btn"
                                    data-series={series.key}
                                    style={{ "--legend-color": series.color } as CSSProperties}
                                    data-muted={Boolean(hiddenFeatures[series.key])}
                                    aria-pressed={!hiddenFeatures[series.key]}
                                    onClick={() => toggleFeatureSeries(series.key)}
                                    onMouseEnter={() => setFocusedSeries(series.key)}
                                    onMouseLeave={() => setFocusedSeries(null)}
                                    onFocus={() => setFocusedSeries(series.key)}
                                    onBlur={() => setFocusedSeries(null)}
                                >
                                    <i aria-hidden="true" />
                                    <span>{siteTrafficActionLabels[series.key]}</span>
                                    {series.dash ? <span aria-hidden="true">┄</span> : null}
                                </button>
                            ))
                        ) : trendView === "visits" ? (
                            visitSeriesConfig.map((series) => (
                                <button
                                    key={series.key}
                                    type="button"
                                    className="admin-traffic-legend-btn"
                                    data-series={series.seriesTone}
                                    data-muted={Boolean(hiddenSeries[series.key])}
                                    aria-pressed={!hiddenSeries[series.key]}
                                    onClick={() => toggleVisitSeries(series.key)}
                                    onMouseEnter={() => setFocusedSeries(series.key)}
                                    onMouseLeave={() => setFocusedSeries(null)}
                                    onFocus={() => setFocusedSeries(series.key)}
                                    onBlur={() => setFocusedSeries(null)}
                                >
                                    <i aria-hidden="true" />
                                    <span>{series.label}</span>
                                </button>
                            ))
                        ) : (
                            <span className="admin-traffic-legend-btn" data-series="actions" data-static="true">
                                <i aria-hidden="true" />
                                <span>关键操作</span>
                            </span>
                        )}
                    </div>
                    <div className="admin-traffic-toggle-group" role="group" aria-label="趋势视图">
                        <button type="button" aria-pressed={trendView === "visits"} onClick={() => setTrendView("visits")}>
                            <Eye className="size-4" aria-hidden="true" />
                            访问
                        </button>
                        <button type="button" aria-pressed={trendView === "actions"} onClick={() => setTrendView("actions")}>
                            <MousePointerClick className="size-4" aria-hidden="true" />
                            关键操作
                        </button>
                        <button
                            type="button"
                            aria-pressed={features}
                            onClick={() => {
                                setTrendView("features");
                                setHoveredDate(null);
                            }}
                        >
                            <ChartNoAxesCombined className="size-4" aria-hidden="true" />
                            功能使用
                        </button>
                    </div>
                </div>
            </div>
            <div className="admin-traffic-chart" role="img" aria-label={`${trendTitle}${hourly ? "今日小时" : "每日"}折线图`}>
                {trendPoints.length ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <ComposedChart
                            data={trendPoints}
                            margin={{ top: 16, right: 22, bottom: 4, left: 0 }}
                            onMouseMove={(state: unknown) => {
                                const activeLabel = (state as { activeLabel?: unknown } | null)?.activeLabel;
                                if (typeof activeLabel === "string") setHoveredDate(activeLabel);
                            }}
                            onMouseLeave={() => setHoveredDate(null)}
                        >
                            <defs>
                                <linearGradient id={gradientId("pv")} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--admin-perf-accent-indigo)" stopOpacity={0.28} />
                                    <stop offset="55%" stopColor="var(--admin-perf-accent-indigo)" stopOpacity={0.09} />
                                    <stop offset="96%" stopColor="var(--admin-perf-accent-indigo)" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id={gradientId("uv")} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--admin-perf-accent-cyan)" stopOpacity={0.25} />
                                    <stop offset="55%" stopColor="var(--admin-perf-accent-cyan)" stopOpacity={0.08} />
                                    <stop offset="96%" stopColor="var(--admin-perf-accent-cyan)" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id={gradientId("visits")} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--admin-perf-accent-amber)" stopOpacity={0.24} />
                                    <stop offset="55%" stopColor="var(--admin-perf-accent-amber)" stopOpacity={0.07} />
                                    <stop offset="96%" stopColor="var(--admin-perf-accent-amber)" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id={gradientId("actions")} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--admin-perf-accent-violet)" stopOpacity={0.28} />
                                    <stop offset="55%" stopColor="var(--admin-perf-accent-violet)" stopOpacity={0.09} />
                                    <stop offset="96%" stopColor="var(--admin-perf-accent-violet)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke="var(--admin-perf-grid-line)" strokeDasharray="3 4" vertical={false} />
                            <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(hourly ? 11 : 5)} tick={{ fontSize: 12, fill: "var(--admin-text-muted)" }} stroke="var(--admin-divider)" tickLine={false} tickMargin={8} minTickGap={24} />
                            <YAxis allowDecimals={false} width={44} tick={{ fontSize: 12, fill: "var(--admin-text-muted)" }} axisLine={false} tickLine={false} />
                            <ChartTooltip
                                cursor={{ stroke: trendView === "visits" ? "var(--admin-perf-accent-indigo)" : "var(--admin-perf-accent-violet)", strokeWidth: 1.5, strokeDasharray: "4 4", strokeOpacity: 0.55 }}
                                filterNull={false}
                                content={<TrafficTrendTooltip trend={trendPoints} hourly={hourly} features={features} />}
                            />
                            {features ? (
                                featureSeriesConfig
                                    .filter((series) => !hiddenFeatures[series.key])
                                    .map((series) => (
                                        <Line
                                            key={series.key}
                                            type="monotone"
                                            dataKey={`features.${series.key}`}
                                            name={siteTrafficActionLabels[series.key]}
                                            stroke={series.color}
                                            strokeDasharray={series.dash}
                                            strokeWidth={focusedSeries === series.key ? 3.2 : 2.4}
                                            strokeOpacity={focusedSeries && focusedSeries !== series.key ? 0.3 : 1}
                                            dot={{ r: 3.5, stroke: "var(--admin-surface)", strokeWidth: 1.5, fill: series.color }}
                                            activeDot={{ r: 6, stroke: "var(--admin-surface)", strokeWidth: 2, fill: series.color }}
                                            connectNulls={false}
                                            isAnimationActive={chartAnimated}
                                            animationDuration={650}
                                            animationEasing="ease-out"
                                        />
                                    ))
                            ) : trendView === "visits" ? (
                                <>
                                    {visitSeriesConfig
                                        .filter((series) => !hiddenSeries[series.key])
                                        .map((series) => (
                                            <Area
                                                key={series.key}
                                                type="monotone"
                                                dataKey={(entry: TrendPoint) => entry[series.key]}
                                                name=""
                                                stroke="none"
                                                fill={`url(#${gradientId(series.seriesTone)})`}
                                                fillOpacity={focusedSeries && focusedSeries !== series.key ? 0.25 : 1}
                                                connectNulls={false}
                                                isAnimationActive={chartAnimated}
                                                animationDuration={650}
                                                animationEasing="ease-out"
                                                legendType="none"
                                                tooltipType="none"
                                            />
                                        ))}
                                    {visitSeriesConfig
                                        .filter((series) => !hiddenSeries[series.key])
                                        .map((series) => (
                                            <Line
                                                key={series.key}
                                                type="monotone"
                                                dataKey={series.key}
                                                name={series.label}
                                                stroke={series.color}
                                                strokeWidth={focusedSeries === series.key ? 3.2 : series.width}
                                                strokeOpacity={focusedSeries && focusedSeries !== series.key ? 0.3 : 1}
                                                dot={{ r: 3.5, stroke: "var(--admin-surface)", strokeWidth: 1.5, fill: series.color }}
                                                activeDot={{ r: 6, stroke: "var(--admin-surface)", strokeWidth: 2, fill: series.color }}
                                                connectNulls={false}
                                                isAnimationActive={chartAnimated}
                                                animationDuration={650}
                                                animationEasing="ease-out"
                                            />
                                        ))}
                                </>
                            ) : (
                                <>
                                    <Area
                                        type="monotone"
                                        dataKey={(entry: TrendPoint) => entry.actions}
                                        name=""
                                        stroke="none"
                                        fill={`url(#${gradientId("actions")})`}
                                        connectNulls={false}
                                        isAnimationActive={chartAnimated}
                                        animationDuration={650}
                                        animationEasing="ease-out"
                                        legendType="none"
                                        tooltipType="none"
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="actions"
                                        name="关键操作"
                                        stroke="var(--admin-perf-accent-violet)"
                                        strokeWidth={2.6}
                                        dot={{ r: 3.5, stroke: "var(--admin-surface)", strokeWidth: 1.5, fill: "var(--admin-perf-accent-violet)" }}
                                        activeDot={{ r: 6, stroke: "var(--admin-surface)", strokeWidth: 2, fill: "var(--admin-perf-accent-violet)" }}
                                        connectNulls={false}
                                        isAnimationActive={chartAnimated}
                                        animationDuration={650}
                                        animationEasing="ease-out"
                                    />
                                </>
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : (
                    <AdminEmpty title={hourly ? todayEmptyTitle : emptyTitle} description={hasData ? "仅展示实际上线后采集的趋势，不补造历史。" : hourly ? "今日统计读取成功后显示，不使用范围数据补零。" : "趋势将在当前范围读取成功后显示。"} />
                )}
            </div>
        </section>
    );
}
