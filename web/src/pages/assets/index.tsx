import { AudioLines, Box, CheckCheck, Clapperboard, Copy, Download, FileText, FileUp, FolderOpen, Image as ImageIcon, Link2, MoreHorizontal, PencilLine, Play, Plus, Search, Trash2, Upload, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Dropdown, Form, Input, Modal, Select, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { useNavigate } from "react-router";

import { CollectionGrid, ListToolbar, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { saveAs } from "file-saver";

import { useCopyText } from "@/hooks/use-copy-text";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { useAssetStore, type Asset, type AssetCategory, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { AssetStorageUsage, assetStorageUsageQueryKey } from "./asset-storage-usage";
import { deleteAssetWithRemoteSync } from "@/services/user-data-sync";


type LibraryAsset = Exclude<Asset, { kind: "entity" }>;

type AssetFormValues = {
    kind: AssetKind;
    category: AssetCategory;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
    { label: "3D 模型", value: "model" },
];

const categoryOptions = [
    { label: "全部分类", value: "all" },
    { label: "角色", value: "character" },
    { label: "场景", value: "environment" },
    { label: "服饰", value: "wardrobe" },
    { label: "道具", value: "prop" },
    { label: "武器", value: "weapon" },
    { label: "画风", value: "style" },
    { label: "其他", value: "other" },
];

const assetKindIcons: Record<LibraryAsset["kind"], LucideIcon> = {
    text: FileText,
    image: ImageIcon,
    video: Clapperboard,
    audio: AudioLines,
    model: Box,
};

export default function AssetsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);

    const updateAsset = useAssetStore((state) => state.updateAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [editingAsset, setEditingAsset] = useState<LibraryAsset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<LibraryAsset | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset): asset is LibraryAsset => asset.kind !== "entity"), [assets]);
    const selectedAssets = useMemo(() => validAssets.filter((asset) => selectedIds.includes(asset.id)), [selectedIds, validAssets]);
    const kindCounts = useMemo(() => new Map(kindOptions.map((option) => [option.value, option.value === "all" ? validAssets.length : validAssets.filter((asset) => asset.kind === option.value).length])), [validAssets]);
    const categoryCounts = useMemo(() => new Map(categoryOptions.map((option) => [option.value, option.value === "all" ? validAssets.length : validAssets.filter((asset) => (asset.category || "other") === option.value).length])), [validAssets]);
    const canCreateAsset = !keyword.trim() && kindFilter === "all" && categoryFilter === "all";

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (categoryFilter !== "all" && (asset.category || "other") !== categoryFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter, categoryFilter]);
    const filteredAssetIds = useMemo(() => filteredAssets.map((asset) => asset.id), [filteredAssets]);
    const allFilteredSelected = filteredAssetIds.length > 0 && filteredAssetIds.every((id) => selectedIds.includes(id));

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    useEffect(() => {
        const existingIds = new Set(validAssets.map((asset) => asset.id));
        setSelectedIds((current) => current.filter((id) => existingIds.has(id)));
    }, [validAssets]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", category: "other", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: LibraryAsset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            category: asset.category || "other",
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            category: values.category,
            status: editingAsset?.status || "confirmed" as const,
            primaryVersionId: editingAsset?.primaryVersionId,
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error("请选择图片文件");
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? "素材已更新" : "素材已保存");
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const readModelFile = async (file?: File) => {
        if (!file || !/\.(glb|gltf)$/i.test(file.name)) return;
        const uploaded = await uploadMediaFile(file, "model");
        void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
        addAsset({ kind: "model", title: file.name.replace(/\.(glb|gltf)$/i, ""), coverUrl: "", tags: ["3D模型"], source: "手动上传", data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name }, metadata: { source: "manual" } });
        message.success("3D 模型已保存");
    };

    const copyAssetText = async (asset: LibraryAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const downloadImage = (asset: LibraryAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const extension = asset.kind === "model" ? asset.data.fileName.split(".").pop() || "glb" : asset.data.mimeType.split("/")[1] || "png";
        saveAs(url, `${asset.title || "asset"}.${extension}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning("暂无素材可导出");
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(`已导入 ${importedAssets.length} 个素材`);
        } catch {
            message.error("导入失败，请选择有效的素材压缩包");
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        try {
            await deleteAssetWithRemoteSync(deletingAsset.id);
            message.success("素材已删除");
            setDeletingAsset(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材删除失败");
        }
    };

    const exportSelectedAssets = async () => {
        if (!selectedAssets.length) return;
        await exportAssets(selectedAssets);
    };

    const confirmBatchDelete = async () => {
        if (!selectedAssets.length) return;
        try {
            for (const asset of selectedAssets) await deleteAssetWithRemoteSync(asset.id);
            message.success(`已删除 ${selectedAssets.length} 个素材`);
            setSelectedIds([]);
            setBatchDeleteOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量删除失败");
        }
    };


    return (
        <>
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page">
            <div className="studio-band">
                <PageHeader
                    title="素材库"
                    description="管理文本、图片、视频、音频和 3D 模型素材。"
                    meta={<span className="app-projects-header-meta assets-header-meta">{validAssets.length} 个素材</span>}
                    actions={(
                        <div className="assets-header-actions">
                            <div className="assets-header-action-buttons">
                                <Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={openCreate}>新增素材</Button>
                                <Button icon={<FolderOpen className="size-3.5" />} onClick={() => navigate("/plugins/eagle")}>Eagle 素材库</Button>
                                <Button title="导出全部素材" aria-label="导出全部素材" icon={<Download className="size-4" />} onClick={() => void exportAllAssets()} />
                                <Dropdown trigger={["click"]} menu={{ items: [{ key: "package", icon: <FileUp className="size-4" />, label: "导入素材包", onClick: () => assetInputRef.current?.click() }, { key: "model", icon: <Upload className="size-4" />, label: "上传 3D 模型", onClick: () => modelInputRef.current?.click() }] }}>
                                    <Button title="导入素材" aria-label="导入素材" icon={<FileUp className="size-4" />} />
                                </Dropdown>
                            </div>
                            <AssetStorageUsage />
                        </div>
                    )}
                />
                <ListToolbar className="library-toolbar" active={Boolean(keyword || kindFilter !== "all" || categoryFilter !== "all")} onReset={() => { setKeyword(""); setKindFilter("all"); setCategoryFilter("all"); setPage(1); }}>
                    <Input allowClear className="w-full sm:w-80" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索标题、内容、标签或来源" onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                </ListToolbar>
            </div>

            <div className="canvas-library-frame assets-library-frame">
                <div className="grid min-h-0 gap-4 lg:grid-cols-[176px_minmax(0,1fr)]">
                    <aside className="thin-scrollbar flex gap-2 overflow-x-auto py-3 lg:sticky lg:top-0 lg:block lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-3">
                        <AssetFilterGroup title="素材类型" options={kindOptions} value={kindFilter} counts={kindCounts} onChange={(value) => { setKindFilter(value as AssetKind | "all"); setPage(1); }} />
                        <AssetFilterGroup title="业务分类" options={categoryOptions} value={categoryFilter} counts={categoryCounts} onChange={(value) => { setCategoryFilter(value as AssetCategory | "all"); setPage(1); }} className="lg:mt-5" />
                    </aside>
                    <section className="min-w-0">
                        {selectedAssets.length ? (
                            <AssetsBatchBar count={selectedAssets.length} allSelected={allFilteredSelected} onSelectAll={() => setSelectedIds((current) => Array.from(new Set([...current, ...filteredAssetIds])))} onClear={() => setSelectedIds([])} onExport={() => void exportSelectedAssets()} onDelete={() => setBatchDeleteOpen(true)} />
                        ) : null}
                        {validAssets.length === 0 ? (
                            <AssetsEmptyState onNew={openCreate} onImport={() => assetInputRef.current?.click()} onGoCanvas={() => navigate("/canvas")} />
                        ) : (
                            <>
                                {filteredAssets.length === 0 ? (
                                    <WorkspaceState icon="assets" compact title="没有匹配的素材" description="调整关键词或左侧分类后再试。" />
                                ) : (
                                    <CollectionGrid className="library-grid assets-library-grid">
                                        {canCreateAsset ? <button type="button" className="library-create-card" onClick={openCreate}>
                                            <span className="library-create-cover"><Plus className="size-8" /></span>
                                            <span className="library-create-title">新增素材</span>
                                            <span className="library-create-meta">文本、图片、音视频或模型</span>
                                        </button> : null}
                                        {visibleAssets.map((asset) => (
                                            <AssetCard key={asset.id} asset={asset} selected={selectedIds.includes(asset.id)} onSelect={(selected) => setSelectedIds((current) => selected ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id))} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                                        ))}
                                    </CollectionGrid>
                                )}
                                <PaginationBar current={page} pageSize={pageSize} total={filteredAssets.length} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
                            </>
                        )}
                    </section>
                </div>
            </div>
            </WorkspacePage>

            <Modal className="workspace-modal workspace-modal-wide library-modal" title={editingAsset ? "编辑素材" : "新增素材"} open={isAssetOpen} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText="保存" cancelText="取消" destroyOnHidden>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", category: "other", tags: [] }}>
                        <Form.Item name="kind" label="类型">
                            <Select
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="category" label="业务分类">
                            <Select options={categoryOptions.slice(1)} />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                                <Input placeholder="给素材起一个容易检索的名字" />
                        </Form.Item>
                        <Form.Item name="coverUrl" label="封面 URL">
                            <Space.Compact className="w-full">
                                <Input placeholder="可粘贴图片 URL，也可以上传本地封面" />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    上传
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label="来源">
                                <Input placeholder="手动添加 / 画布 / 任务中心" />
                            </Form.Item>
                            <Form.Item name="note" label="备注">
                                <Input placeholder="可选" />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本素材" />
                            </Form.Item>
                        ) : (
                            <Form.Item label="图片内容" required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        选择图片文件
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs" title={resourceStorageTitle(imageDraft.storageKey)}>
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)} · {resourceStorageLabel(imageDraft.storageKey)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            未选择图片
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="lg:pl-4">
                        <Typography.Text strong className="text-xs">预览</Typography.Text>
                        <div className="mt-2 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>
                            )}
                            <div className="bg-background p-3">
                                <Typography.Text strong ellipsis className="block">
                                    {title || "未命名素材"}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">未打标签</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <input ref={modelInputRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" className="hidden" onChange={(event) => { void readModelFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />

            <Modal className="library-modal library-confirm-modal" title="删除素材" open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => void confirmDelete()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除「{deletingAsset?.title}」吗？未被其他内容引用的服务器本地或对象存储文件也会同步删除；若仍被画布、任务或其他素材占用，本次删除将被阻止。
            </Modal>
            <Modal className="library-modal library-confirm-modal" title="批量删除素材" open={batchDeleteOpen} onCancel={() => setBatchDeleteOpen(false)} onOk={() => void confirmBatchDelete()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除已选择的 {selectedAssets.length} 个素材吗？未被复用的服务器文件会同步删除；仍被画布、任务或其他素材占用的素材会保留并提示具体来源。
            </Modal>
        </>
    );
}

function AssetCard({ asset, selected, onSelect, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: LibraryAsset; selected: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; onEdit: () => void; onCopy: (asset: LibraryAsset) => void; onDownload: (asset: LibraryAsset) => void; onDelete: () => void }) {
    const summary = assetSummary(asset);
    const menuItems: MenuProps["items"] = [
        ...(asset.kind === "text" || asset.kind === "image" ? [{ key: "edit", icon: <PencilLine className="size-3.5" />, label: "编辑", onClick: onEdit }] : []),
        ...(asset.kind === "text" ? [{ key: "copy", icon: <Copy className="size-3.5" />, label: "复制文本", onClick: () => void onCopy(asset) }] : []),
        ...(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? [{ key: "download", icon: <Download className="size-3.5" />, label: "下载", onClick: () => onDownload(asset) }] : []),
        { type: "divider" as const },
        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: onDelete },
    ];
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} onSelect={onSelect} onOpen={onOpen} menuItems={menuItems} />
            <button type="button" className="block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={onOpen}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={asset.title}>{asset.title}</h2>
                    <span className="shrink-0 text-[var(--fs-tiny)] tabular-nums text-foreground/38">{formatAssetTime(asset.updatedAt)}</span>
                </div>
                <div className="mt-1 truncate text-[var(--fs-label)] text-foreground/52" title={summary}>{summary}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/38">
                    <span className="truncate">{asset.source || "未标注来源"}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{assetProjectLabel(asset)}</span>
                </div>
            </button>
        </AssetLibraryCard>
    );
}

function AssetCover({ asset, selected, onSelect, onOpen, menuItems }: { asset: LibraryAsset; selected: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; menuItems: MenuProps["items"] }) {
    const KindIcon = assetKindIcons[asset.kind];
    const clock = asset.kind === "video" || asset.kind === "audio" ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={`查看素材：${asset.title}`}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "text" ? (
                    <TextCover asset={asset} />
                ) : asset.kind === "model" ? (
                    <ModelCover asset={asset} />
                ) : (
                    <AssetMediaPreview asset={asset} alt={asset.title} className="assets-cover-media" fallback={<div className="assets-cover-fallback"><KindIcon className="size-7" /></div>} />
                )}
                <span className="assets-cover-vignette" aria-hidden="true" />
                {showPlay ? <span className="assets-cover-play"><Play className="size-4" /></span> : null}
            </button>
            <span className="assets-cover-badges">
                <span className="assets-cover-badge is-kind"><KindIcon />{assetKindLabel(asset.kind)}</span>
                <span className="assets-cover-badge is-category">{assetCategoryLabel(asset.category)}</span>
            </span>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="assets-select-check" aria-label={`选择 ${asset.title}`} />
            <Dropdown
                trigger={["click"]}
                menu={{ items: menuItems }}
            >
                <button type="button" className="assets-cover-more" aria-label="更多素材操作" title="更多操作">
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </AssetLibraryCardMedia>
    );
}

function AudioWaveCover({ asset }: { asset: LibraryAsset & { kind: "audio" } }) {
    const bars = audioWaveBars(asset.id);
    return (
        <div className="assets-cover-wave" aria-hidden="true">
            {bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
            <AudioLines className="assets-cover-wave-glyph" />
        </div>
    );
}

function TextCover({ asset }: { asset: LibraryAsset & { kind: "text" } }) {
    return (
        <div className="assets-cover-text">
            <p>{asset.data.content || "空白文本素材"}</p>
        </div>
    );
}

function ModelCover({ asset }: { asset: LibraryAsset & { kind: "model" } }) {
    return (
        <div className="assets-cover-model">
            <Box />
            <span>{asset.data.fileName}</span>
        </div>
    );
}

function AssetsBatchBar({ count, allSelected, onSelectAll, onClear, onExport, onDelete }: { count: number; allSelected: boolean; onSelectAll: () => void; onClear: () => void; onExport: () => void; onDelete: () => void }) {
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label="批量操作">
            <span className="assets-batch-count">已选择 <strong>{count}</strong> 个素材</span>
            <div className="assets-batch-actions">
                <Button size="small" icon={<CheckCheck className="size-3.5" />} disabled={allSelected} onClick={onSelectAll}>全选</Button>
                <Button size="small" onClick={onClear}>取消选择</Button>
                <Button size="small" icon={<Download className="size-3.5" />} onClick={onExport}>导出</Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
            </div>
        </div>
    );
}

const assetsEmptyBannerFrames = [
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "ASSET.01 · 天台重逢" },
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "ASSET.02 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "ASSET.03 · 暗巷追逐" },
];

function AssetsEmptyState({ onNew, onImport, onGoCanvas }: { onNew: () => void; onImport: () => void; onGoCanvas: () => void }) {
    return (
        <div className="assets-empty">
            <div className="assets-empty-banner" aria-hidden="true">
                {assetsEmptyBannerFrames.map((frame, index) => (
                    <figure key={frame.caption} className={`assets-empty-banner-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                        <img src={frame.src} alt="" loading="lazy" decoding="async" />
                        <span>{frame.caption}</span>
                    </figure>
                ))}
                <span className="assets-empty-banner-caption"><span>影策素材库</span>把每次创作的结果，留档成可复用的资产</span>
            </div>
            <div className="assets-empty-cards">
                <button type="button" className="assets-empty-card" onClick={onNew}>
                    <span className="assets-empty-card-icon"><Plus /></span>
                    <strong>新建素材</strong>
                    <span>录入提示词、说明文案，或上传图片资产。</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onImport}>
                    <span className="assets-empty-card-icon"><FileUp /></span>
                    <strong>导入素材包</strong>
                    <span>从素材压缩包一键恢复旧资产，继续创作。</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onGoCanvas}>
                    <span className="assets-empty-card-icon"><Clapperboard /></span>
                    <strong>去画布保存</strong>
                    <span>把画布上满意的镜头与画面留档进素材库。</span>
                </button>
            </div>
        </div>
    );
}

function AssetFilterGroup({ title, options, value, counts, onChange, className = "" }: { title: string; options: Array<{ label: string; value: string }>; value: string; counts: Map<string, number>; onChange: (value: string) => void; className?: string }) {
    return (
        <div className={className}>
            <div className="mb-1.5 px-1 text-[var(--fs-tiny)] font-semibold uppercase tracking-[0.08em] text-foreground/38">{title}</div>
            <div className="flex gap-1.5 lg:block lg:space-y-0.5">
                {options.map((option) => {
                    const active = value === option.value;
                    return (
                        <button key={option.value} type="button" aria-pressed={active} className={`assets-filter-item ${active ? "is-active" : ""}`} onClick={() => onChange(option.value)}>
                            <span className="assets-filter-item-label">{option.label}</span>
                            <span className="assets-filter-count">{counts.get(option.value) || 0}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: LibraryAsset | null; onClose: () => void; onCopy: (asset: LibraryAsset) => void; onDownload: (asset: LibraryAsset) => void }) {
    const facts = asset ? assetArchiveFacts(asset) : [];
    const KindIcon = asset ? assetKindIcons[asset.kind] : Clapperboard;
    return (
        <Drawer className="library-drawer" title="素材档案" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <span className="asset-archive-header-icon"><KindIcon /></span>
                        <div className="min-w-0">
                            <h2 className="asset-archive-title">{asset.title}</h2>
                            <p className="asset-archive-subtitle">{assetCategoryLabel(asset.category)} · {formatAssetDateTime(asset.createdAt)} 创建</p>
                        </div>
                    </div>
                    <div className="asset-archive-preview">
                        {asset.kind === "text" ? (
                            <div className="asset-archive-preview-note">{asset.data.content}</div>
                        ) : asset.kind === "audio" ? (
                            <div className="asset-archive-audio"><audio src={asset.data.url} controls /></div>
                        ) : asset.kind === "model" ? (
                            <div className="asset-archive-preview-model"><Box /><span>{asset.data.fileName} · {formatBytes(asset.data.bytes)}</span></div>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="asset-archive-preview-media" />
                        ) : (
                            <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="asset-archive-preview-media" />
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {(asset.tags || []).map((tag) => (
                            <Tag key={tag} className="m-0">{tag}</Tag>
                        ))}
                        <StorageTag asset={asset} />
                    </div>
                    <div className="asset-archive-facts">
                        {facts.map((fact) => (
                            <div key={fact.label} className="asset-archive-fact">
                                <span className="asset-archive-fact-label">{fact.label}</span>
                                <span className="asset-archive-fact-value" title={fact.value}>{fact.value}</span>
                            </div>
                        ))}
                    </div>
                    <div className="asset-archive-link"><Link2 /><span>所属项目</span><strong>{assetProjectLabel(asset)}</strong></div>
                    {asset.note ? (
                        <div className="asset-archive-section">
                            <span className="asset-archive-section-title">备注</span>
                            <p className="asset-archive-section-body">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="asset-archive-actions">
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>复制文本</Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>{assetDownloadLabel(asset)}</Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetArchiveFacts(asset: LibraryAsset) {
    const facts: Array<{ label: string; value: string }> = [
        { label: "类型", value: assetKindLabel(asset.kind) },
        { label: "分类", value: assetCategoryLabel(asset.category) },
    ];
    if (asset.kind === "image" || asset.kind === "video") {
        facts.push({ label: "尺寸", value: `${asset.data.width}x${asset.data.height}` });
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        facts.push({ label: "时长", value: formatAssetClock(asset.data.durationMs) || "未知" });
    }
    if (asset.kind !== "text") {
        facts.push({ label: "大小", value: formatBytes(asset.data.bytes) });
        facts.push({ label: "格式", value: asset.data.mimeType });
        facts.push({ label: "存储", value: resourceStorageLabel(asset.data.storageKey) });
    }
    facts.push({ label: "来源", value: asset.source || "未标注" });
    facts.push({ label: "创建", value: formatAssetDateTime(asset.createdAt) });
    facts.push({ label: "更新", value: formatAssetDateTime(asset.updatedAt) });
    return facts;
}

function assetSummary(asset: LibraryAsset) {
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return `${formatAssetDuration(asset.data.durationMs)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    if (asset.kind === "model") return `${asset.data.fileName} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function StorageTag({ asset }: { asset: LibraryAsset }) {
    if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return null;
    const location = resourceStorageLocation(asset.data.storageKey);
    const color = location === "oss" ? "green" : location === "local" ? "gold" : "default";
    return (
        <Tag color={color} className="m-0 text-[var(--fs-label)]" title={resourceStorageTitle(asset.data.storageKey)}>
            {resourceStorageLabel(asset.data.storageKey)}
        </Tag>
    );
}

function assetSearchText(asset: LibraryAsset) {
    return [asset.title, asset.source || "", asset.note || "", assetCategoryLabel(asset.category), (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function assetCategoryLabel(category?: AssetCategory) {
    return categoryOptions.find((item) => item.value === (category || "other"))?.label || "其他";
}

function assetProjectLabel(asset: LibraryAsset) {
    const projectName = asset.metadata?.projectName;
    if (typeof projectName === "string" && projectName.trim()) return projectName;
    return Array.isArray(asset.metadata?.projectIds) && asset.metadata.projectIds.length ? "已关联项目" : "未关联项目";
}

function assetKindLabel(kind: AssetKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "model" ? "3D 模型" : "文本";
}

function assetDownloadLabel(asset: LibraryAsset) {
    if (asset.kind === "video") return "下载视频";
    if (asset.kind === "audio") return "下载音频";
    if (asset.kind === "model") return "下载模型";
    return "下载图片";
}

function formatAssetDuration(durationMs?: number) {
    if (!durationMs) return "时长未知";
    return `${Math.round(durationMs / 100) / 10} 秒`;
}

function formatAssetClock(durationMs?: number) {
    if (!durationMs || durationMs < 1000) return null;
    const total = Math.round(durationMs / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAssetTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatAssetDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function audioWaveBars(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const bars: number[] = [];
    for (let index = 0; index < 26; index += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        const random = hash / 233280;
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.55 + 1.2));
        bars.push(Math.round((0.18 + 0.82 * random * envelope) * 100));
    }
    return bars;
}
