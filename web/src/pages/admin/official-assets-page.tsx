// 官方素材库管理员页面（迁移 v61）。
//
// 外壳与交互复用现有管理页写法（`plugins-page.tsx` 的范本）：
// `AdminPageFrame` + `AdminDataTable` + `PaginationBar`，筛选、确认弹窗、
// 错误提示全部走现有组件；不新增设计系统，不写死色值，只用现有 token 类。
//
// 本页不受官方素材库插件开关影响（草案 §4）：管理员停用插件后，用户侧
// 列表/导入返回“管理员已停用该插件”，但管理端仍可进入本页重新开放。
// 文件本身不经本页直接传给官方素材接口：先走现有 `uploadResourceFile`
// （`@/services/api/resources`，分片/直传两条路径）拿到 Resource ID，
// 再调创建/编辑接口；`resourceId` 也可手动填写已上传资源的 ID。
import { App, Button, Form, Input, InputNumber, Modal, Progress } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AudioLines, Box, CloudUpload, Eye, Image as ImageIcon, Pencil, RefreshCw, Search, Trash2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { ASSET_CATEGORY_OPTIONS, assetCategoryLabel, normalizeAssetCategory } from "@/lib/asset-category";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/base/select";
import {
    createOfficialAsset,
    deleteOfficialAsset,
    fetchAdminOfficialAssets,
    publishOfficialAsset,
    unpublishOfficialAsset,
    updateOfficialAsset,
    updateOfficialAssetSortOrder,
    type CreateOfficialAssetBody,
    type OfficialAsset,
    type OfficialAssetMediaType,
    type OfficialAssetStatus,
} from "@/services/api/official-assets";

import { AdminPageFrame } from "./components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "./components/admin-ui";

const STATUS_META: Record<OfficialAssetStatus, { label: string; tone: "neutral" | "success" | "warning" }> = {
    draft: { label: "草稿", tone: "neutral" },
    published: { label: "已发布", tone: "success" },
    unpublished: { label: "已下架", tone: "warning" },
};

const MEDIA_TYPE_LABELS: Record<OfficialAssetMediaType, string> = { image: "图片", video: "视频", audio: "音频", entity: "角色卡" };

function mediaTypeIcon(mediaType: OfficialAssetMediaType) {
    if (mediaType === "video") return <Video className="size-5" />;
    if (mediaType === "audio") return <AudioLines className="size-5" />;
    if (mediaType === "entity") return <Box className="size-5" />;
    return <ImageIcon className="size-5" />;
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDurationMs(value: number) {
    if (!value || value <= 0) return "";
    const totalSeconds = Math.round(value / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseTagsText(value: string) {
    return Array.from(new Set(value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean)));
}

type OfficialAssetFormValues = {
    resourceId: string;
    title: string;
    description?: string;
    mediaType: OfficialAssetMediaType;
    category: string;
    tagsText?: string;
    sourceName?: string;
    sourceUrl?: string;
    licenseNote?: string;
    usageNote?: string;
    sortOrder?: number;
};

export default function AdminOfficialAssetsPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<OfficialAssetFormValues>();
    const [items, setItems] = useState<OfficialAsset[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState("");
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [mediaType, setMediaType] = useState<OfficialAssetMediaType | "all">("all");
    const [category, setCategory] = useState("all");
    const [status, setStatus] = useState<OfficialAssetStatus | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<OfficialAsset | null>(null);
    const [formSaving, setFormSaving] = useState(false);
    const [preview, setPreview] = useState<OfficialAsset | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [search]);

    const reload = async () => {
        setLoading(true);
        try {
            const result = await fetchAdminOfficialAssets({
                page,
                pageSize,
                q: debouncedSearch || undefined,
                mediaType,
                category: category === "all" ? undefined : normalizeAssetCategory(category),
                status,
            });
            setItems(result.items);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取官方素材失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, debouncedSearch, mediaType, category, status]);

    const hasFilters = Boolean(debouncedSearch || mediaType !== "all" || category !== "all" || status !== "all");

    const resetFilters = () => {
        setSearch("");
        setDebouncedSearch("");
        setMediaType("all");
        setCategory("all");
        setStatus("all");
        setPage(1);
    };

    const openCreate = () => {
        setEditing(null);
        form.setFieldsValue({
            resourceId: "",
            title: "",
            description: "",
            mediaType: "image",
            category: "material",
            tagsText: "",
            sourceName: "",
            sourceUrl: "",
            licenseNote: "",
            usageNote: "",
            sortOrder: 0,
        });
        setUploadProgress(0);
        setFormOpen(true);
    };

    const openEdit = (record: OfficialAsset) => {
        setEditing(record);
        form.setFieldsValue({
            resourceId: record.resourceId,
            title: record.title,
            description: record.description,
            mediaType: record.mediaType,
            category: record.category,
            tagsText: record.tags.join("，"),
            sourceName: record.sourceName,
            sourceUrl: record.sourceUrl,
            licenseNote: record.licenseNote,
            usageNote: record.usageNote,
            sortOrder: record.sortOrder,
        });
        setUploadProgress(0);
        setFormOpen(true);
    };

    const handleUploadFile = async (file: File | null) => {
        if (!file || uploading) return;
        const kind: OfficialAssetMediaType | null = file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("image/")
              ? "image"
              : null;
        if (!kind) {
            message.error("只支持图片或视频文件");
            return;
        }
        setUploading(true);
        setUploadProgress(0);
        try {
            const resource = await uploadResourceFile(file, kind, { fileName: file.name }, (uploaded, totalBytes) => {
                setUploadProgress(totalBytes > 0 ? Math.round((uploaded / totalBytes) * 100) : 0);
            });
            form.setFieldsValue({ resourceId: resource.id, mediaType: kind });
            const currentTitle = String(form.getFieldValue("title") || "").trim();
            if (!currentTitle) {
                form.setFieldsValue({ title: file.name.replace(/\.[^.]+$/, "") });
            }
            message.success("文件已上传，可继续填写素材信息后保存");
        } catch (error) {
            // uploadResourceFile 已把分片/直传失败归一成 ResourceUploadError，
            // 这里只展示真实错误，不当成功。
            message.error(error instanceof Error ? error.message : "文件上传失败");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
            setUploading(false);
        }
    };

    const submitForm = async (values: OfficialAssetFormValues) => {
        const resourceId = values.resourceId.trim();
        if (!resourceId) {
            message.error("请先上传文件或填写资源 ID");
            return;
        }
        const body: CreateOfficialAssetBody = {
            resourceId,
            title: values.title.trim(),
            description: values.description?.trim() || "",
            mediaType: values.mediaType,
            category: normalizeAssetCategory(values.category),
            tags: parseTagsText(values.tagsText || ""),
            sourceName: values.sourceName?.trim() || "",
            sourceUrl: values.sourceUrl?.trim() || "",
            licenseNote: values.licenseNote?.trim() || "",
            usageNote: values.usageNote?.trim() || "",
            sortOrder: values.sortOrder ?? 0,
        };
        setFormSaving(true);
        try {
            if (editing) {
                await updateOfficialAsset(editing.id, body);
                message.success("官方素材已保存");
            } else {
                await createOfficialAsset(body);
                message.success("官方素材已创建为草稿，请发布后用户才可见");
            }
            setFormOpen(false);
            setPage(1);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setFormSaving(false);
        }
    };

    const runPublish = async (record: OfficialAsset) => {
        setSavingId(record.id);
        try {
            await publishOfficialAsset(record.id);
            message.success(`“${record.title}”已发布`);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发布失败");
        } finally {
            setSavingId("");
        }
    };

    const runUnpublish = (record: OfficialAsset) => {
        modal.confirm({
            title: `下架“${record.title}”？`,
            content: "下架后用户不能再浏览或新引用该素材。已有画布引用的访问仍在完善中，下架前请确认相关用户不再需要该素材。",
            okText: "确认下架",
            cancelText: "取消",
            onOk: async () => {
                setSavingId(record.id);
                try {
                    await unpublishOfficialAsset(record.id);
                    message.success(`“${record.title}”已下架`);
                    await reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "下架失败");
                    throw error;
                } finally {
                    setSavingId("");
                }
            },
        });
    };

    const runDelete = (record: OfficialAsset) => {
        modal.confirm({
            title: `删除草稿“${record.title}”？`,
            content: "仅未发布且未被任何用户导入的草稿可以删除；删除后不可恢复，但已上传的资源文件会保留。",
            okText: "确认删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                setSavingId(record.id);
                try {
                    await deleteOfficialAsset(record.id);
                    message.success("草稿已删除");
                    await reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                    throw error;
                } finally {
                    setSavingId("");
                }
            },
        });
    };

    const columns: ColumnsType<OfficialAsset> = [
        {
            title: "素材",
            key: "cover",
            width: 96,
            render: (_, record) => (
                <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                    <CachedResourceImage
                        storageKey={record.coverStorageKey}
                        alt={record.title}
                        eager
                        decoding="async"
                        className="h-full w-full object-cover"
                        fallback={
                            <div className="grid h-full w-full place-items-center text-foreground/40">
                                {mediaTypeIcon(record.mediaType)}
                            </div>
                        }
                    />
                    {record.mediaType === "video" && record.durationMs > 0 ? (
                        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] leading-4 text-white">
                            {formatDurationMs(record.durationMs)}
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            title: "标题",
            key: "title",
            render: (_, record) => (
                <div className="min-w-0">
                    <div className="truncate font-medium text-foreground" title={record.title}>
                        {record.title}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-foreground/52" title={record.description}>
                        {record.description || "—"}
                    </div>
                    {record.tags.length ? (
                        <div className="mt-0.5 truncate text-xs text-foreground/42" title={record.tags.join("、")}>
                            {record.tags.slice(0, 3).join("、")}
                            {record.tags.length > 3 ? ` +${record.tags.length - 3}` : ""}
                        </div>
                    ) : null}
                </div>
            ),
        },
        {
            title: "类型",
            key: "mediaType",
            width: 88,
            align: "center",
            render: (_, record) => <AdminStatusBadge label={MEDIA_TYPE_LABELS[record.mediaType]} tone="info" />,
        },
        {
            title: "分类",
            key: "category",
            width: 96,
            align: "center",
            render: (_, record) => assetCategoryLabel(record.category),
        },
        {
            title: "状态",
            key: "status",
            width: 96,
            align: "center",
            render: (_, record) => <AdminStatusBadge label={STATUS_META[record.status].label} tone={STATUS_META[record.status].tone} />,
        },
        {
            title: "排序",
            key: "sortOrder",
            width: 92,
            align: "center",
            render: (_, record) => (
                <SortOrderCell
                    key={`${record.id}:${record.sortOrder}`}
                    value={record.sortOrder}
                    disabled={savingId === record.id}
                    onSave={async (next) => {
                        if (next === record.sortOrder) return;
                        setSavingId(record.id);
                        try {
                            await updateOfficialAssetSortOrder(record.id, next);
                            message.success("排序已保存");
                            await reload();
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "保存排序失败");
                        } finally {
                            setSavingId("");
                        }
                    }}
                />
            ),
        },
        {
            title: "更新时间",
            key: "updatedAt",
            width: 168,
            render: (_, record) => <span className="text-foreground/68">{formatDateTime(record.updatedAt)}</span>,
        },
        {
            title: "操作",
            key: "actions",
            width: 208,
            align: "right",
            render: (_, record) => (
                <div className="flex items-center justify-end gap-1">
                    <Button type="text" size="small" icon={<Eye className="size-3.5" />} aria-label={`预览 ${record.title}`} onClick={() => setPreview(record)}>
                        预览
                    </Button>
                    <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label={`编辑 ${record.title}`} onClick={() => openEdit(record)}>
                        编辑
                    </Button>
                    {record.status === "published" ? (
                        <Button type="text" size="small" loading={savingId === record.id} onClick={() => runUnpublish(record)}>
                            下架
                        </Button>
                    ) : (
                        <Button type="text" size="small" loading={savingId === record.id} onClick={() => void runPublish(record)}>
                            发布
                        </Button>
                    )}
                    {record.status === "draft" ? (
                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={`删除草稿 ${record.title}`} onClick={() => runDelete(record)}>
                            删除
                        </Button>
                    ) : null}
                </div>
            ),
        },
    ];

    const paginated = items;

    return (
        <AdminPageFrame
            title="官方素材库"
            description="管理官方图片、视频素材：上传、编辑、发布、下架与排序。已发布素材对所有用户可见。"
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<CloudUpload className="size-4" />} onClick={openCreate}>
                        上传素材
                    </Button>
                </>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        className="app-list-search"
                        allowClear
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={search}
                        aria-label="搜索官方素材"
                        placeholder="搜索标题、介绍或标签"
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarFilters={
                    <>
                        <Select
                            aria-label="筛选媒体类型"
                            className="w-32"
                            value={mediaType}
                            onChange={(value) => {
                                setMediaType(value as OfficialAssetMediaType | "all");
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "全部类型" },
                                { value: "image", label: "图片" },
                                { value: "video", label: "视频" },
                            ]}
                        />
                        <Select
                            aria-label="筛选分类"
                            className="w-32"
                            value={category}
                            onChange={(value) => {
                                setCategory(String(value));
                                setPage(1);
                            }}
                            options={[{ value: "all", label: "全部分类" }, ...ASSET_CATEGORY_OPTIONS]}
                        />
                        <Select
                            aria-label="筛选状态"
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value as OfficialAssetStatus | "all");
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "全部状态" },
                                { value: "draft", label: "草稿" },
                                { value: "published", label: "已发布" },
                                { value: "unpublished", label: "已下架" },
                            ]}
                        />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={resetFilters}
                skeletonColumns={8}
                table={{
                    className: "app-data-table",
                    size: "small",
                    sticky: true,
                    rowKey: (item) => item.id,
                    loading,
                    columns,
                    dataSource: paginated,
                    pagination: false,
                    scroll: { x: 1120 },
                }}
                empty={<AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "还没有官方素材"} description={hasFilters ? undefined : "点右上角“上传素材”，先传文件再填信息，发布后用户才可见。"} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={total}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />

            <Modal
                title={editing ? `编辑官方素材` : "上传官方素材"}
                open={formOpen}
                destroyOnClose
                footer={null}
                width={640}
                onCancel={() => {
                    if (!formSaving && !uploading) setFormOpen(false);
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept="image/*,video/*"
                    onChange={(event) => void handleUploadFile(event.target.files?.[0] ?? null)}
                />
                <Form form={form} layout="vertical" onFinish={(values) => void submitForm(values)} initialValues={{ mediaType: "image", category: "material", sortOrder: 0 }}>
                    <Form.Item label="文件">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button icon={<CloudUpload className="size-4" />} loading={uploading} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                                {uploading ? "正在上传" : "选择图片或视频文件"}
                            </Button>
                            {uploading ? <Progress percent={uploadProgress} size="small" className="w-40" /> : null}
                            <span className="text-xs text-foreground/48">上传后自动填入资源 ID 与标题；也可直接填写已有资源的 ID。</span>
                        </div>
                    </Form.Item>
                    <Form.Item label="资源 ID" name="resourceId" rules={[{ required: true, message: "请先上传文件或填写资源 ID" }]}>
                        <Input placeholder="上传文件后自动填入，或粘贴已有资源的 ID" />
                    </Form.Item>
                    <Form.Item label="标题" name="title" rules={[{ required: true, message: "请填写标题" }, { max: 120, message: "标题最多 120 字" }]}>
                        <Input placeholder="给用户看的标题" maxLength={120} showCount />
                    </Form.Item>
                    <Form.Item label="介绍" name="description">
                        <Input.TextArea rows={2} placeholder="一句话介绍这份素材" maxLength={500} showCount />
                    </Form.Item>
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item label="媒体类型" name="mediaType" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { value: "image", label: "图片" },
                                    { value: "video", label: "视频" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item label="分类" name="category">
                            <Select options={ASSET_CATEGORY_OPTIONS} />
                        </Form.Item>
                        <Form.Item label="排序" name="sortOrder" tooltip="数字越小越靠前">
                            <InputNumber min={0} className="w-full" />
                        </Form.Item>
                    </div>
                    <Form.Item label="标签" name="tagsText" tooltip="多个标签用逗号分隔；最多 20 个，单个最多 40 字">
                        <Input placeholder="例如：夜景，城市，空镜" />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item label="来源" name="sourceName">
                            <Input placeholder="来源名称，如出彩官方" />
                        </Form.Item>
                        <Form.Item label="来源链接" name="sourceUrl">
                            <Input placeholder="https://…" />
                        </Form.Item>
                    </div>
                    <Form.Item label="版权说明" name="licenseNote">
                        <Input.TextArea rows={2} placeholder="版权归属与授权范围" maxLength={500} showCount />
                    </Form.Item>
                    <Form.Item label="使用说明" name="usageNote">
                        <Input.TextArea rows={2} placeholder="建议用法、适用场景" maxLength={500} showCount />
                    </Form.Item>
                    <div className="flex justify-end gap-2">
                        <Button disabled={formSaving || uploading} onClick={() => setFormOpen(false)}>
                            取消
                        </Button>
                        <Button type="primary" htmlType="submit" loading={formSaving} disabled={uploading}>
                            {editing ? "保存修改" : "创建草稿"}
                        </Button>
                    </div>
                </Form>
            </Modal>

            <Modal title={preview ? preview.title : ""} open={Boolean(preview)} footer={null} width={720} onCancel={() => setPreview(null)}>
                {preview ? (
                    <div className="grid gap-3">
                        <div className="overflow-hidden rounded-lg bg-muted">
                            {preview.mediaType === "video" ? (
                                <video className="max-h-96 w-full" controls preload="metadata" src={resourceFileUrl(preview.resourceId)} />
                            ) : preview.mediaType === "audio" ? (
                                <div className="grid min-h-32 place-items-center p-6"><audio className="w-full" controls preload="metadata" src={resourceFileUrl(preview.resourceId)} /></div>
                            ) : (
                                <CachedResourceImage
                                    storageKey={preview.coverStorageKey}
                                    alt={preview.title}
                                    eager
                                    className="max-h-96 w-full object-contain"
                                    fallback={
                                        <div className="grid h-48 place-items-center text-foreground/40">
                                            <ImageIcon className="size-8" />
                                        </div>
                                    }
                                />
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/52">
                            <AdminStatusBadge label={MEDIA_TYPE_LABELS[preview.mediaType]} tone="info" />
                            <AdminStatusBadge label={STATUS_META[preview.status].label} tone={STATUS_META[preview.status].tone} />
                            <span>{assetCategoryLabel(preview.category)}</span>
                            {preview.tags.map((tag) => (
                                <span key={tag} className="rounded-full bg-muted px-2 py-0.5">
                                    {tag}
                                </span>
                            ))}
                        </div>
                        {preview.description ? <p className="text-sm text-foreground/78">{preview.description}</p> : null}
                        <dl className="grid gap-1 text-sm">
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-foreground/48">来源</dt>
                                <dd className="min-w-0 truncate">
                                    {preview.sourceUrl ? (
                                        <a href={preview.sourceUrl} target="_blank" rel="noreferrer" className="text-foreground underline">
                                            {preview.sourceName || preview.sourceUrl}
                                        </a>
                                    ) : (
                                        preview.sourceName || "—"
                                    )}
                                </dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-foreground/48">版权说明</dt>
                                <dd>{preview.licenseNote || "—"}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-foreground/48">使用说明</dt>
                                <dd>{preview.usageNote || "—"}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-foreground/48">更新时间</dt>
                                <dd>{formatDateTime(preview.updatedAt)}</dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Modal>
        </AdminPageFrame>
    );
}

function SortOrderCell({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (next: number) => Promise<void> }) {
    const [current, setCurrent] = useState(value);
    useEffect(() => setCurrent(value), [value]);
    return (
        <InputNumber
            min={0}
            value={current}
            disabled={disabled}
            aria-label="排序"
            className="w-20"
            onChange={(next) => setCurrent(typeof next === "number" ? next : value)}
            onBlur={() => void onSave(current)}
            onPressEnter={() => void onSave(current)}
        />
    );
}
