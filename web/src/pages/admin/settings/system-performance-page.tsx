import { App, Button, InputNumber, Progress, Skeleton, Switch } from "antd";
import { Activity, AlertTriangle, Cloud, Cpu, Database, Gauge, HardDrive, MemoryStick, Orbit, RefreshCw, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { clearRuntimeCache, getSystemPerformance, updateAgentSessionLimit, type RainyunPerformance, type SystemPerformance } from "@/services/api/system-performance";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { RainyunRealtimeChart } from "./rainyun-realtime-chart";

const refreshIntervalMs = 15_000;

function formatBytes(value?: number) {
    if (value === undefined || !Number.isFinite(value)) return "--";
    if (!value || value < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** index;
    return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds?: number) {
    if (seconds === undefined || !Number.isFinite(seconds)) return "--";
    if (!seconds) return "不足 1 分钟";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : ""].filter(Boolean).slice(0, 2).join(" ") || "不足 1 分钟";
}

function formatNumber(value?: number) {
    return value === undefined || !Number.isFinite(value) ? "--" : new Intl.NumberFormat("zh-CN").format(value);
}

function metricTone(value: number) {
    if (value >= 90) return "exception" as const;
    if (value >= 75) return "active" as const;
    return "normal" as const;
}

type PerfAccent = "indigo" | "cyan" | "emerald" | "violet" | "amber";

function FactGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <dl className={className ? `admin-performance-facts ${className}` : "admin-performance-facts"}>{children}</dl>;
}

// 保持 dt + dd 相邻兄弟结构，确保 rainyun-monitor 专项 fact() 查询无损兼容。
function Fact({ label, value, mono = false, wide = false, muted = false }: { label: string; value: ReactNode; mono?: boolean; wide?: boolean; muted?: boolean }) {
    return (
        <div className={`admin-performance-fact-tile${wide ? " is-wide" : ""}${muted ? " is-muted" : ""}`}>
            <dt>{label}</dt>
            <dd className={mono ? "admin-monospace" : undefined}>{value}</dd>
        </div>
    );
}

function PerformanceKpi({ icon, label, value, detail, percent, accent, badge }: { icon: ReactNode; label: string; value: string; detail: ReactNode; percent?: number; accent: PerfAccent; badge?: string }) {
    return (
        <article className="admin-performance-kpi" data-accent={accent}>
            <div className="admin-performance-kpi-top">
                <div className="admin-performance-kpi-heading">
                    <span className="admin-performance-kpi-icon">{icon}</span>
                    <p>{label}</p>
                </div>
                {badge ? <span className="admin-performance-kpi-pill">{badge}</span> : null}
            </div>
            <strong>{value}</strong>
            <div className="admin-performance-kpi-footer">
                <p>{detail}</p>
                {percent !== undefined ? (
                    <Progress aria-label={`${label}使用率`} percent={Math.min(100, Math.max(0, percent))} status={metricTone(percent)} strokeColor={percent >= 90 ? undefined : "var(--kpi-accent)"} showInfo={false} size="small" />
                ) : (
                    <span className="admin-performance-kpi-slot" aria-hidden="true" />
                )}
            </div>
        </article>
    );
}

function formatRainyunTime(value?: string) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "未知";
}

function validUsage(value?: number): value is number {
    return value !== undefined && Number.isFinite(value) && value >= 0;
}

function formatGiB(value?: number) {
    return validUsage(value) ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 1024 ** 3)} GiB` : "未知";
}

function RainyunQuota({ label, used, quota, accent }: { label: string; used?: number; quota?: number; accent: PerfAccent }) {
    const known = validUsage(used) && validUsage(quota);
    const percent = known && quota > 0 ? (used / quota) * 100 : undefined;
    return (
        <dl className="admin-performance-quota-card" data-accent={accent}>
            <dt>{label}</dt>
            <dd className="admin-performance-quota-body">
                <div className="admin-performance-quota-top">
                    <div className="admin-performance-quota-primary">
                        已用 {formatGiB(used)} / 套餐 {formatGiB(quota)}
                    </div>
                    {percent !== undefined ? <span className="admin-performance-quota-badge">{percent.toFixed(1)}%</span> : null}
                </div>
                <div className="admin-performance-quota-secondary">
                    套餐内剩余 {known ? formatGiB(Math.max(0, quota - used)) : "未知"}
                    {percent !== undefined ? ` · 使用率 ${percent.toFixed(1)}%` : ""}
                </div>
                {percent !== undefined ? <Progress aria-label={`${label}使用率`} percent={Math.min(100, percent)} status={metricTone(percent)} showInfo={false} size="small" /> : null}
            </dd>
        </dl>
    );
}

export function RainyunPerformanceCard({ data, stale = false, autoRefresh = false }: { data?: RainyunPerformance; stale?: boolean; autoRefresh?: boolean }) {
    const expiredSnapshot = stale || Boolean(data?.checkedAt && Date.now() - Date.parse(data.checkedAt) > 120_000);
    const expires = data?.expiresAt ? Date.parse(data.expiresAt) : NaN;
    const remainingMs = expires - Date.now();
    const expiryLabel = !Number.isFinite(expires) ? "到期时间未知" : remainingMs <= 0 ? "已过期" : `剩余 ${Math.ceil(remainingMs / 86_400_000)} 天`;
    const expiryTone = !Number.isFinite(expires) ? "neutral" : remainingMs <= 0 ? "error" : remainingMs <= 7 * 86_400_000 ? "warning" : "success";
    const statusLabels = { disabled: "监控未启用", unconfigured: "监控未配置", healthy: "监控正常", warning: "需要关注", error: "监控异常", unknown: "状态未知" };
    const status = data?.status || "unknown";
    return (
        <SettingsSectionCard
            layout="stacked"
            className="admin-performance-section-card admin-performance-rainyun-card"
            icon={<Cloud className="size-4" />}
            title="雨云 OSS"
            description="实例级空间、下载流量与套餐有效期，包含实例下全部存储桶；源站只读探测不代表上传或 CDN 全链路正常。"
            status={<AdminStatusBadge label={expiredSnapshot ? "快照已过期" : statusLabels[status]} tone={expiredSnapshot ? "warning" : status === "healthy" ? "success" : status === "error" ? "error" : status === "warning" ? "warning" : "neutral"} />}
            footer={
                <>
                    <span className="admin-performance-cache-note">套餐与用量缓存 60 秒 · 实时图表独立刷新 · 时间按浏览器本地时区显示</span>
                    <Link className="admin-performance-config-link" to="/admin/settings/storage#admin-rainyun-monitor">
                        配置雨云监控
                    </Link>
                </>
            }
        >
            <div className="admin-performance-card-body">
                <div className="admin-performance-quota-grid">
                    <RainyunQuota label="存储空间" used={data?.storageUsedBytes} quota={data?.storageQuotaBytes} accent="indigo" />
                    <RainyunQuota label="周期下载流量" used={data?.trafficUsedBytes} quota={data?.trafficQuotaBytes} accent="cyan" />
                </div>
                <FactGrid className="is-grid-3">
                    <Fact label="监控说明" value={data?.statusMessage || "雨云监控数据暂不可用"} />
                    <Fact label="实例 / 云端状态" value={`${data?.instanceId || "未配置"} · ${data?.cloudStatus || "未知"}`} />
                    <Fact label="当前套餐" value={data?.planName || "未知"} />
                    <Fact label="管理接口耗时" value={data?.latencyMs === undefined ? "未探测" : `${data.latencyMs} ms`} mono />
                    <Fact label="源站只读访问" value={`${data?.sourceMessage || "尚未探测"}${data?.sourceLatencyMs === undefined ? "" : ` · ${data.sourceLatencyMs} ms`}`} />
                    <Fact
                        label="套餐到期时间"
                        value={
                            <div className="flex flex-wrap items-center gap-2">
                                <span>{formatRainyunTime(data?.expiresAt)}</span>
                                <AdminStatusBadge label={expiryLabel} tone={expiryTone} />
                            </div>
                        }
                    />
                    <Fact label="流量统计周期" value={data?.periodStart && data.periodEnd ? `${formatRainyunTime(data.periodStart)} 至 ${formatRainyunTime(data.periodEnd)}` : "未知（以雨云实际重置周期为准）"} />
                    <Fact label="超额弹性计费" value={data?.extraAccounting === undefined ? "未知" : data.extraAccounting ? "已开启，套餐额度不是硬上限" : "未开启，超额可能停止访问"} />
                    <Fact label="最近采集" value={data?.checkedAt ? `${formatRainyunTime(data.checkedAt)}${expiredSnapshot ? "（已过期，非当前状态）" : "（60 秒缓存）"}` : "尚未采集"} />
                    {data?.statisticsMessage ? <Fact label="统计说明" value={data.statisticsMessage} wide /> : null}
                </FactGrid>
            </div>
            {data?.enabled && data.configured && data.instanceId ? <RainyunRealtimeChart key={data.instanceId} instanceId={data.instanceId} autoRefresh={autoRefresh} /> : null}
        </SettingsSectionCard>
    );
}

export default function SystemPerformancePage() {
    const { message, modal } = App.useApp();
    const [data, setData] = useState<SystemPerformance | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [savingAgentLimit, setSavingAgentLimit] = useState(false);
    const [agentLimitDraft, setAgentLimitDraft] = useState<number | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [loadError, setLoadError] = useState("");
    const mountedRef = useRef(true);
    const requestSequence = useRef(0);

    const load = useCallback(async (initial = false) => {
        const sequence = ++requestSequence.current;
        if (initial) setLoading(true);
        else setRefreshing(true);
        try {
            const next = await getSystemPerformance();
            if (!mountedRef.current || sequence !== requestSequence.current) return;
            setData(next);
            setLoadError("");
        } catch (error) {
            if (!mountedRef.current || sequence !== requestSequence.current) return;
            setLoadError(error instanceof Error ? error.message : "读取系统性能失败");
        } finally {
            if (mountedRef.current && sequence === requestSequence.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void load(true);
        return () => {
            mountedRef.current = false;
            requestSequence.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (!autoRefresh) return;
        const timer = window.setInterval(() => void load(false), refreshIntervalMs);
        return () => window.clearInterval(timer);
    }, [autoRefresh, load]);

    const requestClear = () => {
        modal.confirm({
            title: "清理运行时缓存？",
            width: 560,
            icon: <AlertTriangle className="size-5 text-warning" />,
            content: (
                <div className="admin-performance-confirm">
                    <p>将重置请求频控计数、渠道失败/熔断状态、线路临时禁用状态和本进程只读缓存。</p>
                    <p>
                        <strong>不会删除</strong>用户、任务、素材、模型配置和数据库数据，也不会触碰正在使用的并发租约。
                    </p>
                    <p>清理后短时间内上游线路会重新探测，请避开流量高峰频繁操作。</p>
                </div>
            ),
            okText: "确认清理",
            okButtonProps: { danger: true, loading: clearing },
            cancelText: "取消",
            onOk: async () => {
                setClearing(true);
                try {
                    const result = await clearRuntimeCache();
                    message.success(`已清理 ${result.deletedKeys} 个 Redis/本地键、${result.memoryEntries} 个内存缓存项`);
                    await load(false);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "清理运行时缓存失败");
                    throw error;
                } finally {
                    setClearing(false);
                }
            },
        });
    };

    if (loading) {
        return (
            <AdminPageFrame title="系统性能" description="服务器、数据库与运行时缓存状态。" scroll>
                <div className="admin-settings-stack admin-system-performance">
                    <Skeleton active paragraph={{ rows: 14 }} />
                </div>
            </AdminPageFrame>
        );
    }

    if (!data) {
        return (
            <AdminPageFrame title="系统性能" description="运行状态未知；尚未取得有效采集数据。" scroll>
                <div className="admin-performance-alert" role="alert">
                    <AlertTriangle className="size-4" />
                    <span>{loadError || "性能数据不可用"}</span>
                    <Button size="small" loading={refreshing} onClick={() => void load(false)}>
                        重试
                    </Button>
                </div>
            </AdminPageFrame>
        );
    }

    const cpu = data.host.cpu;
    const cpuPercent = cpu?.status === "ready" ? (cpu.usagePercent ?? undefined) : undefined;
    const memoryPercent = data?.memory.systemAvailable ? data.memory.usagePercent : undefined;
    const databaseConnections = data?.database.postgres?.connections ?? data?.database.pool.openConnections ?? 0;
    const databaseLimit = data?.database.postgres?.maxConnections || data?.database.pool.maxOpenConnections || 0;
    const databasePercent = databaseLimit ? (databaseConnections / databaseLimit) * 100 : undefined;
    const redisPoolRequests = (data?.redis.pool.hits || 0) + (data?.redis.pool.misses || 0);
    const redisPoolHitRate = redisPoolRequests ? ((data?.redis.pool.hits || 0) / redisPoolRequests) * 100 : 0;
    const systemHealthy = !loadError && data.status === "healthy";

    return (
        <AdminPageFrame
            title="系统性能"
            description="CPU 和内存来自后端所在运行环境，不是浏览器或单个 Go 进程的占用。"
            scroll
            actions={
                <>
                    <label className="admin-performance-auto">
                        <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                        <span>15 秒刷新</span>
                    </label>
                    <Button className="admin-performance-refresh-btn" icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false)}>
                        刷新
                    </Button>
                </>
            }
        >
            <div className="admin-settings-stack admin-system-performance">
                {loadError ? (
                    <div className="admin-performance-alert" role="alert">
                        <AlertTriangle className="size-4" />
                        <span>刷新失败，以下为上次采集的快照，非当前状态：{loadError}</span>
                        <Button size="small" onClick={() => void load(false)}>
                            重试
                        </Button>
                    </div>
                ) : null}

                <div className="admin-performance-statusbar admin-perf-stagger-1">
                    <div className="admin-performance-statusbar-main">
                        <span className={`admin-performance-live-dot ${loadError ? "is-warning" : systemHealthy ? "is-live" : "is-warning"}`} aria-hidden="true" />
                        <AdminStatusBadge label={loadError ? "快照已过期" : systemHealthy ? "系统运行正常" : "部分服务降级"} tone={loadError ? "warning" : systemHealthy ? "success" : "warning"} />
                        <span className="admin-performance-statusbar-time">采集于 {new Date(data.collectedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    </div>
                    <div className="admin-performance-statusbar-meta">
                        <span className="admin-performance-uptime-pill admin-monospace">{data.host.hostname || "未识别"}</span>
                        <span className="admin-performance-uptime-pill">
                            {data.host.os || "--"} / {data.host.arch || "--"}
                        </span>
                        <span className="admin-performance-uptime-pill" title={data.build.version || "dev"}>
                            {data.build.version || "dev"}
                        </span>
                        <span className="admin-performance-uptime-pill">进程已运行 {formatDuration(data?.host.uptimeSeconds)}</span>
                    </div>
                </div>

                <div className="admin-performance-kpi-matrix admin-perf-stagger-2">
                    <section className="admin-performance-kpis is-host" aria-label="服务器资源">
                        <PerformanceKpi
                            accent="cyan"
                            icon={<Cpu className="size-4" />}
                            label="服务器 CPU"
                            value={cpuPercent !== undefined ? `${cpuPercent.toFixed(1)}%` : cpu?.status === "sampling" ? "采样中" : "不可用"}
                            detail={
                                cpuPercent !== undefined ? (
                                    <>
                                        {data.host.cpuCores} 逻辑核 · {cpu.sampleSeconds.toFixed(1)} 秒区间平均
                                        <br />
                                        采样于 {cpu.sampledAt ? new Date(cpu.sampledAt).toLocaleTimeString("zh-CN", { hour12: false }) : "未知"}
                                    </>
                                ) : cpu?.status === "sampling" ? (
                                    "正在建立采样基线，下次刷新显示使用率"
                                ) : (
                                    "当前运行环境无法采集 CPU 使用率"
                                )
                            }
                            percent={cpuPercent}
                            badge="CPU"
                        />
                        <PerformanceKpi
                            accent="indigo"
                            icon={<MemoryStick className="size-4" />}
                            label="服务器内存"
                            value={memoryPercent !== undefined ? `${memoryPercent.toFixed(1)}%` : "不可用"}
                            detail={
                                memoryPercent !== undefined ? (
                                    <>
                                        已用 {formatBytes(data.memory.usedBytes)} / 总量 {formatBytes(data.memory.totalBytes)}
                                        <br />
                                        可用 {formatBytes(data.memory.availableBytes)}
                                    </>
                                ) : (
                                    "当前运行环境无法采集整机内存；Go 进程数据见下方"
                                )
                            }
                            percent={memoryPercent}
                            badge="RAM"
                        />
                    </section>

                    <section className="admin-performance-kpis" aria-label="核心性能指标">
                        <PerformanceKpi
                            accent="amber"
                            icon={<HardDrive className="size-4" />}
                            label="数据磁盘"
                            value={data?.disk.available ? `${data.disk.usagePercent.toFixed(1)}%` : "不可用"}
                            detail={data?.disk.available ? `${formatBytes(data.disk.usedBytes)} / ${formatBytes(data.disk.totalBytes)}` : "无法读取文件系统指标"}
                            percent={data?.disk.available ? data.disk.usagePercent : undefined}
                            badge={data?.disk.writable ? "可写" : "只读"}
                        />
                        <PerformanceKpi
                            accent="emerald"
                            icon={<Database className="size-4" />}
                            label={data?.database.driver === "postgres" ? "PostgreSQL 连接" : "数据库连接"}
                            value={`${databaseConnections}${databaseLimit ? ` / ${databaseLimit}` : ""}`}
                            detail={`${data?.database.driver || "--"} · ${data?.database.latencyMs || 0} ms`}
                            percent={databasePercent}
                            badge={databasePercent !== undefined ? `${databasePercent.toFixed(0)}%` : "Pool"}
                        />
                        <PerformanceKpi
                            accent="violet"
                            icon={<Wifi className="size-4" />}
                            label="Redis"
                            value={data?.redis.connected ? formatBytes(data.redis.usedMemoryBytes) : data?.redis.mode === "local" ? "本地模式" : "连接异常"}
                            detail={data?.redis.connected ? `${formatNumber(data.redis.keys)} keys · ${formatNumber(data.redis.opsPerSecond)} ops/s` : data?.redis.statusMessage || "未连接"}
                            badge={data?.redis.connected ? "在线" : data?.redis.mode === "local" ? "本地" : "异常"}
                        />
                    </section>
                </div>

                <div className="admin-performance-grid admin-perf-stagger-3">
                    <SettingsSectionCard
                        layout="stacked"
                        className="admin-performance-section-card admin-performance-host-card"
                        icon={<Server className="size-4" />}
                        title="服务器与进程"
                        description="后端所在运行环境的系统指标与独立 Go 进程快照。"
                        status={{ label: data?.disk.writable ? "数据目录可写" : "数据目录不可写", color: data?.disk.writable ? "success" : "error" }}
                    >
                        <div className="admin-performance-card-body is-flex">
                            <FactGrid className="is-grid-2">
                                <Fact label="主机" value={data?.host.hostname || "未识别"} mono />
                                <Fact label="系统" value={`${data?.host.os || "--"} / ${data?.host.arch || "--"}`} />
                                <Fact label="CPU 配置" value={`${data?.host.cpuCores || 0} 逻辑核 · GOMAXPROCS ${data?.host.gomaxprocs || 0}`} />
                                <Fact label="负载 1/5/15" value={data?.host.loadAverageAvailable ? data.host.loadAverage.map((value) => value.toFixed(2)).join(" / ") : "当前平台未提供"} mono muted={!data?.host.loadAverageAvailable} />
                                <Fact label="进程" value={`PID ${data?.host.processId || 0} · ${formatNumber(data?.host.goroutines)} goroutines`} />
                                <Fact label="任务" value={`${formatNumber(data?.host.activeWorkerTasks)} 个 Worker 正在执行`} />
                                <Fact label="构建" value={`${data?.build.version || "dev"} · ${data?.build.goVersion || "--"}`} />
                                <Fact label="提交" value={(data?.build.commit || "unknown").slice(0, 12)} mono />
                            </FactGrid>
                            <div className="admin-performance-submetrics">
                                <div>
                                    <span>Heap Alloc</span>
                                    <strong>{formatBytes(data?.memory.heapAllocBytes)}</strong>
                                </div>
                                <div>
                                    <span>Go Sys</span>
                                    <strong>{formatBytes(data?.memory.sysBytes)}</strong>
                                </div>
                                <div>
                                    <span>Heap Objects</span>
                                    <strong>{formatNumber(data?.memory.heapObjects)}</strong>
                                </div>
                                <div>
                                    <span>GC 次数</span>
                                    <strong>{formatNumber(data?.memory.gcCount)}</strong>
                                </div>
                            </div>
                        </div>
                    </SettingsSectionCard>

                    <div className="admin-performance-side-stack">
                        <SettingsSectionCard
                            layout="stacked"
                            className="admin-performance-section-card admin-performance-db-card"
                            icon={<Database className="size-4" />}
                            title="数据库"
                            description="连接池、结构版本与数据库内部统计。"
                            status={{ label: data?.database.connected ? "连接正常" : "连接异常", color: data?.database.connected ? "success" : "error" }}
                        >
                            <div className="admin-performance-card-body">
                                <FactGrid className="is-grid-2">
                                    <Fact label="驱动" value={data?.database.driver === "postgres" ? "PostgreSQL" : data?.database.driver || "未知"} />
                                    <Fact label="结构版本" value={`${data?.database.schema.current || 0} / ${data?.database.schema.expected || 0} ${data?.database.schema.ready ? "（已就绪）" : "（待检查）"}`} />
                                    <Fact label="数据库大小" value={formatBytes(data?.database.databaseBytes)} />
                                    <Fact label="连接池" value={`${data?.database.pool.inUse || 0} 使用中 · ${data?.database.pool.idle || 0} 空闲 · ${data?.database.pool.waitCount || 0} 次等待`} />
                                    {data?.database.postgres ? (
                                        <>
                                            <Fact label="版本" value={data.database.postgres.serverVersion || "未知"} mono />
                                            <Fact label="缓存命中" value={`${(data.database.postgres.cacheHitRate || 0).toFixed(2)}%`} />
                                            <Fact label="事务 / 回滚" value={`${formatNumber(data.database.postgres.transactions)} / ${formatNumber(data.database.postgres.rollbacks)}`} />
                                            <Fact label="临时文件 / 死锁" value={`${formatNumber(data.database.postgres.tempFiles)} / ${formatNumber(data.database.postgres.deadlocks)}`} />
                                        </>
                                    ) : (
                                        <Fact label="PostgreSQL 指标" value="当前使用 SQLite，不适用" wide muted />
                                    )}
                                </FactGrid>
                            </div>
                        </SettingsSectionCard>

                        <SettingsSectionCard
                            layout="stacked"
                            className="admin-performance-section-card admin-performance-redis-card"
                            icon={<Activity className="size-4" />}
                            title="Redis"
                            description="内存、客户端、命中率与连接池。"
                            status={{ label: data?.redis.connected ? "连接正常" : data?.redis.mode === "local" ? "本地降级" : "连接异常", color: data?.redis.connected ? "success" : data?.redis.mode === "local" ? "warning" : "error" }}
                        >
                            <div className="admin-performance-card-body">
                                {data.redis.connected ? (
                                    <FactGrid className="is-grid-2">
                                        <Fact label="模式 / 版本" value={`Redis ${data.redis.version || "未知"}`} />
                                        <Fact label="运行时间" value={formatDuration(data.redis.uptimeSeconds)} />
                                        <Fact label="内存峰值" value={formatBytes(data.redis.peakMemoryBytes)} />
                                        <Fact label="淘汰策略" value={data.redis.maxMemoryPolicy || "未配置"} mono />
                                        <Fact label="客户端" value={`${formatNumber(data.redis.clients)} 连接 · ${formatNumber(data.redis.blockedClients)} 阻塞`} />
                                        <Fact label="Key 命中率" value={`${(data.redis.hitRate || 0).toFixed(2)}%`} />
                                        <Fact label="客户端池命中" value={`${redisPoolHitRate.toFixed(2)}% · ${formatNumber(data.redis.pool.totalConnections)} 连接`} />
                                        <Fact label="超时 / 淘汰" value={`${formatNumber(data.redis.pool.timeouts)} / ${formatNumber(data.redis.evictedKeys)}`} />
                                    </FactGrid>
                                ) : (
                                    // 未连接时没有可信的 Redis 指标：本地模式只说明协调方式，连接异常单独标红，不混成"本地正常"。
                                    <div className={data.redis.mode === "local" ? "admin-performance-mode-note" : "admin-performance-mode-note is-error"}>
                                        <strong>{data.redis.mode === "local" ? "本地协调模式" : "Redis 连接异常"}</strong>
                                        <span>{data.redis.statusMessage || "未配置"}</span>
                                        <span>{data.redis.mode === "local" ? "内存、客户端与命中率指标在接入 Redis 后显示。" : "恢复连接后显示内存、客户端与命中率指标。"}</span>
                                    </div>
                                )}
                            </div>
                        </SettingsSectionCard>
                    </div>
                </div>

                <div className="admin-perf-stagger-4">
                    <RainyunPerformanceCard data={data.rainyun} stale={Boolean(loadError)} autoRefresh={autoRefresh} />
                </div>

                <div className="admin-performance-bottom-grid admin-perf-stagger-5">
                    {(data.agents || []).map((agent) => {
                        const draft = agentLimitDraft ?? agent.configuredLimit;
                        return (
                            <SettingsSectionCard
                                key={agent.id}
                                layout="stacked"
                                className="admin-performance-section-card admin-performance-bottom-card admin-performance-agent-card"
                                icon={<Orbit className="size-4" />}
                                title="画布 Agent 服务"
                                description="同时进行中的对话占用一个名额。审批等待不占用。降低上限不会中断已经开始的对话，也不会在这台机器上再启动容器。"
                                status={{ label: agent.healthy ? "服务可连接" : "服务不可达", color: agent.healthy ? "success" : "error" }}
                                footer={
                                    <>
                                        <span className="admin-performance-cache-note">
                                            <Gauge className="size-3.5" />
                                            新安装默认 30，一般不用再改
                                        </span>
                                        <span className="admin-performance-inline-actions">
                                            <InputNumber min={1} max={64} precision={0} value={draft} onChange={(value) => setAgentLimitDraft(typeof value === "number" ? value : draft)} />
                                            <Button
                                                type="primary"
                                                loading={savingAgentLimit}
                                                disabled={draft === agent.configuredLimit}
                                                onClick={() => {
                                                    setSavingAgentLimit(true);
                                                    void updateAgentSessionLimit(draft)
                                                        .then(() => {
                                                            message.success("已应用 Agent 同时对话上限");
                                                            setAgentLimitDraft(null);
                                                            return load(false);
                                                        })
                                                        .catch((error: unknown) => {
                                                            message.error(error instanceof Error ? error.message : "保存 Agent 上限失败");
                                                        })
                                                        .finally(() => setSavingAgentLimit(false));
                                                }}
                                            >
                                                保存上限
                                            </Button>
                                        </span>
                                    </>
                                }
                            >
                                <div className="admin-performance-card-body is-flex">
                                    <div className="admin-performance-agent-slots">
                                        <div className="admin-performance-slot-tile is-active">
                                            <span>进行中会话</span>
                                            <strong>{formatNumber(agent.active)}</strong>
                                            <small>上限 {formatNumber(agent.limit)}</small>
                                        </div>
                                        <div className="admin-performance-slot-tile">
                                            <span>等待队列</span>
                                            <strong>{formatNumber(agent.queued)}</strong>
                                            <small>排队请求</small>
                                        </div>
                                        <div className="admin-performance-slot-tile">
                                            <span>已保存上限</span>
                                            <strong>{formatNumber(agent.configuredLimit)}</strong>
                                            <small>{agent.mode === "remote" ? "独立服务" : "后端进程"}</small>
                                        </div>
                                    </div>
                                    <FactGrid className="is-grid-2">
                                        <Fact label="服务" value={agent.name} />
                                        <Fact label="运行位置" value={agent.mode === "remote" ? "独立服务" : "后端进程"} />
                                        <Fact label="地址" value={agent.endpoint} mono wide />
                                        <Fact label="说明" value={agent.statusMessage || "同一台机器提高上限即可，不需要再启动容器。"} wide />
                                    </FactGrid>
                                </div>
                            </SettingsSectionCard>
                        );
                    })}

                    <SettingsSectionCard
                        layout="stacked"
                        className="admin-performance-section-card admin-performance-bottom-card admin-performance-cache-card"
                        icon={<ShieldCheck className="size-4" />}
                        title="缓存维护"
                        description="只清理可安全重建的运行时状态，保留业务数据与活动并发租约。"
                        status={<AdminStatusBadge label="白名单清理" tone="success" />}
                        footer={
                            <>
                                <span className="admin-performance-cache-note">
                                    <Gauge className="size-3.5" />
                                    清理后频控与线路健康状态会重新计算
                                </span>
                                <Button danger icon={<Trash2 className="size-4" />} loading={clearing} onClick={requestClear}>
                                    清理运行时缓存
                                </Button>
                            </>
                        }
                    >
                        <div className="admin-performance-card-body is-flex">
                            <div className="admin-performance-cache-groups">
                                {(data?.redis.cacheGroups || []).map((group) => (
                                    <div key={group.id} className="admin-performance-cache-tile">
                                        <span>{group.label}</span>
                                        <div className="admin-performance-cache-count">
                                            <strong>{formatNumber(group.keys)}</strong>
                                            <small>keys</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="admin-performance-safety">
                                <strong>始终保留</strong>
                                <span>用户与任务数据</span>
                                <span>素材和模型配置</span>
                                <span>活动并发租约</span>
                                <span>跨实例目录版本</span>
                            </div>
                        </div>
                    </SettingsSectionCard>
                </div>
            </div>
        </AdminPageFrame>
    );
}
