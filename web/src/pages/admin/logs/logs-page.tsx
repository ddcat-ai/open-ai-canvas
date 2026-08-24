import { App, Button, Input, Modal, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Eye, Play, Search } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { PaginationBar } from "@/components/layout/workspace-page";
import { MediaPreview } from "@/components/media-preview";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { exportAdminApiLogs, listAdminApiLogs, type ApiCallLog } from "@/services/api/auth";
import { ApiLogDetailDrawer } from "../components/api-log-detail-drawer";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminBatchBar, AdminDataTable, AdminExportButton, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export default function LogsPage() {
    const { t } = useTranslation("canvas");
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
            .catch((error) => sequence === requestSequence.current && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-request-details-2")))
            .finally(() => sequence === requestSequence.current && setLoading(false));
    }, [debouncedKeyword, status, page, pageSize]);

    const columns: ColumnsType<ApiCallLog> = [
        { title: t("admin:time"), width: 168, render: (_, log) => formatTime(log.startedAt || log.createdAt) },
        {
            title: t("admin:users-2"),
            width: 180,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/85">{log.userDisplayName || log.userAccount || t("admin:unknown-user")}</div>
                    <div className="truncate text-xs text-foreground/45">{log.userAccount ? `@${log.userAccount}` : t("admin:account-not-recorded")}</div>
                </div>
            ),
        },
        {
            title: t("admin:channel-model"),
            width: 230,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate text-foreground/78">{log.channelName || t("admin:channel-not-recorded")}</div>
                    <div className="truncate text-xs text-foreground/45" title={log.model}>
                        {log.model || t("admin:model-not-identified")}
                    </div>
                </div>
            ),
        },
        { title: t("admin:capability"), dataIndex: "capability", width: 88, render: capabilityText },
        { title: t("admin:result"), width: 118, render: (_, log) => <MediaResult log={log} onPreview={(url, kind) => setMediaPreview({ url, kind, title: `${capabilityText(log.capability)}结果` })} /> },
        { title: t("admin:call-status"), width: 160, render: (_, log) => <CallStatus log={log} /> },
        {
            title: t("admin:error-message"),
            width: 260,
            render: (_, log) =>
                log.status === "failed" || log.error || log.errorCode ? (
                    <div className="min-w-0" title={[log.errorCode, log.error].filter(Boolean).join(" · ")}>
                        <div className="truncate text-xs font-medium text-red-500">{log.errorCode || `HTTP ${log.statusCode || t("admin:failed")}`}</div>
                        <div className="line-clamp-2 text-xs leading-5 text-foreground/55">{log.error || t("admin:upstream-returned-no-error-details")}</div>
                    </div>
                ) : (
                    <span className="text-foreground/30">--</span>
                ),
        },
        { title: t("admin:duration-2"), dataIndex: "durationMs", width: 112, render: (value) => <span className="tabular-nums">{formatDuration(value)}</span> },
        {
            title: t("admin:billing"),
            width: 130,
            render: (_, log) =>
                log.costAvailable ? (
                    <div>
                        <div className="tabular-nums">{formatCost(log)}</div>
                        <div className="text-xs text-foreground/40">{t("admin:estimated-cost-3")}</div>
                    </div>
                ) : (
                    <span className="text-foreground/35">{t("admin:not-configured-2")}</span>
                ),
        },
        {
            title: "Tokens",
            width: 166,
            render: (_, log) =>
                log.usageAvailable ? (
                    <div className="space-y-0.5 text-xs tabular-nums">
                        <div>
                            <span className="text-foreground/40">{t("admin:in-2")}</span> {log.inputTokens.toLocaleString()}
                        </div>
                        <div>
                            <span className="text-foreground/40">{t("admin:output-2")}</span> {log.outputTokens.toLocaleString()}
                        </div>
                        {log.cachedTokens > 0 ? (
                            <div>
                                <span className="text-foreground/40">{t("admin:cache")}</span> {log.cachedTokens.toLocaleString()}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <span className="text-foreground/35">{t("admin:not-returned-2")}</span>
                ),
        },
    ];

    return (
        <AdminPageFrame
            title={t("admin:request-details")}
            description={t("admin:upstream-calls-and-costs")}
            actions={
                <AdminExportButton
                    exportFile={() => exportAdminApiLogs({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status })}
                    fileName={() => `请求明细-${new Date().toISOString().slice(0, 10)}.csv`}
                    label={t("admin:export-current-filter")}
                    successMessage={t("admin:request-details-exported-with-the-current-filter")}
                    errorMessage={t("admin:failed-to-export-request-details")}
                />
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={t("admin:search-user-channel-model-path-or-request-id")}
                        onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={t("admin:search-param", { keyword: keyword })} onRemove={() => updateUrl({ filter: "", page: 1 })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`结果：${status === "succeeded" ? t("admin:succeeded") : t("admin:failed")}`} onRemove={() => updateUrl({ status: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarFilters={
                    <Select
                        className="w-32"
                        value={status}
                        onChange={(value) => updateUrl({ status: value, page: 1 })}
                        options={[
                            { label: t("admin:all-results"), value: "all" },
                            { label: t("admin:succeeded"), value: "succeeded" },
                            { label: t("admin:failed"), value: "failed" },
                        ]}
                    />
                }
                toolbarActive={hasFilters}
                onReset={() => updateUrl({ filter: "", status: "all", page: 1 })}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <AdminExportButton
                            type="primary"
                            size="small"
                            exportFile={() => exportAdminApiLogs({ ids: selectedIds })}
                            fileName={() => t("admin:request-details-selected-param-csv", { length: selectedIds.length })}
                            label={t("admin:export-selected")}
                            successMessage={t("admin:exported-param-selected-request-details", { length: selectedIds.length })}
                            errorMessage={t("admin:failed-to-export-request-details")}
                        />
                    </AdminBatchBar>
                }
                skeletonColumns={10}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    rowSelection: { selectedRowKeys: selectedIds, preserveSelectedRowKeys: false, onChange: (keys) => setSelectedIds(keys.map(String)) },
                    onRow: (log) => ({
                        onClick: (event) => {
                            if ((event.target as HTMLElement).closest("button,a,input,.ant-checkbox-wrapper")) return;
                            setDetailLogId(log.id);
                        },
                        className: "admin-table-clickable-row",
                    }),
                    columns,
                    dataSource: logs,
                    pagination: false,
                    scroll: { x: 1600 },
                }}
                empty={<AdminTableEmpty filtered={hasFilters} />}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize })} />}
            />
            <ApiLogDetailDrawer logId={detailLogId} onClose={() => setDetailLogId(null)} onLogUpdated={(next) => setLogs((items) => items.map((item) => (item.id === next.id ? next : item)))} />
            <Modal
                title={mediaPreview?.title || t("admin:media-preview")}
                open={Boolean(mediaPreview)}
                width={880}
                onCancel={() => setMediaPreview(null)}
                footer={
                    mediaPreview ? (
                        <Button icon={<Download className="size-4" />} onClick={() => downloadMedia(mediaPreview.url, mediaPreview.kind)}>
                            {t("admin:download-original-file-2")}
                        </Button>
                    ) : null
                }
                destroyOnHidden
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
            </Modal>
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
function normalizeStatus(value: string | null): "all" | "succeeded" | "failed" {
    return value === "succeeded" || value === "failed" ? value : "all";
}
function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
function capabilityText(value: string) {
    return ({ text: t("admin:text"), image: t("admin:image"), video: t("admin:video"), audio: t("admin:audio") } as Record<string, string>)[value] || t("admin:unknown");
}
function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return t("admin:paramm-params", { minutes: minutes, seconds: seconds });
}
function formatCost(log: ApiCallLog) {
    return `${log.currency || "USD"} ${(log.estimatedCostMicros / 1_000_000).toFixed(6)}`;
}

function MediaResult({ log, onPreview }: { log: ApiCallLog; onPreview: (url: string, kind: "image" | "video") => void }) {
    const { t } = useTranslation("canvas");
    const url = log.mediaPreviewUrl;
    const kind = log.mediaPreviewKind;
    const [unavailableUrl, setUnavailableUrl] = useState("");
    if (!url || (kind !== "image" && kind !== "video")) return <span className="text-foreground/30">--</span>;
    const previewUnavailable = unavailableUrl === url;
    return (
        <div className="flex w-[90px] items-center gap-1.5">
            <button
                type="button"
                title={previewUnavailable ? t("admin:preview-unavailable-the-asset-may-have-been-deleted") : `预览${kind === "video" ? t("admin:video") : t("admin:image")}`}
                aria-label={previewUnavailable ? t("admin:preview-unavailable-the-asset-may-have-been-deleted") : `预览${kind === "video" ? t("admin:video") : t("admin:image")}`}
                disabled={previewUnavailable}
                className="group relative h-11 w-16 shrink-0 overflow-hidden rounded border border-border/75 bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPreview(url, kind)}
            >
                <MediaPreview
                    src={url}
                    kind={kind}
                    alt={t("admin:generation-result")}
                    loading="lazy"
                    className="size-full object-cover"
                    fallbackClassName="text-white/55"
                    fallbackLabel={t("admin:preview-unavailable")}
                    onUnavailable={() => setUnavailableUrl(url)}
                />
                {!previewUnavailable ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
                        {kind === "video" ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
                    </span>
                ) : null}
                {!previewUnavailable && log.mediaCount > 1 ? <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/65 px-1 text-[var(--fs-micro)] leading-4 text-white">{log.mediaCount}</span> : null}
            </button>
            <Button
                type="text"
                size="small"
                className="!size-7 !min-w-7 !p-0"
                icon={<Download className="size-3.5" />}
                onClick={() => downloadMedia(url, kind)}
                title={t("admin:download-original-file-2")}
                aria-label={t("admin:download-original-file-2")}
            />
        </div>
    );
}

function downloadMedia(url: string, kind: "image" | "video") {
    saveAs(url, `api-call-${kind}.${kind === "video" ? "mp4" : "png"}`);
}

function CallStatus({ log }: { log: ApiCallLog }) {
    const { t } = useTranslation("canvas");
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    return (
        <div>
            <AdminStatusBadge label={failed ? t("admin:failed") : processing ? t("admin:processing") : t("admin:succeeded")} tone={failed ? "error" : processing ? "warning" : "success"} />
            {log.capability === "video" ? (
                <div className="mt-1 text-xs tabular-nums text-foreground/45">
                    {t("admin:polled")} {log.pollCount || 0} {t("admin:requests-2")}
                </div>
            ) : null}
        </div>
    );
}
