import { useEffect, useId, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getRainyunRealtime, type RainyunRealtime } from "@/services/api/system-performance";
import { AdminStatusBadge } from "../components/admin-ui";

const windowMs = 5 * 60_000;

function formatRate(value?: number) {
    if (value === undefined || !Number.isFinite(value) || value < 0) return "未知";
    const unit = value >= 1024 ** 2 ? 1024 ** 2 : value >= 1024 ? 1024 : 1;
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / unit)} ${unit === 1 ? "B/s" : unit === 1024 ? "KiB/s" : "MiB/s"}`;
}

function formatRequests(value?: number) {
    return value === undefined || !Number.isFinite(value) || value < 0 ? "未知" : new Intl.NumberFormat("zh-CN").format(value);
}

function formatTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

type RealtimeTooltipEntry = {
    dataKey?: string | number;
    name?: string | number;
    value?: unknown;
    color?: string;
};

function RealtimeChartTooltip({ active, label, payload, formatValue }: { active?: boolean; label?: unknown; payload?: ReadonlyArray<RealtimeTooltipEntry>; formatValue: (value?: number) => string }) {
    if (!active || !payload?.length) return null;
    // 过滤掉纯视觉渐变填充层，避免 Tooltip 出现重复条目。
    const items = payload.filter((entry) => typeof entry.name === "string" && entry.name.length > 0 && !String(entry.dataKey).endsWith("__area"));
    if (!items.length) return null;
    const timestamp = Number(label);
    return (
        <div className="admin-performance-tooltip">
            <div className="admin-performance-tooltip-time">{Number.isFinite(timestamp) ? formatTime(timestamp) : ""}</div>
            <div className="admin-performance-tooltip-rows">
                {items.map((item) => (
                    <div key={String(item.dataKey)} className="admin-performance-tooltip-row">
                        <span className="admin-performance-tooltip-name">
                            <i style={{ backgroundColor: item.color }} />
                            {item.name}
                        </span>
                        <strong className="admin-monospace">{formatValue(typeof item.value === "number" ? item.value : undefined)}</strong>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function RainyunRealtimeChart({ instanceId, autoRefresh }: { instanceId: number; autoRefresh: boolean }) {
    const gradientPrefix = useId().replace(/:/g, "");
    const [data, setData] = useState<RainyunRealtime | null>(null);
    const [loadError, setLoadError] = useState("");
    const [now, setNow] = useState(Date.now);
    const [visible, setVisible] = useState(() => !document.hidden);

    useEffect(() => {
        setData(null);
        setLoadError("");
    }, [instanceId]);

    useEffect(() => {
        if (!autoRefresh) return;
        setVisible(!document.hidden);
        let disposed = false;
        let controller: AbortController | null = null;
        let nextLoadAt = 0;
        let failures = 0;
        const load = async () => {
            if (disposed || !autoRefresh || document.hidden || controller || Date.now() < nextLoadAt) return;
            const current = new AbortController();
            controller = current;
            const startedAt = Date.now();
            let delayMs = 1_000;
            try {
                const next = await getRainyunRealtime(current.signal);
                if (disposed || current.signal.aborted) return;
                setData(next);
                setLoadError("");
                failures = 0;
                delayMs = Math.max(1, Math.min(300, next.retryAfterSeconds || 1)) * 1_000;
            } catch (error) {
                if (disposed || current.signal.aborted) return;
                setLoadError(error instanceof Error ? error.message : "读取雨云实时监控失败");
                delayMs = Math.min(30, 2 ** ++failures) * 1_000;
            } finally {
                // 单飞且遵守服务端退避；每秒刷新界面不等于每秒必须向雨云回源。
                nextLoadAt = Math.max(startedAt + delayMs, Date.now());
                if (controller === current) controller = null;
            }
        };
        const tick = () => {
            if (document.hidden) return;
            setNow(Date.now());
            void load();
        };
        const visibilityChanged = () => {
            setVisible(!document.hidden);
            if (document.hidden) controller?.abort();
            else tick();
        };
        tick();
        const timer = window.setInterval(tick, 1_000);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            disposed = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", visibilityChanged);
            controller?.abort();
        };
    }, [autoRefresh, instanceId]);

    const points = (data?.points || [])
        .map((point) => ({
            timestamp: Date.parse(point.time),
            received: point.receivedBytesPerSecond ?? null,
            sent: point.sentBytesPerSecond ?? null,
            requests: point.requestsTotal ?? null,
        }))
        .filter((point) => Number.isFinite(point.timestamp) && point.timestamp >= now - windowMs && point.timestamp <= now);
    const latest = points.at(-1);
    const stale = Boolean(latest && now - latest.timestamp > Math.max(15_000, (data?.sampleIntervalSeconds || 0) * 2_000));
    const paused = !autoRefresh || !visible;
    const failed = Boolean(loadError || data?.status === "error");
    const stateLabel = paused ? "实时刷新已暂停" : failed ? "实时采集失败" : data?.status === "warning" ? "采集退避中" : stale ? "采样较旧" : latest ? "每秒刷新界面" : "等待真实采样";
    const cadence = data?.sampleIntervalSeconds;
    const inboundGradId = `perf-in-${gradientPrefix}`;
    const outboundGradId = `perf-out-${gradientPrefix}`;
    const requestsGradId = `perf-req-${gradientPrefix}`;

    return (
        <section className="admin-performance-realtime" aria-label="雨云实时流量与请求监控">
            <div className="admin-performance-realtime-header">
                <div className="admin-performance-realtime-title">
                    <div className="admin-performance-realtime-title-row">
                        <span className={`admin-performance-live-dot ${paused ? "is-paused" : failed ? "is-error" : stale ? "is-warning" : "is-live"}`} aria-hidden="true" />
                        <h3>实时流量与请求</h3>
                    </div>
                    <p className="admin-performance-cache-note admin-performance-realtime-meta">
                        实例 {data?.instanceId || instanceId} · 最近 5 分钟 · {latest ? `最新样本 ${formatTime(latest.timestamp)}，距今 ${Math.max(0, Math.floor((now - latest.timestamp) / 1_000))} 秒` : "尚无有效样本"}
                        {cadence !== undefined ? ` · 样本间隔约 ${cadence} 秒` : " · 云端采样间隔未知"}
                    </p>
                </div>
                <AdminStatusBadge label={stateLabel} tone={paused ? "neutral" : failed ? "error" : stale || data?.status === "warning" ? "warning" : latest && data?.status === "healthy" ? "success" : "neutral"} />
            </div>
            {loadError || data?.statusMessage ? (
                <p className="admin-performance-cache-note admin-performance-realtime-status" role={failed ? "alert" : undefined}>
                    {loadError || data?.statusMessage}
                </p>
            ) : null}
            <dl className="admin-performance-realtime-stats">
                <div className="admin-performance-stat-card" data-series="inbound">
                    <dt>入站流量（接收）</dt>
                    <dd className="admin-monospace">{formatRate(latest?.received ?? undefined)}</dd>
                </div>
                <div className="admin-performance-stat-card" data-series="outbound">
                    <dt>出站流量（发送）</dt>
                    <dd className="admin-monospace">{formatRate(latest?.sent ?? undefined)}</dd>
                </div>
                <div className="admin-performance-stat-card" data-series="requests">
                    <dt>请求总数（官方采样值）</dt>
                    <dd className="admin-monospace">{formatRequests(latest?.requests ?? undefined)}</dd>
                </div>
            </dl>
            <div className="admin-performance-realtime-charts">
                <div className="admin-performance-chart-panel" data-panel="traffic">
                    <div className="admin-performance-chart-head">
                        <div className="admin-performance-chart-heading">
                            <h4>收发流量趋势</h4>
                            <span>5 分钟实时速率包络</span>
                        </div>
                        <div className="admin-performance-chart-legend" aria-hidden="true">
                            <span className="is-inbound">
                                <i />
                                入站（接收）
                            </span>
                            <span className="is-outbound">
                                <i />
                                出站（发送）
                            </span>
                        </div>
                    </div>
                    <div className="admin-analytics-chart admin-performance-chart-canvas" role="img" aria-label="雨云收发流量实时折线图">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={points} margin={{ top: 12, right: 14, bottom: 2, left: -6 }}>
                                <defs>
                                    <linearGradient id={inboundGradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--admin-perf-accent-indigo)" stopOpacity={0.18} />
                                        <stop offset="92%" stopColor="var(--admin-perf-accent-indigo)" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id={outboundGradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--admin-perf-accent-cyan)" stopOpacity={0.22} />
                                        <stop offset="92%" stopColor="var(--admin-perf-accent-cyan)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="var(--admin-perf-grid-line)" strokeDasharray="3 4" vertical={false} />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    domain={[now - windowMs, now]}
                                    tickFormatter={formatTime}
                                    axisLine={false}
                                    tickLine={false}
                                    tickMargin={10}
                                    minTickGap={30}
                                    tick={{ fontSize: 11, fill: "var(--admin-text-muted)" }}
                                />
                                <YAxis width={64} tickFormatter={formatRate} axisLine={false} tickLine={false} tickMargin={8} tick={{ fontSize: 11, fill: "var(--admin-text-muted)" }} />
                                <Tooltip cursor={{ stroke: "var(--admin-perf-accent-cyan)", strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.55 }} content={<RealtimeChartTooltip formatValue={formatRate} />} />
                                <Legend wrapperStyle={{ display: "none" }} />
                                <Area
                                    type="monotone"
                                    dataKey={(entry: { received: number | null }) => entry.received}
                                    name=""
                                    stroke="none"
                                    fill={`url(#${inboundGradId})`}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                    legendType="none"
                                    tooltipType="none"
                                />
                                <Area type="monotone" dataKey={(entry: { sent: number | null }) => entry.sent} name="" stroke="none" fill={`url(#${outboundGradId})`} connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
                                <Line
                                    type="monotone"
                                    dataKey="received"
                                    name="入站（接收）"
                                    stroke="var(--admin-perf-accent-indigo)"
                                    strokeWidth={2.25}
                                    dot
                                    connectNulls={false}
                                    activeDot={{ r: 5.5, stroke: "var(--admin-surface)", strokeWidth: 2, fill: "var(--admin-perf-accent-indigo)" }}
                                    isAnimationActive={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="sent"
                                    name="出站（发送）"
                                    stroke="var(--admin-perf-accent-cyan)"
                                    strokeWidth={2.25}
                                    dot
                                    connectNulls={false}
                                    activeDot={{ r: 5.5, stroke: "var(--admin-surface)", strokeWidth: 2, fill: "var(--admin-perf-accent-cyan)" }}
                                    isAnimationActive={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="admin-performance-chart-panel" data-panel="requests">
                    <div className="admin-performance-chart-head">
                        <div className="admin-performance-chart-heading">
                            <h4>请求总数趋势</h4>
                            <span>官方时点采样值</span>
                        </div>
                        <div className="admin-performance-chart-legend" aria-hidden="true">
                            <span className="is-requests">
                                <i />
                                请求总数
                            </span>
                        </div>
                    </div>
                    <div className="admin-analytics-chart admin-performance-chart-canvas" role="img" aria-label="雨云请求总数实时折线图">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={points} margin={{ top: 12, right: 14, bottom: 2, left: -14 }}>
                                <defs>
                                    <linearGradient id={requestsGradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--admin-perf-accent-violet)" stopOpacity={0.2} />
                                        <stop offset="92%" stopColor="var(--admin-perf-accent-violet)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="var(--admin-perf-grid-line)" strokeDasharray="3 4" vertical={false} />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    domain={[now - windowMs, now]}
                                    tickFormatter={formatTime}
                                    axisLine={false}
                                    tickLine={false}
                                    tickMargin={10}
                                    minTickGap={30}
                                    tick={{ fontSize: 11, fill: "var(--admin-text-muted)" }}
                                />
                                <YAxis width={48} allowDecimals={false} tickFormatter={formatRequests} axisLine={false} tickLine={false} tickMargin={8} tick={{ fontSize: 11, fill: "var(--admin-text-muted)" }} />
                                <Tooltip cursor={{ stroke: "var(--admin-perf-accent-violet)", strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.55 }} content={<RealtimeChartTooltip formatValue={formatRequests} />} />
                                <Area
                                    type="monotone"
                                    dataKey={(entry: { requests: number | null }) => entry.requests}
                                    name=""
                                    stroke="none"
                                    fill={`url(#${requestsGradId})`}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                    legendType="none"
                                    tooltipType="none"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="requests"
                                    name="请求总数"
                                    stroke="var(--admin-perf-accent-violet)"
                                    strokeWidth={2.25}
                                    dot
                                    connectNulls={false}
                                    activeDot={{ r: 5.5, stroke: "var(--admin-surface)", strokeWidth: 2, fill: "var(--admin-perf-accent-violet)" }}
                                    isAnimationActive={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
            <p className="admin-performance-cache-note admin-performance-realtime-footnote">实例下全部桶的官方监控数据；流量沿用控制台速率展示口径，请求总数为各时点的云端指标，不对曲线求和。重复样本不新增点，缺失不补零；云端未更新时不模拟每秒变化。</p>
        </section>
    );
}
