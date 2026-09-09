import { App, Button, Progress, Skeleton, Switch } from "antd";
import { Activity, AlertTriangle, Cpu, Database, Gauge, HardDrive, MemoryStick, RefreshCw, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { clearRuntimeCache, getSystemPerformance, type SystemPerformance } from "@/services/api/system-performance";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

const refreshIntervalMs = 15_000;

function formatBytes(value?: number) {
    if (!value || value < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** index;
    return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds?: number) {
    if (!seconds) return "不足 1 分钟";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : ""].filter(Boolean).slice(0, 2).join(" ") || "不足 1 分钟";
}

function formatNumber(value?: number) {
    return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function metricTone(value: number) {
    if (value >= 90) return "exception" as const;
    if (value >= 75) return "active" as const;
    return "normal" as const;
}

function FactGrid({ children }: { children: ReactNode }) {
    return <dl className="admin-performance-facts">{children}</dl>;
}

function Fact({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
    return <><dt>{label}</dt><dd className={mono ? "admin-monospace" : undefined}>{value}</dd></>;
}

function PerformanceKpi({ icon, label, value, detail, percent }: { icon: ReactNode; label: string; value: string; detail: string; percent?: number }) {
    return (
        <article className="admin-performance-kpi">
            <div className="admin-performance-kpi-heading"><span>{icon}</span><p>{label}</p></div>
            <strong>{value}</strong>
            <p>{detail}</p>
            {percent !== undefined ? <Progress percent={Math.min(100, Math.max(0, percent))} status={metricTone(percent)} showInfo={false} size="small" /> : null}
        </article>
    );
}

export default function SystemPerformancePage() {
    const { message, modal } = App.useApp();
    const [data, setData] = useState<SystemPerformance | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [loadError, setLoadError] = useState("");
    const mountedRef = useRef(true);

    const load = useCallback(async (initial = false) => {
        if (initial) setLoading(true);
        else setRefreshing(true);
        try {
            const next = await getSystemPerformance();
            if (!mountedRef.current) return;
            setData(next);
            setLoadError("");
        } catch (error) {
            if (!mountedRef.current) return;
            setLoadError(error instanceof Error ? error.message : "读取系统性能失败");
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void load(true);
        return () => { mountedRef.current = false; };
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
                    <p><strong>不会删除</strong>用户、任务、素材、模型配置和数据库数据，也不会触碰正在使用的并发租约。</p>
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
        return <AdminPageFrame title="系统性能" description="服务器、数据库与运行时缓存状态。" scroll><div className="admin-settings-stack admin-system-performance"><Skeleton active paragraph={{ rows: 14 }} /></div></AdminPageFrame>;
    }

    const memoryPercent = data?.memory.systemAvailable ? data.memory.usagePercent : undefined;
    const databaseConnections = data?.database.postgres?.connections ?? data?.database.pool.openConnections ?? 0;
    const databaseLimit = data?.database.postgres?.maxConnections || data?.database.pool.maxOpenConnections || 0;
    const databasePercent = databaseLimit ? databaseConnections / databaseLimit * 100 : undefined;
    const redisPoolRequests = (data?.redis.pool.hits || 0) + (data?.redis.pool.misses || 0);
    const redisPoolHitRate = redisPoolRequests ? (data?.redis.pool.hits || 0) / redisPoolRequests * 100 : 0;

    return (
        <AdminPageFrame
            title="系统性能"
            description="紧凑查看主机、数据库、Redis 和安全运行时缓存；敏感连接信息不会在此展示。"
            scroll
            actions={<><label className="admin-performance-auto"><Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} /><span>15 秒刷新</span></label><Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false)}>刷新</Button></>}
        >
            <div className="admin-settings-stack admin-system-performance">
                {loadError ? <div className="admin-performance-alert"><AlertTriangle className="size-4" /><span>{loadError}</span><Button size="small" onClick={() => void load(false)}>重试</Button></div> : null}
                <div className="admin-performance-statusbar">
                    <div><AdminStatusBadge label={data?.status === "healthy" ? "系统运行正常" : "部分服务降级"} tone={data?.status === "healthy" ? "success" : "warning"} /><span>采集于 {data ? new Date(data.collectedAt).toLocaleString("zh-CN", { hour12: false }) : "--"}</span></div>
                    <span>进程已运行 {formatDuration(data?.host.uptimeSeconds)}</span>
                </div>

                <section className="admin-performance-kpis" aria-label="核心性能指标">
                    <PerformanceKpi icon={<MemoryStick className="size-4" />} label={memoryPercent !== undefined ? "系统内存" : "进程堆内存"} value={memoryPercent !== undefined ? `${memoryPercent.toFixed(1)}%` : formatBytes(data?.memory.heapAllocBytes)} detail={memoryPercent !== undefined ? `${formatBytes(data?.memory.usedBytes)} / ${formatBytes(data?.memory.totalBytes)}` : `Go 已保留 ${formatBytes(data?.memory.heapSysBytes)}`} percent={memoryPercent} />
                    <PerformanceKpi icon={<HardDrive className="size-4" />} label="数据磁盘" value={data?.disk.available ? `${data.disk.usagePercent.toFixed(1)}%` : "不可用"} detail={data?.disk.available ? `${formatBytes(data.disk.usedBytes)} / ${formatBytes(data.disk.totalBytes)}` : "无法读取文件系统指标"} percent={data?.disk.available ? data.disk.usagePercent : undefined} />
                    <PerformanceKpi icon={<Database className="size-4" />} label={data?.database.driver === "postgres" ? "PostgreSQL 连接" : "数据库连接"} value={`${databaseConnections}${databaseLimit ? ` / ${databaseLimit}` : ""}`} detail={`${data?.database.driver || "--"} · ${data?.database.latencyMs || 0} ms`} percent={databasePercent} />
                    <PerformanceKpi icon={<Wifi className="size-4" />} label="Redis" value={data?.redis.connected ? formatBytes(data.redis.usedMemoryBytes) : data?.redis.mode === "local" ? "本地模式" : "连接异常"} detail={data?.redis.connected ? `${formatNumber(data.redis.keys)} keys · ${formatNumber(data.redis.opsPerSecond)} ops/s` : data?.redis.statusMessage || "未连接"} />
                </section>

                <div className="admin-performance-grid">
                    <SettingsSectionCard layout="stacked" icon={<Server className="size-4" />} title="服务器与进程" description="操作系统、运行时和当前进程快照。" status={{ label: data?.disk.writable ? "数据目录可写" : "数据目录不可写", color: data?.disk.writable ? "success" : "error" }}>
                        <FactGrid>
                            <Fact label="主机" value={data?.host.hostname || "未识别"} mono />
                            <Fact label="系统" value={`${data?.host.os || "--"} / ${data?.host.arch || "--"}`} />
                            <Fact label="CPU" value={`${data?.host.cpuCores || 0} 逻辑核 · GOMAXPROCS ${data?.host.gomaxprocs || 0}`} />
                            <Fact label="负载 1/5/15" value={data?.host.loadAverageAvailable ? data.host.loadAverage.map((value) => value.toFixed(2)).join(" / ") : "当前平台未提供"} mono />
                            <Fact label="进程" value={`PID ${data?.host.processId || 0} · ${formatNumber(data?.host.goroutines)} goroutines`} />
                            <Fact label="任务" value={`${formatNumber(data?.host.activeWorkerTasks)} 个 Worker 正在执行`} />
                            <Fact label="构建" value={`${data?.build.version || "dev"} · ${data?.build.goVersion || "--"}`} />
                            <Fact label="提交" value={(data?.build.commit || "unknown").slice(0, 12)} mono />
                        </FactGrid>
                        <div className="admin-performance-submetrics">
                            <div><span>Heap Alloc</span><strong>{formatBytes(data?.memory.heapAllocBytes)}</strong></div>
                            <div><span>Go Sys</span><strong>{formatBytes(data?.memory.sysBytes)}</strong></div>
                            <div><span>Heap Objects</span><strong>{formatNumber(data?.memory.heapObjects)}</strong></div>
                            <div><span>GC 次数</span><strong>{formatNumber(data?.memory.gcCount)}</strong></div>
                        </div>
                    </SettingsSectionCard>

                    <div className="admin-performance-side-stack">
                        <SettingsSectionCard layout="stacked" icon={<Database className="size-4" />} title="数据库" description="连接池、结构版本与数据库内部统计。" status={{ label: data?.database.connected ? "连接正常" : "连接异常", color: data?.database.connected ? "success" : "error" }}>
                            <FactGrid>
                                <Fact label="驱动" value={data?.database.driver === "postgres" ? "PostgreSQL" : data?.database.driver || "未知"} />
                                <Fact label="结构版本" value={`${data?.database.schema.current || 0} / ${data?.database.schema.expected || 0} ${data?.database.schema.ready ? "（已就绪）" : "（待检查）"}`} />
                                <Fact label="数据库大小" value={formatBytes(data?.database.databaseBytes)} />
                                <Fact label="连接池" value={`${data?.database.pool.inUse || 0} 使用中 · ${data?.database.pool.idle || 0} 空闲 · ${data?.database.pool.waitCount || 0} 次等待`} />
                                {data?.database.postgres ? <><Fact label="版本" value={data.database.postgres.serverVersion || "未知"} mono /><Fact label="缓存命中" value={`${(data.database.postgres.cacheHitRate || 0).toFixed(2)}%`} /><Fact label="事务 / 回滚" value={`${formatNumber(data.database.postgres.transactions)} / ${formatNumber(data.database.postgres.rollbacks)}`} /><Fact label="临时文件 / 死锁" value={`${formatNumber(data.database.postgres.tempFiles)} / ${formatNumber(data.database.postgres.deadlocks)}`} /></> : <Fact label="PostgreSQL 指标" value="当前使用 SQLite，不适用" />}
                            </FactGrid>
                        </SettingsSectionCard>

                        <SettingsSectionCard layout="stacked" icon={<Activity className="size-4" />} title="Redis" description="内存、客户端、命中率与连接池。" status={{ label: data?.redis.connected ? "连接正常" : data?.redis.mode === "local" ? "本地降级" : "连接异常", color: data?.redis.connected ? "success" : data?.redis.mode === "local" ? "warning" : "error" }}>
                            <FactGrid>
                                <Fact label="模式 / 版本" value={data?.redis.connected ? `Redis ${data.redis.version || "未知"}` : data?.redis.statusMessage || "未配置"} />
                                <Fact label="运行时间" value={data?.redis.connected ? formatDuration(data.redis.uptimeSeconds) : "--"} />
                                <Fact label="内存峰值" value={data?.redis.connected ? formatBytes(data.redis.peakMemoryBytes) : "--"} />
                                <Fact label="淘汰策略" value={data?.redis.maxMemoryPolicy || "未配置"} mono />
                                <Fact label="客户端" value={`${formatNumber(data?.redis.clients)} 连接 · ${formatNumber(data?.redis.blockedClients)} 阻塞`} />
                                <Fact label="Key 命中率" value={`${(data?.redis.hitRate || 0).toFixed(2)}%`} />
                                <Fact label="客户端池命中" value={`${redisPoolHitRate.toFixed(2)}% · ${formatNumber(data?.redis.pool.totalConnections)} 连接`} />
                                <Fact label="超时 / 淘汰" value={`${formatNumber(data?.redis.pool.timeouts)} / ${formatNumber(data?.redis.evictedKeys)}`} />
                            </FactGrid>
                        </SettingsSectionCard>
                    </div>
                </div>

                <SettingsSectionCard layout="stacked" icon={<ShieldCheck className="size-4" />} title="缓存维护" description="只清理可安全重建的运行时状态，保留业务数据与活动并发租约。" status={<AdminStatusBadge label="白名单清理" tone="success" />} footer={<><span className="admin-performance-cache-note"><Gauge className="size-3.5" />清理后频控与线路健康状态会重新计算</span><Button danger icon={<Trash2 className="size-4" />} loading={clearing} onClick={requestClear}>清理运行时缓存</Button></>}>
                    <div className="admin-performance-cache-groups">
                        {(data?.redis.cacheGroups || []).map((group) => <div key={group.id}><span>{group.label}</span><strong>{formatNumber(group.keys)}</strong><small>keys</small></div>)}
                    </div>
                    <div className="admin-performance-safety"><strong>始终保留</strong><span>用户与任务数据</span><span>素材和模型配置</span><span>活动并发租约</span><span>跨实例目录版本</span></div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
