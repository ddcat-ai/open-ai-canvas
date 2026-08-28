import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Image as AntImage, Input, Modal, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AudioLines, Database, FileText, Film, Image as ImageIcon, RefreshCw, Search, Trash2 } from "lucide-react";

import { PaginationBar, ListToolbar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminResourceFileUrl, deleteAdminResource, getAdminStorageStats, listAdminResources, type AdminResourceItem, type AdminStorageStats } from "@/services/api/admin-storage";
import { useAdminContext } from "@/pages/admin/admin-context";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatTile, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

const kindOptions = [
    { label: "全部类型", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
    { label: "文件", value: "file" },
];
const statusOptions = [
    { label: "全部状态", value: "all" },
    { label: "就绪", value: "ready" },
    { label: "处理中", value: "pending" },
    { label: "失败", value: "failed" },
];
const providerOptions = [
    { label: "全部位置", value: "all" },
    { label: "服务器本地", value: "local" },
    { label: "阿里云 OSS", value: "aliyun" },
    { label: "腾讯云 COS", value: "tencent" },
    { label: "七牛云 Kodo", value: "qiniu" },
    { label: "通用 S3", value: "s3" },
];

export default function StorageResourcesPanel() {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [kind, setKind] = useState("all");
    const [status, setStatus] = useState("all");
    const [provider, setProvider] = useState("all");
    const [userId, setUserId] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [items, setItems] = useState<AdminResourceItem[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<AdminStorageStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [preview, setPreview] = useState<AdminResourceItem | null>(null);
    const requestVersion = useRef(0);

    const reload = useCallback(async () => {
        const version = ++requestVersion.current;
        setLoading(true);
        try {
            const result = await listAdminResources({
                keyword: debouncedKeyword || undefined,
                kind: kind === "all" ? undefined : kind,
                status: status === "all" ? undefined : status,
                provider: provider === "all" ? undefined : provider,
                userId: userId || undefined,
                page,
                limit: pageSize,
            });
            if (version !== requestVersion.current) return;
            setItems(result.items || []);
            setTotal(result.total || 0);
        } catch (error) {
            if (version === requestVersion.current) message.error(error instanceof Error ? error.message : "读取存储资源失败");
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }, [debouncedKeyword, kind, message, page, pageSize, provider, status, userId]);

    const reloadStats = useCallback(async () => {
        try {
            setStats((await getAdminStorageStats()).stats);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取存储统计失败");
        }
    }, [message]);

    useEffect(() => {
        void reload();
    }, [reload]);
    useEffect(() => {
        void reloadStats();
    }, [reloadStats]);

    const remove = useCallback(
        async (id: string) => {
            try {
                await deleteAdminResource(id);
                message.success("资源已删除，物理对象将由后台清理");
                setSelectedRowKeys((keys) => keys.filter((key) => String(key) !== id));
                await Promise.all([reload(), reloadStats()]);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "删除资源失败");
            }
        },
        [message, reload, reloadStats],
    );

    const removeSelected = useCallback(() => {
        if (!selectedRowKeys.length) return;
        modal.confirm({
            title: `删除选中的 ${selectedRowKeys.length} 个资源？`,
            content: "删除前会检查业务引用；删除成功后文件由后台队列清理。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                for (const key of selectedRowKeys) await remove(String(key));
            },
        });
    }, [modal, remove, selectedRowKeys]);

    const columns = useMemo<ColumnsType<AdminResourceItem>>(
        () => [
            {
                title: "资源",
                dataIndex: "id",
                width: 300,
                render: (_, record) => (
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.05] text-foreground/60">
                            <ResourceIcon kind={record.kind} />
                        </span>
                        <div className="min-w-0">
                            <div className="truncate font-mono text-xs" title={record.id}>
                                {record.id}
                            </div>
                            <div className="mt-1 truncate text-xs text-foreground/45" title={record.mimeType}>
                                {record.mimeType || record.kind}
                            </div>
                        </div>
                    </div>
                ),
            },
            { title: "用户", dataIndex: "userName", width: 150, ellipsis: true, render: (value: string, record) => <span title={record.userId}>{value || record.userId}</span> },
            { title: "位置", dataIndex: "storageLocation", width: 130, render: (value: string) => <Tag>{storageLabel(value)}</Tag> },
            { title: "状态", dataIndex: "status", width: 100, render: (value: string) => <AdminStatusBadge label={statusLabel(value)} tone={value === "ready" ? "success" : value === "failed" ? "error" : "warning"} /> },
            { title: "大小", dataIndex: "storageBytes", width: 120, align: "right", render: (value: number) => <span className="tabular-nums">{formatBytes(value)}</span> },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: (value: string) => <span className="text-xs tabular-nums text-foreground/55">{formatDateTime(value)}</span> },
            {
                title: "操作",
                key: "actions",
                width: 150,
                fixed: "right",
                render: (_, record) => (
                    <AdminRowActions
                        primary={{ label: "预览", icon: <Search className="size-3.5" />, onClick: () => setPreview(record) }}
                        actions={[
                            {
                                key: "delete",
                                label: "删除",
                                icon: <Trash2 className="size-3.5" />,
                                danger: true,
                                onClick: () => void remove(record.id),
                                confirm: { title: "删除这个资源？", description: "删除前会检查业务引用，删除成功后物理对象进入后台清理队列。", okText: "删除资源" },
                            },
                        ]}
                    />
                ),
            },
        ],
        [remove],
    );

    const userOptions = references.users.map((user) => ({ label: user.displayName || user.username, value: user.id }));
    const activeFilterCount = Boolean(keyword || kind !== "all" || status !== "all" || provider !== "all" || userId);

    return (
        <div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatTile label="资源记录" value={stats?.resourceCount ?? "-"} detail="包含全部状态" />
                <AdminStatTile label="逻辑大小" value={formatBytes(stats?.totalBytes || 0)} detail="资源记录声明大小" />
                <AdminStatTile label="本地占用" value={formatBytes(stats?.localBytes || 0)} detail="就绪的服务器本地对象" />
                <AdminStatTile label="远端占用" value={formatBytes(stats?.remoteBytes || 0)} detail="就绪的对象存储对象" />
            </div>
            <ListToolbar
                active={activeFilterCount}
                onReset={() => {
                    setKeyword("");
                    setKind("all");
                    setStatus("all");
                    setProvider("all");
                    setUserId("");
                    setPage(1);
                }}
                trailing={
                    selectedRowKeys.length ? (
                        <Button danger icon={<Trash2 className="size-3.5" />} onClick={removeSelected}>
                            删除选中
                        </Button>
                    ) : (
                        <Button icon={<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />} onClick={() => void Promise.all([reload(), reloadStats()])}>
                            刷新
                        </Button>
                    )
                }
            >
                <Input
                    allowClear
                    className="app-list-search"
                    prefix={<Search className="size-4 text-foreground/40" />}
                    value={keyword}
                    placeholder="搜索资源 ID 或对象路径"
                    onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                    }}
                />
                <Select
                    className="w-28"
                    value={kind}
                    options={kindOptions}
                    onChange={(value) => {
                        setKind(value);
                        setPage(1);
                    }}
                />
                <Select
                    className="w-28"
                    value={status}
                    options={statusOptions}
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                />
                <Select
                    className="w-32"
                    value={provider}
                    options={providerOptions}
                    onChange={(value) => {
                        setProvider(value);
                        setPage(1);
                    }}
                />
                <Select
                    className="w-40"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="全部用户"
                    options={userOptions}
                    value={userId || undefined}
                    onChange={(value) => {
                        setUserId(value || "");
                        setPage(1);
                    }}
                />
            </ListToolbar>
            {activeFilterCount ? (
                <div className="mb-3 flex flex-wrap gap-2">
                    {keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => setKeyword("")} /> : null}
                    {kind !== "all" ? <AdminFilterChip label={`类型：${kind}`} onRemove={() => setKind("all")} /> : null}
                    {status !== "all" ? <AdminFilterChip label={`状态：${statusLabel(status)}`} onRemove={() => setStatus("all")} /> : null}
                    {provider !== "all" ? <AdminFilterChip label={`位置：${storageLabel(provider)}`} onRemove={() => setProvider("all")} /> : null}
                </div>
            ) : null}
            <AdminDataTable
                table={{ rowKey: "id", size: "small", loading, dataSource: items, columns, pagination: false, scroll: { x: 1120 }, rowSelection: { selectedRowKeys, onChange: setSelectedRowKeys } }}
                empty={<AdminTableEmpty filtered={activeFilterCount} title="没有匹配的资源" />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={total}
                        onChange={(nextPage, nextSize) => {
                            setPage(nextSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextSize);
                        }}
                    />
                }
            />
            <Modal title="资源预览" open={Boolean(preview)} footer={null} width={760} onCancel={() => setPreview(null)}>
                {preview ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-foreground/55">{preview.id}</span>
                            <Button size="small" icon={<FileText className="size-3.5" />} href={adminResourceFileUrl(preview.id, true)} target="_blank" rel="noopener noreferrer">
                                下载
                            </Button>
                        </div>
                        <div className="grid min-h-56 place-items-center overflow-hidden rounded-lg border border-border/60 bg-black/95 p-4">
                            {preview.kind === "image" ? (
                                <AntImage src={adminResourceFileUrl(preview.id)} alt={preview.id} className="max-h-[440px] max-w-full object-contain" />
                            ) : preview.kind === "video" ? (
                                <video src={adminResourceFileUrl(preview.id)} controls className="max-h-[440px] max-w-full" />
                            ) : preview.kind === "audio" ? (
                                <audio src={adminResourceFileUrl(preview.id)} controls />
                            ) : (
                                <FileText className="size-12 text-white/40" />
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-foreground/60 sm:grid-cols-3">
                            <span>用户：{preview.userName || preview.userId}</span>
                            <span>类型：{preview.mimeType || preview.kind}</span>
                            <span>大小：{formatBytes(preview.size)}</span>
                            <span>位置：{storageLabel(preview.storageLocation)}</span>
                            <span>对象：{preview.objectKey}</span>
                            <span>创建：{formatDateTime(preview.createdAt)}</span>
                            {preview.error ? <span className="col-span-2 text-red-500 sm:col-span-3">错误：{preview.error}</span> : null}
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

function ResourceIcon({ kind }: { kind: string }) {
    if (kind === "image") return <ImageIcon className="size-4" />;
    if (kind === "video") return <Film className="size-4" />;
    if (kind === "audio") return <AudioLines className="size-4" />;
    return <Database className="size-4" />;
}
function formatBytes(value: number) {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}
function formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
}
function statusLabel(value: string) {
    return value === "ready" ? "就绪" : value === "pending" ? "处理中" : value === "failed" ? "失败" : value;
}
function storageLabel(value: string) {
    return value === "local" ? "服务器本地" : value === "aliyun" ? "阿里云 OSS" : value === "tencent" ? "腾讯云 COS" : value === "qiniu" ? "七牛云 Kodo" : value === "s3" ? "通用 S3" : value;
}
