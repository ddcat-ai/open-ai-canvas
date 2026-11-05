import { App, AutoComplete, Button, Form, Input, Progress } from "antd";
import type { ColumnsType } from "antd/es/table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CloudDownload, FileJson, Pencil, Plus, RefreshCw, RotateCcw, Search, Square, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Select } from "@/components/ui/base/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    bulkPoseLibraryItems,
    createPoseLibraryItem,
    deletePoseLibraryItem,
    importPoseLibrary,
    isAdultPoseSystem,
    listAdminPoseLibrary,
    poseLibraryFileUrl,
    previewPoseLibraryPack,
    syncPoseLibraryImages,
    updatePoseLibraryItem,
    POSE_LIBRARY_ANGLES,
    POSE_LIBRARY_DEFAULT_BASE_URL,
    POSE_LIBRARY_UPSTREAM_REPO,
    type AdminPoseLibraryItem,
    type AdminPoseLibrarySystem,
    type PoseLibraryBulkAction,
    type PoseLibraryPackPreview,
    type PoseLibraryStats,
} from "@/services/api/pose-library";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminDataTable, AdminRowActions, AdminStatTile, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";
import { AdminModal } from "../ui/overlays";
import { AdminCheckbox, AdminSwitch, Callout } from "../ui/controls";

const SYNC_BATCH = 12;
const statusLabels: Record<AdminPoseLibraryItem["status"], { label: string; tone: "success" | "warning" | "error" }> = {
    ready: { label: "已同步", tone: "success" },
    pending: { label: "待同步", tone: "warning" },
    failed: { label: "同步失败", tone: "error" },
};

type SyncProgress = { running: boolean; succeeded: number; failed: number; lastError?: string };

export default function PoseLibraryAdminPage() {
    const { message, modal } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [source, setSource] = useState("");
    const [system, setSystem] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const [importOpen, setImportOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<AdminPoseLibraryItem | null>(null);
    const [sync, setSync] = useState<SyncProgress | null>(null);
    const [liveStats, setLiveStats] = useState<PoseLibraryStats | null>(null);
    const syncAbortRef = useRef<AbortController | null>(null);
    const filtered = Boolean(debouncedKeyword || source || system || status);

    const query = useQuery({
        queryKey: ["admin", "pose-library", debouncedKeyword, source, system, status, page, pageSize],
        queryFn: ({ signal }) => listAdminPoseLibrary({ keyword: debouncedKeyword || undefined, source: source || undefined, system: system || undefined, status: status || undefined, page, pageSize }, signal),
        placeholderData: keepPreviousData,
    });
    const data = query.data;
    const stats = (sync?.running ? liveStats : null) || data?.stats;
    const systems = data?.systems || [];
    const sources = data?.sources || [];
    const sourceName = useMemo(() => new Map(sources.map((item) => [item.key, item.name])), [sources]);
    const reload = () => void query.refetch();

    const runSync = async (retryFailed: boolean) => {
        const controller = new AbortController();
        syncAbortRef.current = controller;
        const progress: SyncProgress = { running: true, succeeded: 0, failed: 0 };
        setSync({ ...progress });
        let retry = retryFailed;
        try {
            for (;;) {
                const result = await syncPoseLibraryImages({ limit: SYNC_BATCH, retryFailed: retry }, controller.signal);
                retry = false;
                progress.succeeded += result.succeeded;
                progress.failed += result.failed;
                if (result.failures?.length) progress.lastError = `${result.failures[0].name}：${result.failures[0].message}`;
                setLiveStats(result.stats);
                setSync({ ...progress });
                if (result.processed === 0 || result.stats.pending === 0) break;
            }
            message.success(`同步完成：成功 ${progress.succeeded} 张${progress.failed ? `，失败 ${progress.failed} 张` : ""}`);
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "图片同步失败");
        } finally {
            syncAbortRef.current = null;
            setSync({ ...progress, running: false });
            reload();
        }
    };

    const runBulk = (action: PoseLibraryBulkAction, target: AdminPoseLibrarySystem) => {
        const verb = { enable: "启用", disable: "停用", delete: "删除", resync: "放回待同步" }[action];
        const execute = async () => {
            try {
                const result = await bulkPoseLibraryItems({ action, sourceKey: target.sourceKey, system: target.system });
                message.success(`已${verb} ${result.affected} 条`);
                reload();
            } catch (error) {
                message.error(error instanceof Error ? error.message : `批量${verb}失败`);
            }
        };
        if (action !== "delete") return void execute();
        modal.confirm({
            title: `删除「${target.system}」的 ${target.total} 条姿势？`,
            content: "会同时删除本站已同步的图片文件；用户已插入画布的姿势图是各自的副本，不受影响。需要时可重新导入。",
            okText: "确认删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: execute,
        });
    };

    const toggleEnabled = async (item: AdminPoseLibraryItem, enabled: boolean) => {
        try {
            await updatePoseLibraryItem(item.id, { enabled });
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新失败");
        }
    };

    const remove = async (item: AdminPoseLibraryItem) => {
        try {
            await deletePoseLibraryItem(item.id);
            message.success("姿势已删除");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const columns: ColumnsType<AdminPoseLibraryItem> = [
        {
            title: "图片",
            width: 76,
            render: (_, item) =>
                item.status === "ready" ? (
                    <img className="h-14 w-[42px] rounded-[var(--radius-sm)] bg-[var(--library-cover-surface)] object-contain" src={poseLibraryFileUrl(item)} alt={item.name} loading="lazy" />
                ) : (
                    <span className="grid h-14 w-[42px] place-items-center rounded-[var(--radius-sm)] bg-[var(--library-cover-surface)] text-[var(--fs-label)] text-[var(--text-tertiary)]">—</span>
                ),
        },
        {
            title: "姿势",
            render: (_, item) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">
                        {item.code ? <span className="mr-2 font-mono text-xs text-[var(--text-tertiary)]">{item.code}</span> : null}
                        {item.name}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                        {item.system} · {item.category} · {sourceName.get(item.sourceKey) || item.sourceKey}
                    </div>
                </div>
            ),
        },
        { title: "视角", dataIndex: "angle", width: 80, align: "center" },
        {
            title: "同步",
            width: 110,
            align: "center",
            render: (_, item) => <AdminStatusBadge label={statusLabels[item.status]?.label || item.status} tone={statusLabels[item.status]?.tone} title={item.error || undefined} />,
        },
        { title: "启用", width: 80, align: "center", render: (_, item) => <AdminSwitch size="sm" checked={item.enabled} aria-label={`启用 ${item.name}`} onChange={(checked) => void toggleEnabled(item, checked)} /> },
        {
            title: "操作",
            width: 170,
            align: "center",
            render: (_, item) => (
                <AdminRowActions
                    primary={{ label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => setEditing(item) }}
                    actions={[
                        {
                            key: "delete",
                            label: "删除",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: `删除「${item.name}（${item.angle}）」？`, description: "本站保存的图片一并删除，用户画布里已插入的副本不受影响。", okText: "确认删除" },
                            onClick: () => remove(item),
                        },
                    ]}
                />
            ),
        },
    ];

    const readyPercent = stats?.total ? Math.round((stats.ready / stats.total) * 100) : 0;
    return (
        <AdminPageFrame
            title="姿势库"
            description="画布「姿势库」的数据来源。代码仓库不带任何姿势图片：站长导入元数据后，把图片同步到本站数据目录。"
            actions={
                <div className="flex flex-wrap gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={query.isFetching && !sync?.running} onClick={reload}>
                        刷新
                    </Button>
                    <Button icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                        新增姿势
                    </Button>
                    <Button type="primary" icon={<FileJson className="size-4" />} onClick={() => setImportOpen(true)}>
                        导入数据
                    </Button>
                </div>
            }
        >
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <AdminStatTile label="姿势图总数" value={stats?.total ?? "—"} detail={stats?.disabled ? `${stats.disabled} 张已停用` : undefined} />
                <AdminStatTile label="已同步" value={stats?.ready ?? "—"} detail={stats?.total ? `${readyPercent}%` : undefined} />
                <AdminStatTile label="待同步" value={stats?.pending ?? "—"} />
                <AdminStatTile label="同步失败" value={stats?.failed ?? "—"} />
            </section>

            <section className="rounded-[var(--card-radius)] bg-[var(--library-surface)] p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">图片同步</div>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">服务器按导入时填写的来源地址下载缩略图和原图，保存到数据目录 pose-library/。每批 {SYNC_BATCH} 条，可随时停止，下次继续。</p>
                    </div>
                    {sync?.running ? (
                        <Button icon={<Square className="size-3.5" />} onClick={() => syncAbortRef.current?.abort()}>
                            停止
                        </Button>
                    ) : (
                        <>
                            {stats?.failed ? (
                                <Button icon={<RotateCcw className="size-4" />} onClick={() => void runSync(true)}>
                                    重试失败（{stats.failed}）
                                </Button>
                            ) : null}
                            <Button type="primary" icon={<CloudDownload className="size-4" />} disabled={!stats?.pending} onClick={() => void runSync(false)}>
                                同步图片{stats?.pending ? `（${stats.pending}）` : ""}
                            </Button>
                        </>
                    )}
                </div>
                {stats?.total ? (
                    <div className="mt-3">
                        <Progress percent={readyPercent} status={sync?.running ? "active" : undefined} format={() => `${stats.ready}/${stats.total}`} />
                    </div>
                ) : null}
                {sync ? (
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">
                        {sync.running ? "同步中" : "上次同步"}：成功 {sync.succeeded}，失败 {sync.failed}
                        {sync.lastError ? ` · 最近错误：${sync.lastError}` : ""}
                    </p>
                ) : null}
            </section>

            {systems.length ? (
                <section className="rounded-[var(--card-radius)] bg-[var(--library-surface)] p-4">
                    <div className="mb-2 text-sm font-medium">按体系管理</div>
                    <div className="divide-y divide-[var(--border)]">
                        {systems.map((item) => (
                            <div key={`${item.sourceKey}:${item.system}`} className="flex flex-wrap items-center gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">
                                        {item.system}
                                        {isAdultPoseSystem(item.system) ? (
                                            <span className="ml-2">
                                                <AdminStatusBadge label="成人向" tone="warning" />
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="text-xs text-[var(--text-secondary)]">
                                        {sourceName.get(item.sourceKey) || item.sourceKey} · 共 {item.total} · 已同步 {item.ready} · 启用 {item.enabled}
                                    </div>
                                </div>
                                <Button size="small" disabled={item.enabled === item.total} onClick={() => runBulk("enable", item)}>
                                    全部启用
                                </Button>
                                <Button size="small" disabled={item.enabled === 0} onClick={() => runBulk("disable", item)}>
                                    全部停用
                                </Button>
                                {item.sourceKey !== "custom" ? (
                                    <Button size="small" title="数据目录丢失或来源图片更新后，放回待同步再点「同步图片」" onClick={() => runBulk("resync", item)}>
                                        重新同步
                                    </Button>
                                ) : null}
                                <Button size="small" danger onClick={() => runBulk("delete", item)}>
                                    删除
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}

            <AdminDataTable<AdminPoseLibraryItem>
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索名称、分类或编号"
                        aria-label="搜索姿势"
                        onValueChange={(value) => {
                            setKeyword(value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActive={filtered}
                toolbarFilters={
                    <>
                        <Select
                            ariaLabel="来源"
                            className="w-52"
                            value={source}
                            options={[{ value: "", label: "全部来源" }, ...sources.map((item) => ({ value: item.key, label: item.name }))]}
                            onChange={(value: string) => {
                                setSource(value);
                                setPage(1);
                            }}
                        />
                        <Select
                            ariaLabel="体系"
                            className="w-48"
                            value={system}
                            options={[{ value: "", label: "全部体系" }, ...Array.from(new Set(systems.map((item) => item.system))).map((name) => ({ value: name, label: name }))]}
                            onChange={(value: string) => {
                                setSystem(value);
                                setPage(1);
                            }}
                        />
                        <Select
                            ariaLabel="同步状态"
                            className="w-32"
                            value={status}
                            options={[
                                { value: "", label: "全部状态" },
                                { value: "ready", label: "已同步" },
                                { value: "pending", label: "待同步" },
                                { value: "failed", label: "同步失败" },
                            ]}
                            onChange={(value: string) => {
                                setStatus(value);
                                setPage(1);
                            }}
                        />
                    </>
                }
                onReset={() => {
                    setKeyword("");
                    setSource("");
                    setSystem("");
                    setStatus("");
                    setPage(1);
                }}
                empty={<AdminTableEmpty filtered={filtered} title={filtered ? "没有匹配的姿势" : "还没有导入姿势"} description={filtered ? "调整筛选条件后重试。" : "点击右上角「导入数据」，上传 ai-pose-gallery-zh 的 data/pose-zh.json。"} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={data?.total || 0}
                        onChange={(next, size) => {
                            setPage(size !== pageSize ? 1 : next);
                            setPageSize(size);
                        }}
                    />
                }
                table={{ rowKey: "id", dataSource: data?.items || [], columns, loading: query.isLoading, pagination: false, size: "small", scroll: { x: 860 } }}
            />

            <PoseLibraryImportModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={() => {
                    setImportOpen(false);
                    reload();
                }}
            />
            <PoseLibraryItemModal
                open={createOpen}
                systems={systems}
                onClose={() => setCreateOpen(false)}
                onSaved={() => {
                    setCreateOpen(false);
                    reload();
                }}
            />
            <PoseLibraryItemModal
                open={Boolean(editing)}
                item={editing || undefined}
                systems={systems}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    reload();
                }}
            />
        </AdminPageFrame>
    );
}

function PoseLibraryImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PoseLibraryPackPreview | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [baseUrl, setBaseUrl] = useState(POSE_LIBRARY_DEFAULT_BASE_URL);
    const [error, setError] = useState("");
    const [importing, setImporting] = useState(false);

    const reset = () => {
        setFile(null);
        setPreview(null);
        setSelected(new Set());
        setBaseUrl(POSE_LIBRARY_DEFAULT_BASE_URL);
        setError("");
        if (inputRef.current) inputRef.current.value = "";
    };

    const choose = async (next: File | undefined) => {
        setError("");
        setPreview(null);
        setFile(next || null);
        if (!next) return;
        try {
            const parsed = previewPoseLibraryPack(await next.text());
            setPreview(parsed);
            setSelected(new Set(parsed.systems.filter((item) => !isAdultPoseSystem(item.name)).map((item) => item.name)));
            setBaseUrl(parsed.baseUrl || (parsed.format === "ai-pose-gallery-zh" ? POSE_LIBRARY_DEFAULT_BASE_URL : ""));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "文件无法解析");
        }
    };

    const submit = async () => {
        if (!file || !preview || !selected.size) return;
        setImporting(true);
        try {
            const result = await importPoseLibrary({ file, baseUrl, systems: Array.from(selected) });
            message.success(`导入完成：新增 ${result.created}，更新 ${result.updated}${result.skipped ? `，跳过 ${result.skipped}` : ""}。接下来点击「同步图片」。`);
            if (result.invalid?.length) message.warning(result.invalid.join("；"));
            reset();
            onImported();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "导入失败");
        } finally {
            setImporting(false);
        }
    };

    const selectedCount = preview?.systems.filter((item) => selected.has(item.name)).reduce((sum, item) => sum + item.count, 0) || 0;
    const close = () => {
        if (importing) return;
        reset();
        onClose();
    };
    return (
        <AdminModal
            title="导入姿势数据"
            open={open}
            centered
            width="min(640px, calc(100vw - 32px))"
            keyboard={!importing}
            mask={{ closable: !importing }}
            styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflowY: "auto" } }}
            cancelText="取消"
            cancelButtonProps={{ disabled: importing }}
            okText={selectedCount ? `导入 ${selectedCount} 条` : "导入"}
            okButtonProps={{ disabled: !preview || !selected.size || !baseUrl.trim() }}
            confirmLoading={importing}
            onOk={() => void submit()}
            onCancel={close}
        >
            <div className="space-y-4">
                <Callout title="从 ai-pose-gallery-zh 导入">
                    <ol className="list-decimal space-y-1 pl-4">
                        <li>
                            打开{" "}
                            <a href={`${POSE_LIBRARY_UPSTREAM_REPO}/blob/main/data/pose-zh.json`} target="_blank" rel="noopener noreferrer">
                                data/pose-zh.json
                            </a>
                            ，点「Download raw file」下载（约 0.6 MB，只有元数据，不含图片）。
                        </li>
                        <li>在下面选择这个文件，勾选要导入的体系。成人向体系默认不勾选。</li>
                        <li>导入后回到列表点「同步图片」，服务器把图片下载到本站数据目录。</li>
                    </ol>
                    <p className="mt-2">也支持影策通用姿势包（format: yingce-pose-library），格式见文档「姿势库」。</p>
                </Callout>

                <div>
                    <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void choose(event.target.files?.[0])} />
                    <Button icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
                        {file ? "重新选择文件" : "选择 JSON 文件"}
                    </Button>
                    {file ? <span className="ml-3 text-sm text-[var(--text-secondary)]">{file.name}</span> : null}
                    {error ? (
                        <Callout tone="error" className="mt-2">
                            {error}
                        </Callout>
                    ) : null}
                </div>

                {preview ? (
                    <>
                        <div>
                            <div className="text-sm font-medium">{preview.sourceName}</div>
                            <div className="mt-1 text-xs text-[var(--text-secondary)]">共 {preview.total} 条，按体系选择：</div>
                            <div className="mt-2 space-y-2">
                                {preview.systems.map((item) => (
                                    <div key={item.name} className="flex items-center gap-2">
                                        <AdminCheckbox
                                            checked={selected.has(item.name)}
                                            onChange={(event) =>
                                                setSelected((current) => {
                                                    const next = new Set(current);
                                                    if (event.target.checked) next.add(item.name);
                                                    else next.delete(item.name);
                                                    return next;
                                                })
                                            }
                                        >
                                            {item.name}（{item.count}）
                                        </AdminCheckbox>
                                        {isAdultPoseSystem(item.name) ? <AdminStatusBadge label="成人向" tone="warning" /> : null}
                                    </div>
                                ))}
                            </div>
                            {preview.systems.some((item) => isAdultPoseSystem(item.name) && selected.has(item.name)) ? (
                                <Callout tone="warning" className="mt-3">
                                    已勾选成人向体系。导入后对站点所有登录用户可见，请确认符合本站用户协议和当地法规；之后也可在「按体系管理」里停用。
                                </Callout>
                            ) : null}
                        </div>
                        <div>
                            <div className="mb-1 text-sm font-medium">图片来源地址</div>
                            <Input value={baseUrl} placeholder="https://example.com/ai-pose-gallery-zh/" onChange={(event) => setBaseUrl(event.target.value)} />
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">JSON 里的 thumbs/…、img/… 会拼在这个地址后面下载。默认是作者演示站；服务器访问不了时，把仓库的 thumbs/ 和 img/ 目录传到自己的对象存储或静态站，再填那个地址。</p>
                        </div>
                    </>
                ) : null}
            </div>
        </AdminModal>
    );
}

type ItemFormValues = { name: string; system: string; category: string; angle: string; code: string };

function PoseLibraryItemModal({ open, item, systems, onClose, onSaved }: { open: boolean; item?: AdminPoseLibraryItem; systems: AdminPoseLibrarySystem[]; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<ItemFormValues>();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const systemOptions = Array.from(new Set(systems.map((entry) => entry.system))).map((value) => ({ value }));

    const save = async () => {
        const values = await form.validateFields();
        if (!item && !file) {
            message.warning("请选择姿势图片");
            return;
        }
        setSaving(true);
        try {
            if (item) await updatePoseLibraryItem(item.id, values);
            else if (file) await createPoseLibraryItem({ ...values, file });
            message.success(item ? "姿势已更新" : "姿势已新增");
            setFile(null);
            onSaved();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminModal
            title={item ? "编辑姿势" : "新增姿势"}
            open={open}
            okText="保存"
            cancelText="取消"
            confirmLoading={saving}
            onOk={() => void save()}
            onCancel={() => {
                if (saving) return;
                setFile(null);
                onClose();
            }}
            afterOpenChange={(visible) => {
                if (visible) form.setFieldsValue({ name: item?.name || "", system: item?.system || "站点自建", category: item?.category || "", angle: item?.angle || "正面", code: item?.code || "" });
            }}
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                {item ? null : (
                    <Form.Item label="姿势图片" extra="JPEG / PNG / WebP，20 MB 以内，建议白底素体全身图；缩略图自动生成。">
                        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
                        <Button icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {file ? file.name : "选择图片"}
                        </Button>
                    </Form.Item>
                )}
                <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请填写名称" }]}>
                    <Input maxLength={160} placeholder="例如：自然站立" />
                </Form.Item>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Form.Item name="system" label="体系" rules={[{ required: true, whitespace: true, message: "请填写体系" }]}>
                        <AutoComplete options={systemOptions} placeholder="例如：全身单人・标准系" />
                    </Form.Item>
                    <Form.Item name="category" label="分类" rules={[{ required: true, whitespace: true, message: "请填写分类" }]}>
                        <Input maxLength={80} placeholder="例如：站姿" />
                    </Form.Item>
                    <Form.Item name="angle" label="视角">
                        <Select options={POSE_LIBRARY_ANGLES.map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item name="code" label="编号" extra={item ? undefined : "编号相同的多张图合并为同一姿势的不同视角。"}>
                        <Input maxLength={40} placeholder="可选，例如 C001" />
                    </Form.Item>
                </div>
            </Form>
        </AdminModal>
    );
}
