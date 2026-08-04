import { App, Button, Input, Modal, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Eye, Play, Search } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { exportAdminApiLogs, listAdminApiLogs, type ApiCallLog } from "@/services/api/auth";
import { ApiLogDetailDrawer } from "../components/api-log-detail-drawer";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminBatchBar, AdminExportButton, AdminTableEmpty, AdminTableSkeleton } from "../components/admin-ui";

export default function LogsPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const [logs, setLogs] = useState<ApiCallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [detailLogId, setDetailLogId] = useState<string | null>(null);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const requestSequence = useRef(0);
    const hasFilters = Boolean(keyword || status !== "all");

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = (key === "filter" && value === "") || (key === "status" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        void listAdminApiLogs({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status, page, limit: pageSize })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setLogs(result.logs);
                setTotal(result.total);
                setSelectedIds([]);
                if (result.total > 0 && result.logs.length === 0 && page > 1) updateUrl({ page: 1 }, true);
            })
            .catch((error) => sequence === requestSequence.current && message.error(error instanceof Error ? error.message : "读取请求明细失败"))
            .finally(() => sequence === requestSequence.current && setLoading(false));
    }, [debouncedKeyword, status, page, pageSize]);

    const columns: ColumnsType<ApiCallLog> = [
        { title: "时间", width: 168, render: (_, log) => formatTime(log.startedAt || log.createdAt) },
        { title: "用户", width: 180, render: (_, log) => <div className="min-w-0"><div className="truncate font-medium text-foreground/85">{log.userDisplayName || log.userAccount || "未知用户"}</div><div className="truncate text-xs text-foreground/45">{log.userAccount ? `@${log.userAccount}` : "账号未记录"}</div></div> },
        { title: "渠道 / 模型", width: 230, render: (_, log) => <div className="min-w-0"><div className="truncate text-foreground/78">{log.channelName || "未记录渠道"}</div><div className="truncate text-xs text-foreground/45" title={log.model}>{log.model || "未识别模型"}</div></div> },
        { title: "能力", dataIndex: "capability", width: 88, render: capabilityText },
        { title: "结果", width: 118, render: (_, log) => <MediaResult log={log} onPreview={(url, kind) => setMediaPreview({ url, kind, title: `${capabilityText(log.capability)}结果` })} /> },
        { title: "调用状态", width: 160, render: (_, log) => <CallStatus log={log} /> },
        { title: "错误信息", width: 260, render: (_, log) => log.status === "failed" || log.error || log.errorCode ? <div className="min-w-0" title={[log.errorCode, log.error].filter(Boolean).join(" · ")}><div className="truncate text-xs font-medium text-red-500">{log.errorCode || `HTTP ${log.statusCode || "失败"}`}</div><div className="line-clamp-2 text-xs leading-5 text-foreground/55">{log.error || "上游未返回错误详情"}</div></div> : <span className="text-foreground/30">--</span> },
        { title: "耗时", dataIndex: "durationMs", width: 112, render: (value) => <span className="tabular-nums">{formatDuration(value)}</span> },
        { title: "计费", width: 130, render: (_, log) => log.costAvailable ? <div><div className="tabular-nums">{formatCost(log)}</div><div className="text-xs text-foreground/40">估算费用</div></div> : <span className="text-foreground/35">未配置</span> },
        { title: "Tokens", width: 166, render: (_, log) => log.usageAvailable ? <div className="space-y-0.5 text-xs tabular-nums"><div><span className="text-foreground/40">输入</span> {log.inputTokens.toLocaleString()}</div><div><span className="text-foreground/40">输出</span> {log.outputTokens.toLocaleString()}</div>{log.cachedTokens > 0 ? <div><span className="text-foreground/40">缓存</span> {log.cachedTokens.toLocaleString()}</div> : null}</div> : <span className="text-foreground/35">未返回</span> },
        { title: "操作", width: 90, fixed: "right", render: (_, log) => <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setDetailLogId(log.id)}>详情</Button> },
    ];

    return (
        <AdminPageFrame title="请求明细" description="上游调用与费用" actions={<AdminExportButton exportFile={() => exportAdminApiLogs({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status })} fileName={() => `请求明细-${new Date().toISOString().slice(0, 10)}.csv`} label="导出当前筛选" successMessage="已按当前筛选导出请求明细" errorMessage="导出请求明细失败" />}>
            <ListToolbar active={hasFilters} onReset={() => updateUrl({ filter: "", status: "all", page: 1 })}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索用户、渠道、模型、路径或请求号" onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)} />
                <Select className="w-32" value={status} onChange={(value) => updateUrl({ status: value, page: 1 })} options={[{ label: "全部结果", value: "all" }, { label: "成功", value: "succeeded" }, { label: "失败", value: "failed" }]} />
            </ListToolbar>
            <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}><AdminExportButton type="primary" size="small" exportFile={() => exportAdminApiLogs({ ids: selectedIds })} fileName={() => `请求明细-已选${selectedIds.length}条.csv`} label="导出已选" successMessage={`已导出选中的 ${selectedIds.length} 条请求明细`} errorMessage="导出请求明细失败" /></AdminBatchBar>
            <TableSurface>
                {loading && logs.length === 0 ? <AdminTableSkeleton rows={8} columns={11} /> : <Table className="app-data-table" size="middle" rowKey="id" loading={loading} rowSelection={{ selectedRowKeys: selectedIds, preserveSelectedRowKeys: false, onChange: (keys) => setSelectedIds(keys.map(String)) }} columns={columns} dataSource={logs} locale={{ emptyText: <AdminTableEmpty filtered={hasFilters} /> }} pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (value, range) => `${range[0]}-${range[1]} / 共 ${value} 条`, onChange: (nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize }) }} scroll={{ x: 1700 }} />}
            </TableSurface>
            <ApiLogDetailDrawer logId={detailLogId} onClose={() => setDetailLogId(null)} onLogUpdated={(next) => setLogs((items) => items.map((item) => item.id === next.id ? next : item))} />
            <Modal title={mediaPreview?.title || "媒体预览"} open={Boolean(mediaPreview)} width={880} onCancel={() => setMediaPreview(null)} footer={mediaPreview ? <Button icon={<Download className="size-4" />} onClick={() => downloadMedia(mediaPreview.url, mediaPreview.kind)}>下载原文件</Button> : null} destroyOnHidden>
                {mediaPreview?.kind === "video" ? <video src={mediaPreview.url} controls playsInline preload="metadata" className="max-h-[72vh] w-full bg-black object-contain" /> : mediaPreview ? <img src={mediaPreview.url} alt={mediaPreview.title} className="max-h-[72vh] w-full bg-black object-contain" /> : null}
            </Modal>
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function normalizePageSize(value: string | null) { const parsed = positiveInt(value, 20); return [20, 50, 100].includes(parsed) ? parsed : 20; }
function normalizeStatus(value: string | null): "all" | "succeeded" | "failed" { return value === "succeeded" || value === "failed" ? value : "all"; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
function capabilityText(value: string) { return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知"; }
function formatDuration(value: number) { if (value < 1_000) return `${value} ms`; if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`; const minutes = Math.floor(value / 60_000); const seconds = Math.round((value % 60_000) / 1_000); return `${minutes} 分 ${seconds} 秒`; }
function formatCost(log: ApiCallLog) { return `${log.currency || "USD"} ${(log.estimatedCostMicros / 1_000_000).toFixed(6)}`; }

function MediaResult({ log, onPreview }: { log: ApiCallLog; onPreview: (url: string, kind: "image" | "video") => void }) {
    const url = log.mediaPreviewUrl;
    const kind = log.mediaPreviewKind;
    if (!url || (kind !== "image" && kind !== "video")) return <span className="text-foreground/30">--</span>;
    return <div className="flex w-[90px] items-center gap-1.5">
        <button type="button" title={`预览${kind === "video" ? "视频" : "图片"}`} className="group relative h-11 w-16 shrink-0 overflow-hidden rounded border border-border/75 bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onPreview(url, kind)}>
            {kind === "video" ? <video src={url} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={url} alt="生成结果" loading="lazy" decoding="async" className="size-full object-cover" />}
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">{kind === "video" ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}</span>
            {log.mediaCount > 1 ? <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/65 px-1 text-[var(--fs-micro)] leading-4 text-white">{log.mediaCount}</span> : null}
        </button>
        <Button type="text" size="small" className="!size-7 !min-w-7 !p-0" icon={<Download className="size-3.5" />} onClick={() => downloadMedia(url, kind)} title="下载原文件" aria-label="下载原文件" />
    </div>;
}

function downloadMedia(url: string, kind: "image" | "video") {
    saveAs(url, `api-call-${kind}.${kind === "video" ? "mp4" : "png"}`);
}

function CallStatus({ log }: { log: ApiCallLog }) {
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    return <div><Tag variant="filled" color={failed ? "error" : processing ? "processing" : "success"}>{failed ? "失败" : processing ? "处理中" : "成功"}</Tag>{log.capability === "video" ? <div className="mt-1 text-xs tabular-nums text-foreground/45">已轮询 {log.pollCount || 0} 次</div> : null}</div>;
}
