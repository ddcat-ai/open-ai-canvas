import { App, Button, Input, Modal, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Eye, Search, Trash2 } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminResourceFileUrl, deleteAdminResources, downloadAdminResource, getAdminStorageStats, listAdminResources, type AdminStorageResource, type AdminStorageStats } from "@/services/api/admin-storage";
import { AdminBatchBar, AdminDataTable, AdminFilterChip, AdminStatTile, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

const pageSizes = [20, 50, 100];

export default function StorageResourcesPanel() {
    const { message, modal } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const kind = normalizeOption(searchParams.get("kind"), ["image", "video", "audio", "file"]);
    const status = normalizeOption(searchParams.get("status"), ["pending", "ready", "failed", "deleted"]);
    const provider = normalizeOption(searchParams.get("provider"), ["local", "aliyun", "tencent", "qiniu", "s3"]);
    const userId = searchParams.get("userId") || "";
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const debouncedUserId = useDebouncedValue(userId);
    const [resources, setResources] = useState<AdminStorageResource[]>([]);
    const [stats, setStats] = useState<AdminStorageStats | null>(null);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [previewing, setPreviewing] = useState<AdminStorageResource | null>(null);
    const [downloadingId, setDownloadingId] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const requestSequence = useRef(0);
    const hasFilters = Boolean(keyword || userId || kind !== "all" || status !== "all" || provider !== "all");

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = ((key === "filter" || key === "userId") && value === "") || (["kind", "status", "provider"].includes(key) && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const controller = new AbortController();
        void getAdminStorageStats(controller.signal)
            .then(setStats)
            .catch((error) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                message.error(error instanceof Error ? error.message : "读取存储统计失败");
            });
        return () => controller.abort();
    }, [refreshKey]);

    useEffect(() => {
        const sequence = ++requestSequence.current;
        const controller = new AbortController();
        setLoading(true);
        void listAdminResources(
            {
                keyword: debouncedKeyword || undefined,
                kind: kind === "all" ? undefined : kind,
                status: status === "all" ? undefined : status,
                provider: provider === "all" ? undefined : provider,
                userId: debouncedUserId || undefined,
                page,
                limit: pageSize,
            },
            controller.signal,
        )
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setResources(result.items);
                setTotal(result.total);
                if (result.total > 0 && result.items.length === 0 && page > 1) updateUrl({ page: 1 }, true);
            })
            .catch((error) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : "读取资源列表失败");
            })
            .finally(() => sequence === requestSequence.current && setLoading(false));
        return () => controller.abort();
    }, [debouncedKeyword, debouncedUserId, kind, status, provider, page, pageSize, refreshKey]);

    const columns = useMemo<ColumnsType<AdminStorageResource>>(
        () => [
            {
                title: "资源",
                width: 260,
                render: (_, resource) => (
                    <div className="min-w-0">
                        <div className="truncate font-medium text-foreground/85" title={resource.objectKey}>
                            {fileName(resource.objectKey) || resource.id}
                        </div>
                        <div className="admin-monospace truncate text-foreground/42" title={resource.id}>
                            {resource.id}
                        </div>
                    </div>
                ),
            },
            {
                title: "用户",
                width: 170,
                render: (_, resource) => (
                    <div className="min-w-0">
                        <div className="truncate text-foreground/78">{resource.userName || resource.userId}</div>
                        <div className="admin-monospace truncate text-foreground/38" title={resource.userId}>
                            {resource.userId}
                        </div>
                    </div>
                ),
            },
            { title: "类型", dataIndex: "kind", width: 92, render: (value) => kindLabel(value) },
            { title: "状态", dataIndex: "status", width: 104, render: (value) => <AdminStatusBadge label={statusLabel(value)} tone={statusTone(value)} /> },
            { title: "存储", dataIndex: "provider", width: 110, render: (value) => providerLabel(value) },
            { title: "大小", dataIndex: "size", width: 110, render: (value) => <span className="tabular-nums">{formatBytes(value)}</span> },
            { title: "规格", width: 135, render: (_, resource) => resourceDimensions(resource) },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: formatTime },
            {
                title: "操作",
                width: 220,
                align: "right",
                fixed: "right",
                render: (_, resource) => (
                    <div className="flex justify-end gap-1">
                        <Button type="text" size="small" icon={<Eye className="size-3.5" />} disabled={resource.status !== "ready"} onClick={() => setPreviewing(resource)}>
                            预览
                        </Button>
                        <Button type="text" size="small" icon={<Download className="size-3.5" />} loading={downloadingId === resource.id} disabled={resource.status !== "ready"} onClick={() => void download(resource)}>
                            下载
                        </Button>
                        <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} disabled={deleting} onClick={() => confirmDelete([resource.id])}>
                            删除
                        </Button>
                    </div>
                ),
            },
        ],
        [downloadingId, deleting],
    );

    const download = async (resource: AdminStorageResource) => {
        setDownloadingId(resource.id);
        try {
            const blob = await downloadAdminResource(resource);
            saveAs(blob, fileName(resource.objectKey) || resource.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载资源失败");
        } finally {
            setDownloadingId("");
        }
    };

    const confirmDelete = (resourceIds: string[]) => {
        const uniqueIds = Array.from(new Set(resourceIds));
        modal.confirm({
            title: uniqueIds.length > 1 ? `删除选中的 ${uniqueIds.length} 个资源？` : "删除这个资源？",
            content: "系统会先批量检查公告、素材、画布、项目、工作流和镜头产物引用。仍被引用的资源会保留；无引用资源的记录、清理任务和审计事件会在同一事务提交。",
            okText: uniqueIds.length > 1 ? "检查并删除" : "确认删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setDeleting(true);
                try {
                    const result = await deleteAdminResources(uniqueIds);
                    setSelectedIds([]);
                    setRefreshKey((value) => value + 1);
                    if (result.deleted.length > 0) message.success(`已删除 ${result.deleted.length} 个资源`);
                    if (result.blocked.length > 0) {
                        modal.warning({
                            title: result.deleted.length > 0 ? "部分资源未删除" : "资源未删除",
                            content: <DeleteBlockedSummary blocked={result.blocked} />,
                            okText: "知道了",
                        });
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除资源失败");
                    throw error;
                } finally {
                    setDeleting(false);
                }
            },
        });
    };

    return (
        <div className="space-y-4 pt-4">
            <div className="grid overflow-hidden rounded-md border border-border sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatTile label="资源记录" value={stats ? stats.resourceCount.toLocaleString() : "--"} detail={stats ? `可用 ${stats.readyCount.toLocaleString()} 项` : undefined} />
                <AdminStatTile label="逻辑体积" value={stats ? formatBytes(stats.logicalBytes) : "--"} detail="包含失败与待处理记录" />
                <AdminStatTile label="实际可用体积" value={stats ? formatBytes(stats.physicalBytes) : "--"} detail="仅统计已就绪资源" />
                <AdminStatTile label="存储分布" value={stats ? formatBytes(stats.remoteBytes) : "--"} detail={stats ? `本地 ${formatBytes(stats.localBytes)} · 远端` : undefined} />
            </div>
            <AdminDataTable
                toolbar={
                    <div className="admin-storage-resource-filters">
                        <Input
                            aria-label="搜索资源"
                            autoComplete="off"
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="资源 ID 或对象路径"
                            onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)}
                        />
                        <Input aria-label="按用户 ID 筛选" autoComplete="off" allowClear className="w-48" value={userId} placeholder="用户" onChange={(event) => updateUrl({ userId: event.target.value, page: 1 }, true)} />
                        <Select aria-label="筛选资源类型" className="w-32" value={kind} onChange={(value) => updateUrl({ kind: value, page: 1 })} options={kindOptions} />
                        <Select aria-label="筛选资源状态" className="w-32" value={status} onChange={(value) => updateUrl({ status: value, page: 1 })} options={statusOptions} />
                        <Select aria-label="筛选存储类型" className="w-36" value={provider} onChange={(value) => updateUrl({ provider: value, page: 1 })} options={providerOptions} />
                    </div>
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => updateUrl({ filter: "", page: 1 })} /> : null}
                        {userId ? <AdminFilterChip label={`用户：${userId}`} onRemove={() => updateUrl({ userId: "", page: 1 })} /> : null}
                        {kind !== "all" ? <AdminFilterChip label={`类型：${kindLabel(kind)}`} onRemove={() => updateUrl({ kind: "all", page: 1 })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`状态：${statusLabel(status)}`} onRemove={() => updateUrl({ status: "all", page: 1 })} /> : null}
                        {provider !== "all" ? <AdminFilterChip label={`存储：${providerLabel(provider)}`} onRemove={() => updateUrl({ provider: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => updateUrl({ filter: "", userId: "", kind: "all", status: "all", provider: "all", page: 1 })}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />} loading={deleting} onClick={() => confirmDelete(selectedIds)}>
                            批量删除
                        </Button>
                    </AdminBatchBar>
                }
                skeletonColumns={9}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    columns,
                    dataSource: resources,
                    rowSelection: {
                        selectedRowKeys: selectedIds,
                        preserveSelectedRowKeys: true,
                        onChange: (keys) => {
                            const next = keys.map(String);
                            if (next.length > 100) message.warning("单次最多选择 100 个资源");
                            setSelectedIds(next.slice(0, 100));
                        },
                    },
                    pagination: false,
                    scroll: { x: 1390 },
                }}
                empty={<AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "暂无资源记录"} description={hasFilters ? undefined : "资源上传或生成后会显示在这里。"} />}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize })} />}
            />
            <Modal
                title={previewing ? fileName(previewing.objectKey) || "资源预览" : "资源预览"}
                open={Boolean(previewing)}
                width={880}
                onCancel={() => setPreviewing(null)}
                footer={
                    previewing ? (
                        <Button icon={<Download className="size-4" />} loading={downloadingId === previewing.id} onClick={() => void download(previewing)}>
                            下载原文件
                        </Button>
                    ) : null
                }
                destroyOnHidden
            >
                {previewing ? <ResourcePreview resource={previewing} /> : null}
            </Modal>
        </div>
    );
}

function DeleteBlockedSummary({ blocked }: { blocked: Array<{ id: string; reason: string; references: Array<{ kind: string; id: string; title: string }> }> }) {
    return (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1 text-sm">
            {blocked.map((item) => (
                <div key={item.id} className="rounded-md border border-border px-3 py-2">
                    <div className="admin-monospace break-all text-foreground/75">{item.id}</div>
                    <div className="mt-1 text-foreground/55">{item.reason}</div>
                    {item.references.length > 0 ? (
                        <div className="mt-1 text-xs text-foreground/45">
                            {item.references
                                .slice(0, 4)
                                .map((reference) => `${reference.kind}「${reference.title || reference.id}」`)
                                .join("、")}
                            {item.references.length > 4 ? ` 等 ${item.references.length} 处` : ""}
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function ResourcePreview({ resource }: { resource: AdminStorageResource }) {
    const url = adminResourceFileUrl(resource.id);
    if (resource.kind === "image" || resource.mimeType.startsWith("image/")) return <img className="mx-auto max-h-[65vh] max-w-full object-contain" src={url} alt={fileName(resource.objectKey) || "资源预览"} />;
    if (resource.kind === "video" || resource.mimeType.startsWith("video/")) return <video className="mx-auto max-h-[65vh] max-w-full bg-black" src={url} controls playsInline />;
    if (resource.kind === "audio" || resource.mimeType.startsWith("audio/"))
        return (
            <div className="py-12">
                <audio className="w-full" src={url} controls />
            </div>
        );
    return <div className="rounded-md border border-border bg-muted/20 px-5 py-10 text-center text-sm text-foreground/55">该文件类型不支持内嵌预览，请下载后查看。</div>;
}

const kindOptions = [
    { label: "全部类型", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
    { label: "文件", value: "file" },
];
const statusOptions = [
    { label: "全部状态", value: "all" },
    { label: "待处理", value: "pending" },
    { label: "已就绪", value: "ready" },
    { label: "失败", value: "failed" },
    { label: "已删除", value: "deleted" },
];
const providerOptions = [
    { label: "全部存储", value: "all" },
    { label: "本地", value: "local" },
    { label: "阿里云 OSS", value: "aliyun" },
    { label: "腾讯云 COS", value: "tencent" },
    { label: "七牛云 Kodo", value: "qiniu" },
    { label: "S3", value: "s3" },
];

function normalizeOption(value: string | null, values: string[]) {
    return value && values.includes(value) ? value : "all";
}
function positiveInt(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizePageSize(value: string | null) {
    const parsed = positiveInt(value, 20);
    return pageSizes.includes(parsed) ? parsed : 20;
}
function fileName(objectKey: string) {
    return objectKey.split("/").filter(Boolean).at(-1) || "";
}
function kindLabel(kind: string) {
    return ({ image: "图片", video: "视频", audio: "音频", file: "文件" } as Record<string, string>)[kind] || kind || "未知";
}
function statusLabel(status: string) {
    return ({ pending: "待处理", ready: "已就绪", failed: "失败", deleted: "已删除" } as Record<string, string>)[status] || status || "未知";
}
function statusTone(status: string): "neutral" | "success" | "warning" | "error" {
    return status === "ready" ? "success" : status === "pending" ? "warning" : status === "failed" ? "error" : "neutral";
}
function providerLabel(provider: string) {
    return ({ local: "本地", aliyun: "阿里云 OSS", tencent: "腾讯云 COS", qiniu: "七牛云 Kodo", s3: "S3" } as Record<string, string>)[provider] || provider || "本地";
}
function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** unit;
    return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("zh-CN", { hour12: false });
}
function resourceDimensions(resource: AdminStorageResource) {
    if (resource.width > 0 && resource.height > 0)
        return (
            <span className="tabular-nums">
                {resource.width} × {resource.height}
            </span>
        );
    if (resource.durationMs > 0) return <span className="tabular-nums">{formatDuration(resource.durationMs)}</span>;
    return <span className="text-foreground/30">--</span>;
}
function formatDuration(durationMs: number) {
    const seconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds} 秒`;
}
