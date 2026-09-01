import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, Select, Switch, Alert, Spin, Tag, Tooltip } from "antd";
import { Activity, AlertCircle, ArrowDownUp, CheckCircle2, Clock3, Cpu, Globe, HardDrive, Layers, RefreshCw, Server, Settings, Shield, ShieldCheck, TrendingUp, Zap } from "lucide-react";

import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { getESAOverview, getESASetting, getESASites, testESAConnection, updateESASetting, type ESAOverview, type ESASetting, type ESASettingRequest, type ESASiteInfo, type ESATimePoint } from "@/services/api/esa";
import { cn } from "@/lib/utils";

const TIME_RANGE_OPTIONS = [
    { label: "今天", value: "today" },
    { label: "昨天", value: "yesterday" },
    { label: "近7天", value: "7d" },
    { label: "近30天", value: "30d" },
];

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(val >= 100 || i === 0 ? 0 : val >= 10 ? 1 : 2)} ${units[i] || "TB"}`;
}

function formatRequests(num: number): string {
    if (!Number.isFinite(num) || num <= 0) return "0";
    if (num < 1000) return num.toString();
    if (num < 10000) return `${(num / 1000).toFixed(2)} 千`;
    if (num < 100000000) return `${(num / 10000).toFixed(2)} 万`;
    return `${(num / 100000000).toFixed(2)} 亿`;
}

function formatChartTime(timeStr: string, range: string): string {
    if (!timeStr) return "";
    const date = new Date(timeStr);
    if (!Number.isFinite(date.getTime())) return timeStr;
    const hours = String(date.getHours()).padStart(2, "0");
    const mins = String(date.getMinutes()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    if (range === "today" || range === "yesterday") {
        return `${hours}:${mins}`;
    }
    if (range === "7d") {
        return `${month}-${day} ${hours}:00`;
    }
    return `${month}-${day}`;
}

export default function ESAMonitoringPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [timeRange, setTimeRange] = useState<string>("today");
    const [selectedSite, setSelectedSite] = useState<string>("all");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [form] = Form.useForm<ESASettingRequest>();
    const [testLoading, setTestLoading] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // 读取 ESA 设置
    const settingQuery = useQuery({
        queryKey: ["admin", "esa", "settings"],
        queryFn: () => getESASetting(),
    });

    // 读取站点列表
    const sitesQuery = useQuery({
        queryKey: ["admin", "esa", "sites"],
        queryFn: () => getESASites(),
        enabled: Boolean(settingQuery.data?.setting?.hasAccessKeySecret),
    });

    // 读取监控概览数据，每 5 分钟自动轮询
    const overviewQuery = useQuery({
        queryKey: ["admin", "esa", "overview", timeRange, selectedSite],
        queryFn: () => getESAOverview(timeRange, selectedSite),
        refetchInterval: 5 * 60 * 1000,
    });

    const isConfigured = Boolean(settingQuery.data?.setting?.hasAccessKeySecret);
    const overview = overviewQuery.data;

    // 手动刷新
    const handleRefresh = async () => {
        try {
            const res = await getESAOverview(timeRange, selectedSite, true);
            await queryClient.invalidateQueries({ queryKey: ["admin", "esa", "overview", timeRange, selectedSite] });
            if (res.error) {
                message.warning("数据更新异常，已显示最后缓存或默认数据");
            } else {
                message.success("数据已刷新");
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "刷新失败");
        }
    };

    // 保存设置
    const saveMutation = useMutation({
        mutationFn: updateESASetting,
        onSuccess: (data) => {
            message.success("ESA 设置已保存");
            queryClient.setQueryData(["admin", "esa", "settings"], data);
            queryClient.invalidateQueries({ queryKey: ["admin", "esa"] });
            setSettingsOpen(false);
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "保存设置失败");
        },
    });

    const handleTest = async () => {
        const values = form.getFieldsValue();
        setTestLoading(true);
        setTestResult(null);
        try {
            const res = await testESAConnection(values);
            setTestResult({
                success: true,
                message: `连接成功，共找到 ${res.siteCount || 0} 个站点`,
            });
            message.success("阿里云 ESA 连接成功");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "连接失败";
            setTestResult({ success: false, message: msg });
            message.error(msg);
        } finally {
            setTestLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            saveMutation.mutate(values);
        } catch {
            // 校验失败
        }
    };

    const siteOptions = useMemo(() => {
        const list = sitesQuery.data?.sites || [];
        return [
            { label: "全部站点", value: "all" },
            ...list.map((s) => ({
                label: `${s.siteName} (${s.siteId})`,
                value: s.siteId,
            })),
        ];
    }, [sitesQuery.data?.sites]);

    const formatUpdateTime = (isoStr?: string) => {
        if (!isoStr) return "--";
        const d = new Date(isoStr);
        if (!Number.isFinite(d.getTime())) return isoStr;
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    };

    return (
        <AdminPageFrame
            title="ESA 监控"
            description="阿里云边缘安全加速流量、请求与站点分布"
            actions={
                <div className="flex flex-wrap items-center gap-2.5">
                    {/* 时间范围切换 */}
                    <div className="flex rounded-lg bg-muted/60 p-0.5 text-xs font-medium">
                        {TIME_RANGE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                className={cn("rounded-md px-3 py-1.5 transition-all", timeRange === opt.value ? "bg-background text-foreground shadow-sm font-semibold" : "text-foreground/60 hover:text-foreground")}
                                onClick={() => setTimeRange(opt.value)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* 站点筛选 */}
                    <Select className="w-48" size="middle" value={selectedSite} options={siteOptions} onChange={(val) => setSelectedSite(val)} placeholder="选择站点" />

                    {/* 刷新按钮 */}
                    <Button icon={<RefreshCw className={cn("size-3.5", overviewQuery.isFetching && "animate-spin")} />} onClick={handleRefresh} loading={overviewQuery.isFetching} title="刷新数据">
                        刷新
                    </Button>

                    {/* ESA 设置 */}
                    <Button
                        icon={<Settings className="size-3.5" />}
                        type={!isConfigured ? "primary" : "default"}
                        onClick={() => {
                            setTestResult(null);
                            if (settingQuery.data?.setting) {
                                form.setFieldsValue({
                                    enabled: settingQuery.data.setting.enabled,
                                    accessKeyId: settingQuery.data.setting.accessKeyId,
                                });
                            }
                            setSettingsOpen(true);
                        }}
                    >
                        ESA 设置
                    </Button>
                </div>
            }
        >
            <div className="space-y-5">
                {/* 错误或最后更新状态提示 */}
                {overview?.error ? <Alert type="warning" showIcon message={overview.error} description="请检查阿里云 RAM 权限是否授予了 esa:DescribeSiteTimeSeriesData 及 esa:DescribeSiteTopData 策略。" closable /> : null}

                {/* 未配置引导 */}
                {!isConfigured ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 p-12 text-center">
                        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-[var(--workspace-accent)]/10 text-[var(--workspace-accent)]">
                            <Activity className="size-7" />
                        </div>
                        <h3 className="text-base font-semibold text-foreground">尚未配置阿里云 ESA</h3>
                        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-foreground/60">配置拥有 ESA 只读权限的 AccessKey ID 与 AccessKey Secret 后，即可在此直接查看 ESA 响应流量、总请求数、防护处理与 Top 站点走势。</p>
                        <Button
                            type="primary"
                            icon={<Settings className="size-3.5" />}
                            className="mt-5"
                            onClick={() => {
                                form.setFieldsValue({ enabled: true });
                                setSettingsOpen(true);
                            }}
                        >
                            去配置 ESA 凭证
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* 状态信息行 */}
                        <div className="flex items-center justify-between text-xs text-foreground/50 px-1">
                            <div className="flex items-center gap-2">
                                <span className={cn("inline-block size-2 rounded-full", overview?.error ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
                                <span>{overview?.error ? "数据拉取异常（已展示当前缓存）" : "监控运行中（每 5 分钟自动更新）"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Clock3 className="size-3.5" />
                                <span>最后更新时间：{formatUpdateTime(overview?.updatedAt)}</span>
                            </div>
                        </div>

                        {/* 4 个核心指标卡片 */}
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <MetricCard
                                title="ESA 响应流量"
                                value={formatBytes(overview?.traffic ?? 0)}
                                subtitle="统计周期内总流出流量"
                                icon={<TrendingUp className="size-5 text-blue-500" />}
                                gradient="from-blue-500/10 to-indigo-500/5"
                                border="border-blue-500/20"
                            />
                            <MetricCard
                                title="总请求数"
                                value={formatRequests(overview?.requests ?? 0)}
                                subtitle="统计周期内边缘节点总命中请求"
                                icon={<Zap className="size-5 text-amber-500" />}
                                gradient="from-amber-500/10 to-orange-500/5"
                                border="border-amber-500/20"
                            />
                            <MetricCard
                                title="防护请求数"
                                value={formatRequests(overview?.securityRequests ?? 0)}
                                subtitle="WAF / DDoS / 限速防护拦截"
                                icon={<ShieldCheck className="size-5 text-emerald-500" />}
                                gradient="from-emerald-500/10 to-teal-500/5"
                                border="border-emerald-500/20"
                            />
                            <MetricCard
                                title="函数与 Pages 请求数"
                                value={formatRequests(overview?.pagesRequests ?? 0)}
                                subtitle="Edge Routine & Pages 边缘计算"
                                icon={<Cpu className="size-5 text-purple-500" />}
                                gradient="from-purple-500/10 to-pink-500/5"
                                border="border-purple-500/20"
                            />
                        </div>

                        {/* Top 5 站点 与 趋势图 */}
                        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                            {/* 响应流量 Top 5 站点 */}
                            <div className="flex flex-col rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
                                <div className="mb-3.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Globe className="size-4 text-blue-500" />
                                        <h4 className="text-sm font-semibold text-foreground">响应流量 Top 5 站点</h4>
                                    </div>
                                    <span className="text-[11px] text-foreground/40">降序</span>
                                </div>

                                {overview?.topSites && overview.topSites.length > 0 ? (
                                    <div className="space-y-3 flex-1 flex flex-col justify-around py-1">
                                        {overview.topSites.map((site, index) => {
                                            const maxTraffic = overview.topSites[0]?.traffic || 1;
                                            const percent = Math.min(100, Math.round((site.traffic / maxTraffic) * 100));
                                            return (
                                                <div key={site.siteId || index} className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <div className="flex items-center gap-1.5 truncate pr-2">
                                                            <span
                                                                className={cn(
                                                                    "grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                                                                    index === 0 ? "bg-amber-500 text-white" : index === 1 ? "bg-stone-400 text-white" : index === 2 ? "bg-amber-700/80 text-white" : "bg-muted text-foreground/60",
                                                                )}
                                                            >
                                                                {index + 1}
                                                            </span>
                                                            <span className="truncate font-medium text-foreground" title={site.siteName}>
                                                                {site.siteName}
                                                            </span>
                                                        </div>
                                                        <span className="font-mono text-xs font-semibold text-foreground/80 shrink-0">{formatBytes(site.traffic)}</span>
                                                    </div>
                                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300" style={{ width: `${Math.max(4, percent)}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-1 flex-col items-center justify-center py-8 text-center text-xs text-foreground/40">
                                        <Globe className="mb-2 size-6 opacity-30" />
                                        <span>暂无站点流量数据</span>
                                    </div>
                                )}
                            </div>

                            {/* 响应流量趋势图 */}
                            <div className="flex flex-col rounded-2xl border border-border/70 bg-background p-4 shadow-sm min-h-[320px]">
                                <div className="mb-3.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Activity className="size-4 text-emerald-500" />
                                        <h4 className="text-sm font-semibold text-foreground">响应流量趋势图</h4>
                                    </div>
                                    <span className="text-[11px] text-foreground/40">{TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label} · 流量走向</span>
                                </div>

                                <div className="flex-1 min-h-0">
                                    <ESATrafficChart timeseries={overview?.timeseries || []} range={timeRange} />
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* 配置抽屉 */}
            <Drawer
                title="阿里云 ESA 配置"
                placement="right"
                width={420}
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                footer={
                    <div className="flex items-center justify-between">
                        <Button loading={testLoading} onClick={handleTest}>
                            测试连接
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button onClick={() => setSettingsOpen(false)}>取消</Button>
                            <Button type="primary" loading={saveMutation.isPending} onClick={handleSave}>
                                保存配置
                            </Button>
                        </div>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="enabled" label="启用 ESA 监控" valuePropName="checked">
                        <Switch />
                    </Form.Item>

                    <Form.Item name="accessKeyId" label="AccessKey ID" rules={[{ required: true, message: "请输入 AccessKey ID" }]} extra="建议使用仅具备 ESA 只读权限的阿里云 RAM 用户 AccessKey。">
                        <Input placeholder="输入 RAM 用户的 AccessKey ID" />
                    </Form.Item>

                    <Form.Item
                        name="accessKeySecret"
                        label="AccessKey Secret"
                        extra={settingQuery.data?.setting?.hasAccessKeySecret ? "凭据已加密保存。如需更新请输入新的 Secret，留空则保持原配置不变。" : "输入对应的 AccessKey Secret，服务端将加密存储。"}
                    >
                        <Input.Password placeholder={settingQuery.data?.setting?.hasAccessKeySecret ? "已配置（输入新 Secret 覆盖）" : "输入 AccessKey Secret"} />
                    </Form.Item>

                    {testResult ? <Alert type={testResult.success ? "success" : "error"} showIcon icon={testResult.success ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />} message={testResult.message} className="mt-4" /> : null}

                    <div className="mt-6 rounded-xl bg-muted/40 p-3.5 text-xs text-foreground/60 space-y-1.5">
                        <div className="font-semibold text-foreground/80">RAM 权限要求：</div>
                        <div>插件仅用于只读监控，请确保 RAM 策略至少包含：</div>
                        <code className="block rounded bg-background p-1.5 font-mono text-[11px] text-foreground/80">
                            esa:DescribeSiteTimeSeriesData
                            <br />
                            esa:DescribeSiteTopData
                            <br />
                            esa:ListSites
                        </code>
                    </div>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function MetricCard({ title, value, subtitle, icon, gradient, border }: { title: string; value: string; subtitle: string; icon: React.ReactNode; gradient: string; border: string }) {
    return (
        <div className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-sm", gradient, border)}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/65">{title}</span>
                <div className="rounded-xl bg-background/80 p-2 shadow-xs">{icon}</div>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</div>
            <div className="mt-1 text-[11px] text-foreground/45">{subtitle}</div>
        </div>
    );
}

// ---------------- 纯 SVG 高性能响应式流量折线图 ----------------

function ESATrafficChart({ timeseries, range }: { timeseries: ESATimePoint[]; range: string }) {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    if (!timeseries || timeseries.length === 0) {
        return (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-xs text-foreground/40">
                <Activity className="mb-2 size-7 opacity-30" />
                <span>当前时间段无时间序列流量数据</span>
            </div>
        );
    }

    const maxTraffic = Math.max(...timeseries.map((d) => d.traffic), 1024);
    const width = 800;
    const height = 220;
    const padding = { top: 20, right: 30, bottom: 35, left: 60 };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const points = timeseries.map((d, index) => {
        const x = padding.left + (index / Math.max(timeseries.length - 1, 1)) * chartWidth;
        const y = padding.top + chartHeight - (d.traffic / maxTraffic) * chartHeight;
        return { x, y, data: d };
    });

    const pathD = points.reduce((acc, curr, idx) => `${acc} ${idx === 0 ? "M" : "L"} ${curr.x} ${curr.y}`, "");
    const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

    const yTicks = [
        { label: formatBytes(maxTraffic), y: padding.top },
        { label: formatBytes(maxTraffic / 2), y: padding.top + chartHeight / 2 },
        { label: "0 B", y: padding.top + chartHeight },
    ];

    // X 轴刻度选取 5 个代表点
    const xTickIndices = [0, Math.floor(timeseries.length * 0.25), Math.floor(timeseries.length * 0.5), Math.floor(timeseries.length * 0.75), timeseries.length - 1].filter((idx, pos, arr) => arr.indexOf(idx) === pos && idx < timeseries.length);

    const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

    return (
        <div className="relative size-full flex flex-col justify-center select-none">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="size-full overflow-visible"
                onMouseLeave={() => setHoverIndex(null)}
                onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
                    let closestIdx = 0;
                    let minDist = Infinity;
                    points.forEach((p, i) => {
                        const dist = Math.abs(p.x - mouseX);
                        if (dist < minDist) {
                            minDist = dist;
                            closestIdx = i;
                        }
                    });
                    setHoverIndex(closestIdx);
                }}
            >
                <defs>
                    <linearGradient id="esaTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                    </linearGradient>
                </defs>

                {/* Y 轴水平网格线与文字 */}
                {yTicks.map((tick, i) => (
                    <g key={i}>
                        <line x1={padding.left} y1={tick.y} x2={width - padding.right} y2={tick.y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
                        <text x={padding.left - 8} y={tick.y + 4} textAnchor="end" className="fill-foreground/40 text-[10px] font-mono">
                            {tick.label}
                        </text>
                    </g>
                ))}

                {/* 面积渐变与折线 */}
                <path d={areaD} fill="url(#esaTrafficGrad)" />
                <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                {/* X 轴刻度文字 */}
                {xTickIndices.map((idx) => {
                    const p = points[idx];
                    if (!p) return null;
                    return (
                        <text key={idx} x={p.x} y={height - 10} textAnchor={idx === 0 ? "start" : idx === timeseries.length - 1 ? "end" : "middle"} className="fill-foreground/45 text-[10px] font-mono">
                            {formatChartTime(p.data.time, range)}
                        </text>
                    );
                })}

                {/* 悬停准星线与焦点 */}
                {activePoint ? (
                    <g>
                        <line x1={activePoint.x} y1={padding.top} x2={activePoint.x} y2={padding.top + chartHeight} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="2 2" />
                        <circle cx={activePoint.x} cy={activePoint.y} r="5" fill="#3b82f6" stroke="#ffffff" strokeWidth="2" />
                    </g>
                ) : null}
            </svg>

            {/* 悬停浮动 Tooltip */}
            {activePoint ? (
                <div
                    className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl border border-border/80 bg-stone-900/90 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md dark:bg-stone-800/95"
                    style={{
                        left: `${(activePoint.x / width) * 100}%`,
                        top: `${Math.max(10, (activePoint.y / height) * 100 - 8)}%`,
                    }}
                >
                    <div className="font-mono text-[10px] text-white/60">{new Date(activePoint.data.time).toLocaleString("zh-CN", { hour12: false })}</div>
                    <div className="mt-1 flex items-center gap-2">
                        <span className="size-2 rounded-full bg-blue-400" />
                        <span className="font-medium text-white/80">响应流量：</span>
                        <span className="font-mono font-bold text-blue-300">{formatBytes(activePoint.data.traffic)}</span>
                    </div>
                    {activePoint.data.requests > 0 ? (
                        <div className="mt-0.5 flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-400" />
                            <span className="font-medium text-white/80">请求数：</span>
                            <span className="font-mono font-bold text-amber-300">{formatRequests(activePoint.data.requests)}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
