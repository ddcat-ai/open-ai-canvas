import { Alert, App, Button, DatePicker, Segmented } from "antd";
import { IconButton } from "@/pages/admin/ui/controls";
import { AdminModal } from "@/pages/admin/ui/overlays";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { Download, Eye, Play, Search, RefreshCw } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { MediaPreview } from "@/components/media-preview";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { mediaDeliverySummary } from "@/lib/generation-task-display";
import { batchRecoverAdminApiLogs, exportAdminApiLogs, listAdminApiLogs, type ApiCallLog } from "@/services/api/auth";
import { ApiLogDetailDrawer } from "../components/api-log-detail-drawer";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminBatchBar, AdminDataTable, AdminExportButton, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { logBillingLabel, logStatus, normalizeLogView, videoRecoveryAvailable } from "./log-view";
import "./logs-page.css";
import { Select } from "@/components/ui/base/select";
import { AdminSearchInput } from "../components/admin-search-input";
import { useAdminContext } from "../admin-context";
import { useAdminUserOptions } from "../components/use-admin-user-options";

// 后端单次查询最多覆盖 366 天（含首尾），超出时服务端会静默截断，所以在界面上直接拒绝。
const MAX_RANGE_DAYS = 366;

export default function LogsPage() {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const view = normalizeLogView(searchParams.get("view"));
    const status = normalizeStatus(searchParams.get("status"));
    const recordType = searchParams.get("recordType") === "download" ? "download" : searchParams.get("recordType") === "all" ? "all" : "request";
    const capability = normalizeCapability(searchParams.get("capability"));
    const fromDay = normalizeDay(searchParams.get("from"));
    const toDay = normalizeDay(searchParams.get("to"));
    const userId = searchParams.get("userId") || "";
    const modelFilter = searchParams.get("model") || "";
    const channelId = searchParams.get("channelId") || "";
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const userOptions = useAdminUserOptions(userId || undefined);
    const channelOptions = useMemo(() => references.channels.map((channel) => ({ value: channel.id, label: channel.name })), [references.channels]);
    const modelOptions = useMemo(() => {
        const names = new Set<string>();
        references.channels.forEach((channel) => channel.models?.forEach((name) => names.add(name)));
        if (modelFilter) names.add(modelFilter);
        return [...names].sort().map((name) => ({ value: name, label: name }));
    }, [modelFilter, references.channels]);
    // 服务端按 UTC 自然日截取（含结束日）。未显式选择时不提交，由服务端取近 30 个 UTC 日，
    // 界面同时按 UTC 日历显示这个默认范围，保证看到的范围与实际查询一致。
    const defaultRange = useMemo(utcDefaultRange, []);
    const explicitRange = Boolean(fromDay && toDay);
    const rangeParams = explicitRange ? { from: fromDay, to: toDay } : {};
    const queryFilters = {
        recordType,
        capability: capability === "all" ? undefined : capability,
        keyword: debouncedKeyword || undefined,
        status: status === "all" ? undefined : status,
        userId: userId || undefined,
        model: modelFilter || undefined,
        channelId: channelId || undefined,
        ...rangeParams,
    } as const;
    const [logs, setLogs] = useState<ApiCallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [detailLogId, setDetailLogId] = useState<string | null>(null);
    const [batchRecovering, setBatchRecovering] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const requestSequence = useRef(0);
    const hasFilters = Boolean(keyword || status !== "all" || recordType !== "request" || capability !== "all" || explicitRange || userId || modelFilter || channelId);

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = value === "" || (key === "status" && value === "all") || (key === "recordType" && value === "request") || (key === "capability" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setLoadError("");
        setLogs([]);
        setTotal(0);
        setSelectedIds([]);
        void listAdminApiLogs({ ...queryFilters, page, pageSize })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setLogs(result.logs);
                setTotal(result.total);
                setSelectedIds([]);
                if (result.total > 0 && result.logs.length === 0 && page > 1) updateUrl({ page: 1 }, true);
            })
            .catch((error) => {
                if (sequence !== requestSequence.current) return;
                const text = error instanceof Error ? error.message : "读取请求明细失败";
                setLoadError(text);
                message.error(text);
            })
            .finally(() => sequence === requestSequence.current && setLoading(false));
        return () => { requestSequence.current += 1; };
    }, [debouncedKeyword, status, recordType, capability, fromDay, toDay, userId, modelFilter, channelId, page, pageSize, retry]);

    const fullColumns: ColumnsType<ApiCallLog> = [
        { title: "时间", width: 168, render: (_, log) => <button type="button" className="admin-log-detail-link" aria-label={`查看请求 ${log.id} 详情`} onClick={() => setDetailLogId(log.id)}>{formatTime(log.startedAt || log.createdAt)}</button> },
        {
            title: "用户",
            width: 180,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/85">{log.userDisplayName || log.userAccount || "未知用户"}</div>
                    <div className="truncate text-xs text-foreground/45">{log.userAccount ? `@${log.userAccount}` : "账号未记录"}</div>
                </div>
            ),
        },
        {
            title: "渠道 / 模型",
            width: 230,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate text-foreground/78">{log.channelName || "未记录渠道"}</div>
                    <div className="truncate text-xs text-foreground/45" title={log.model}>
                        {log.model || "未识别模型"}
                    </div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 88, render: capabilityText },
        { title: "结果", width: 118, render: (_, log) => <MediaResult log={log} onPreview={(url, kind) => setMediaPreview({ url, kind, title: `${capabilityText(log.capability)}结果` })} /> },
        { title: "请求阶段 / 状态", width: 160, render: (_, log) => <CallStatus log={log} /> },
        {
            title: "错误信息",
            width: 260,
            render: (_, log) =>
                log.status === "failed" || log.error || log.errorCode ? (
                    <div className="min-w-0" title={[log.errorCode, log.error].filter(Boolean).join(" · ")}>
                        <div className="truncate text-xs font-medium text-red-500">{log.errorCode || `HTTP ${log.statusCode || "失败"}`}</div>
                        <div className="line-clamp-2 text-xs leading-5 text-foreground/55">{log.error || "上游未返回错误详情"}</div>
                    </div>
                ) : (
                    <span className="text-foreground/30">--</span>
                ),
        },
        { title: "耗时", dataIndex: "durationMs", width: 112, render: (value) => <span className="tabular-nums">{formatDuration(value)}</span> },
        { title: "积分计算", width: 195, render: (_, log) => <BillingSummary log={log} /> },
        {
            title: "Tokens",
            width: 166,
            render: (_, log) =>
                log.usageAvailable ? (
                    <div className="space-y-0.5 text-xs tabular-nums">
                        <div>
                            <span className="text-foreground/40">输入</span> {log.inputTokens.toLocaleString()}
                        </div>
                        <div>
                            <span className="text-foreground/40">输出</span> {log.outputTokens.toLocaleString()}
                        </div>
                        {log.cachedTokens > 0 ? (
                            <div>
                                <span className="text-foreground/40">缓存</span> {log.cachedTokens.toLocaleString()}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <span className="text-foreground/35">未返回</span>
                ),
        },
    ];

    const identityColumns: ColumnsType<ApiCallLog> = [
        { title: "时间 / 详情", key: "time", width: 142, render: (_, log) => <button type="button" className="admin-log-detail-link" title={formatTime(log.startedAt || log.createdAt)} aria-label={`查看请求 ${log.id} 详情`} onClick={() => setDetailLogId(log.id)}>{formatCompactTime(log.startedAt || log.createdAt)}</button> },
        { title: "状态", key: "status", width: 88, render: (_, log) => <AdminStatusBadge {...logStatus(log)} /> },
        { title: "模型", dataIndex: "model", width: 170, ellipsis: true, render: (value) => value || "未识别模型" },
        { title: "渠道", dataIndex: "channelName", width: 116, ellipsis: true, render: (value) => value || "未记录渠道" },
        { title: "用户", key: "user", width: 110, ellipsis: true, render: (_, log) => <span title={[log.userDisplayName, log.userAccount].filter(Boolean).join(" · ")}>{log.userDisplayName || log.userAccount || "未知用户"}</span> },
    ];
    const compactColumns: ColumnsType<ApiCallLog> = view === "billing" ? [
        ...identityColumns,
        { title: "预授权", key: "reserved", align: "right", width: 100, render: (_, log) => (log.billable && log.billingAvailable ? formatCredits(log.billingReservedMicrocredits) : "—") },
        { title: "实收", key: "settled", align: "right", width: 100, render: (_, log) => (log.billable && log.billingAvailable && log.billingSettledMicrocredits !== undefined ? formatCredits(log.billingSettledMicrocredits) : "—") },
        { title: "成本积分", key: "cost", align: "right", width: 108, render: (_, log) => log.creditCostMicrocredits !== undefined ? formatCredits(log.creditCostMicrocredits) : log.creditCostConfigured ? "待核算" : "未配置" },
        { title: "账务状态", key: "billingStatus", width: 100, render: (_, log) => logBillingLabel(log) },
        { title: "Tokens 入 / 出", key: "usage", width: 142, render: (_, log) => log.usageAvailable ? `${log.inputTokens.toLocaleString()} / ${log.outputTokens.toLocaleString()}` : "未返回" },
    ] : [
        ...identityColumns,
        { title: "阶段", key: "kind", width: 90, render: (_, log) => requestKindText(log.requestKind) },
        { title: "耗时", dataIndex: "durationMs", align: "right", width: 90, render: formatDuration },
        { title: "错误摘要", key: "error", ellipsis: true, render: (_, log) => <span className={logStatus(log).tone === "error" ? "admin-log-error" : undefined} title={[log.errorCode, log.error].filter(Boolean).join(" · ")}>{[log.errorCode, log.error].filter(Boolean).join(" · ") || (logStatus(log).tone === "error" ? `HTTP ${log.statusCode || "失败"} · 未返回详情` : "—")}</span> },
    ];
    const baseColumns = view === "all" ? fullColumns : compactColumns;
    const columns: ColumnsType<ApiCallLog> = [...baseColumns, { title: "操作", key: "actions", width: 126, fixed: "right", render: (_, log) => videoRecoveryAvailable(log) ? <Button type="link" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => setDetailLogId(log.id)}>恢复任务</Button> : <span className="text-foreground/30">--</span> }];

    const applyDateRange = (start: Dayjs | null, end: Dayjs | null) => {
        if (start && end && end.diff(start, "day") + 1 > MAX_RANGE_DAYS) {
            message.warning(`单次最多查询 ${MAX_RANGE_DAYS} 天，请缩小日期范围`);
            return;
        }
        updateUrl({ from: start && end ? start.format("YYYY-MM-DD") : "", to: start && end ? end.format("YYYY-MM-DD") : "", page: 1 });
    };

    const runBatchRecovery = async () => {
        const selectedLogs = logs.filter((log) => selectedIds.includes(log.id));
        const videoIds = selectedLogs.filter(videoRecoveryAvailable).map((log) => log.id);
        const skipped = selectedIds.length - videoIds.length;
        if (videoIds.length === 0) { message.info("所选记录中没有可恢复的失败视频任务"); return; }
        setBatchRecovering(true);
        try {
            const result = await batchRecoverAdminApiLogs(videoIds);
            const totalSkipped = skipped + result.skipped;
            modal.info({ title: "批量恢复处理结果", width: 560, content: <div className="max-h-[50vh] space-y-2 overflow-auto"><div className="mb-3">成功 {result.success} 条，失败 {result.failed} 条，跳过 {totalSkipped} 条</div>{result.items.map((item) => <div key={item.logId} className="rounded border border-border/70 px-3 py-2 text-xs"><div className="font-mono">{item.logId}</div><div>{item.recovered ? "成功" : item.error?.startsWith("跳过") ? item.error : item.providerStatus ? `仍在生成中（${item.providerStatus}）` : `失败：${item.error || "未恢复"}`}</div></div>)}</div> });
            if (result.success > 0) window.dispatchEvent(new CustomEvent("wallet:updated"));
            setRetry((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "批量恢复失败"); }
        finally { setBatchRecovering(false); }
    };

    return (
        <AdminPageFrame
            title="请求明细"
            description="模型生成与结果下载记录；仅计费调用扣除积分"
            actions={
                <>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>刷新列表</Button>
                <AdminExportButton
                    exportFile={() => exportAdminApiLogs(queryFilters)}
                    fileName={() => `请求明细-${new Date().toISOString().slice(0, 10)}.csv`}
                    label="导出当前筛选"
                    successMessage="已按当前筛选导出请求明细"
                    errorMessage="导出请求明细失败"
                />
                </>
            }
        >
            {loadError ? <Alert type="error" showIcon title="请求明细读取失败" description={loadError} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} /> : null}
            <AdminDataTable
                className={view === "all" ? "admin-logs-full" : "admin-logs-compact"}
                trailing={<Segmented aria-label="请求明细视图" value={view} onChange={(value) => updateUrl({ view: value })} options={[{ label: "排障", value: "troubleshoot" }, { label: "计费", value: "billing" }, { label: "全部字段", value: "all" }]} />}
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索用户、渠道、模型、路径或请求号"
                        onValueChange={(value) => updateUrl({ filter: value, page: 1 }, true)}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => updateUrl({ filter: "", page: 1 })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`结果：${status === "succeeded" ? "成功" : "失败"}`} onRemove={() => updateUrl({ status: "all", page: 1 })} /> : null}
                        {capability !== "all" ? <AdminFilterChip label={`能力：${capabilityText(capability)}`} onRemove={() => updateUrl({ capability: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarFilters={
                    <>
                    <DatePicker.RangePicker
                        aria-label="请求日期范围"
                        value={explicitRange ? [dayjs(fromDay), dayjs(toDay)] : [dayjs(defaultRange.from), dayjs(defaultRange.to)]}
                        prefix={<span className="text-xs text-foreground/50" title="按 UTC 自然日筛选，含结束日；未选择时为近 30 天">UTC</span>}
                        placeholder={["开始日期", "结束日期"]}
                        disabledDate={(day) => day.format("YYYY-MM-DD") > defaultRange.to}
                        onChange={(dates) => applyDateRange(dates?.[0] || null, dates?.[1] || null)}
                    />
                    <Select
                        aria-label="按用户筛选"
                        className="w-44"
                        allowClear
                        showSearch
                        filterOption={false}
                        placeholder="全部用户"
                        loading={userOptions.searching}
                        value={userId || undefined}
                        options={userOptions.options}
                        onSearch={userOptions.onSearch}
                        onChange={(value) => updateUrl({ userId: value || "", page: 1 })}
                    />
                    <Select aria-label="按模型筛选" className="w-48" allowClear showSearch optionFilterProp="label" placeholder="全部模型" value={modelFilter || undefined} options={modelOptions} onChange={(value) => updateUrl({ model: value || "", page: 1 })} />
                    <Select aria-label="按渠道筛选" className="w-40" allowClear showSearch optionFilterProp="label" placeholder="全部渠道" value={channelId || undefined} options={channelOptions} onChange={(value) => updateUrl({ channelId: value || "", page: 1 })} />
                    <Select aria-label="明细类型" className="w-32" value={recordType} onChange={(value) => updateUrl({ recordType: value, page: 1 })} options={[{ label: "仅请求", value: "request" }, { label: "仅下载", value: "download" }, { label: "全部明细", value: "all" }]} />
                    <Select aria-label="能力类型" className="w-28" value={capability} onChange={(value) => updateUrl({ capability: value, page: 1 })} options={[{ label: "全部能力", value: "all" }, { label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }]} />
                    <Select
                        aria-label="请求结果"
                        className="w-32"
                        value={status}
                        onChange={(value) => updateUrl({ status: value, page: 1 })}
                        options={[
                            { label: "全部结果", value: "all" },
                            { label: "成功", value: "succeeded" },
                            { label: "失败", value: "failed" },
                        ]}
                    />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => updateUrl({ filter: "", status: "all", recordType: "request", capability: "all", from: "", to: "", userId: "", model: "", channelId: "", page: 1 })}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={batchRecovering} onClick={() => void runBatchRecovery()}>批量恢复</Button>
                        <AdminExportButton
                            type="primary"
                            size="small"
                            exportFile={() => exportAdminApiLogs({ recordType, ids: selectedIds })}
                            fileName={() => `请求明细-已选${selectedIds.length}条.csv`}
                            label="导出已选"
                            successMessage={`已导出选中的 ${selectedIds.length} 条请求明细`}
                            errorMessage="导出请求明细失败"
                        />
                    </AdminBatchBar>
                }
                skeletonColumns={10}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    rowSelection: { columnWidth: 36, selectedRowKeys: selectedIds, preserveSelectedRowKeys: false, onChange: (keys) => setSelectedIds(keys.map(String)) },
                    onRow: (log) => ({
                        onClick: (event) => {
                            if ((event.target as HTMLElement).closest("button,a,input,.ant-checkbox-wrapper")) return;
                            setDetailLogId(log.id);
                        },
                        className: "admin-table-clickable-row",
                    }),
                    columns,
                    tableLayout: "fixed",
                    dataSource: logs,
                    pagination: false,
                    scroll: { x: view === "all" ? 1901 : view === "billing" ? 1338 : 1186 },
                }}
                empty={loadError ? <span role="status">数据暂不可用，请重试</span> : <AdminTableEmpty filtered={hasFilters} />}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize })} />}
            />
            <ApiLogDetailDrawer logId={detailLogId} onClose={() => setDetailLogId(null)} onLogUpdated={(next) => setLogs((items) => items.map((item) => (item.id === next.id ? next : item)))} />
            <AdminModal
                title={mediaPreview?.title || "媒体预览"}
                open={Boolean(mediaPreview)}
                width={880}
                onCancel={() => setMediaPreview(null)}
                footer={
                    mediaPreview ? (
                        <Button icon={<Download className="size-4" />} onClick={() => downloadMedia(mediaPreview.url, mediaPreview.kind)}>
                            下载原文件
                        </Button>
                    ) : null
                }
            >
                {mediaPreview ? (
                    <MediaPreview
                        src={mediaPreview.url}
                        kind={mediaPreview.kind}
                        alt={mediaPreview.title}
                        controls={mediaPreview.kind === "video"}
                        className="max-h-[72vh] w-full bg-black object-contain"
                        fallbackClassName="min-h-[360px] rounded-lg bg-black/90 text-white/55"
                    />
                ) : null}
            </AdminModal>
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizePageSize(value: string | null) {
    const parsed = positiveInt(value, 20);
    return [20, 50, 100].includes(parsed) ? parsed : 20;
}
function normalizeCapability(value: string | null): "all" | "text" | "image" | "video" | "audio" { return value === "text" || value === "image" || value === "video" || value === "audio" ? value : "all"; }
function normalizeDay(value: string | null) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const parsed = dayjs(value);
    return parsed.isValid() && parsed.format("YYYY-MM-DD") === value ? value : "";
}
// 与后端默认一致：结束于当前 UTC 日，含首尾共 30 天。
function utcDefaultRange() {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29));
    return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}
function normalizeStatus(value: string | null): "all" | "succeeded" | "failed" {
    return value === "succeeded" || value === "failed" ? value : "all";
}
function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
function formatCompactTime(value: string) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function capabilityText(value: string) {
    return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知";
}
function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return `${minutes} 分 ${seconds} 秒`;
}

function BillingSummary({ log }: { log: ApiCallLog }) {
    if (!log.billable) return <span className="text-foreground/45">不计费</span>;
    if (!log.billingAvailable) return <span className="text-foreground/35">未扣积分</span>;
    const status = log.billingStatus || "reserved";
    const statusLabel = ({ settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" } as const)[status];
    return (
        <div>
            <div className="tabular-nums">预授权：{formatCredits(log.billingReservedMicrocredits)} 积分</div>
            <div className="tabular-nums">实收：{log.billingSettledMicrocredits !== undefined ? `${formatCredits(log.billingSettledMicrocredits)} 积分` : "未结算"}</div>
            <div className="tabular-nums text-xs text-foreground/60">成本价格：{log.creditCostMicrocredits !== undefined ? `${formatCredits(log.creditCostMicrocredits)} 积分` : log.creditCostConfigured ? "待核算" : "未配置"}</div>
            <div className="text-xs text-foreground/40">{statusLabel}</div>
        </div>
    );
}

function MediaResult({ log, onPreview }: { log: ApiCallLog; onPreview: (url: string, kind: "image" | "video") => void }) {
    const url = log.mediaPreviewUrl;
    const kind = log.mediaPreviewKind;
    const [unavailableUrl, setUnavailableUrl] = useState("");
    if (!url || (kind !== "image" && kind !== "video")) return <span className="text-foreground/30">--</span>;
    const previewUnavailable = unavailableUrl === url;
    return (
        <div className="flex w-[90px] items-center gap-2">
            <button
                type="button"
                title={previewUnavailable ? "预览不可用，素材可能已删除" : `预览${kind === "video" ? "视频" : "图片"}`}
                aria-label={previewUnavailable ? "预览不可用，素材可能已删除" : `预览${kind === "video" ? "视频" : "图片"}`}
                disabled={previewUnavailable}
                className="group relative h-11 w-16 shrink-0 overflow-hidden rounded border border-border/75 bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPreview(url, kind)}
            >
                <MediaPreview src={url} kind={kind} alt="生成结果" loading="lazy" className="size-full object-cover" fallbackClassName="text-white/55" fallbackLabel="预览不可用" onUnavailable={() => setUnavailableUrl(url)} />
                {!previewUnavailable ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
                        {kind === "video" ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
                    </span>
                ) : null}
                {!previewUnavailable && log.mediaCount > 1 ? <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/65 px-1 text-[var(--fs-micro)] leading-4 text-white">{log.mediaCount}</span> : null}
            </button>
            <IconButton size="sm" variant="ghost" icon={Download} onClick={() => downloadMedia(url, kind)} title="下载原文件" aria-label="下载原文件" />
        </div>
    );
}

function downloadMedia(url: string, kind: "image" | "video") {
    saveAs(url, `api-call-${kind}.${kind === "video" ? "mp4" : "png"}`);
}

function CallStatus({ log }: { log: ApiCallLog }) {
    return (
        <div>
            <div className="mb-1 text-xs font-medium text-foreground/70">{requestKindText(log.requestKind)}</div>
            <AdminStatusBadge {...logStatus(log)} />
            {log.mediaStage ? <div className="mt-1 text-xs text-foreground/60">{mediaDeliverySummary(log.taskStatus, log.mediaStage)}</div> : null}
            {log.capability === "video" ? <div className="mt-1 text-xs tabular-nums text-foreground/45">已轮询 {log.pollCount || 0} 次</div> : null}
        </div>
    );
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = { create: "模型生成", poll: "状态查询", download: "结果下载", upload: "上传 OSS", local_save: "保存文件", local_fallback: "本地兜底保存", offload: "同步 OSS", register: "登记素材", repair: "结果修复" };
    return labels[value] || "上游请求";
}
