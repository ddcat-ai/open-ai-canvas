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
import { useTranslation } from "react-i18next";
import { t as translate } from "@/i18n";
import { t } from "@/i18n";

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
    { label: t("assets:all"), value: "all" },
    { label: t("assets:text"), value: "text" },
    { label: t("assets:image"), value: "image" },
    { label: t("assets:video"), value: "video" },
    { label: t("assets:audio"), value: "audio" },
    { label: t("assets:3d-models"), value: "model" },
];

const categoryOptions = [
    { label: t("assets:all-categories"), value: "all" },
    { label: t("assets:role"), value: "character" },
    { label: t("assets:scenes"), value: "environment" },
    { label: t("assets:costumes"), value: "wardrobe" },
    { label: t("assets:props"), value: "prop" },
    { label: t("assets:weapons"), value: "weapon" },
    { label: t("assets:styles"), value: "style" },
    { label: t("assets:other"), value: "other" },
];

const assetKindIcons: Record<LibraryAsset["kind"], LucideIcon> = {
    text: FileText,
    image: ImageIcon,
    video: Clapperboard,
    audio: AudioLines,
    model: Box,
};

export default function AssetsPage() {
    const { t } = useTranslation("canvas");
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
        form.setFieldsValue({ kind: "text", category: "other", title: "", coverUrl: "", tags: [], source: t("assets:added-manually"), note: "", content: "" });
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
            status: editingAsset?.status || ("confirmed" as const),
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
                message.error(t("assets:choose-an-image-file"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets:asset-updated") : t("assets:asset-saved"));
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
        addAsset({
            kind: "model",
            title: file.name.replace(/\.(glb|gltf)$/i, ""),
            coverUrl: "",
            tags: [t("assets:3d-models-2")],
            source: t("assets:manual-upload"),
            data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name },
            metadata: { source: "manual" },
        });
        message.success(t("assets:3d-model-saved"));
    };

    const copyAssetText = async (asset: LibraryAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets:text-copied"));
    };

    const downloadImage = (asset: LibraryAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const extension = asset.kind === "model" ? asset.data.fileName.split(".").pop() || "glb" : asset.data.mimeType.split("/")[1] || "png";
        saveAs(url, `${asset.title || "asset"}.${extension}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets:no-assets-to-export"));
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
            message.success(t("assets:imported-param-assets", { length: importedAssets.length }));
        } catch {
            message.error(t("assets:import-failed-choose-a-valid-asset-archive"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        try {
            await deleteAssetWithRemoteSync(deletingAsset.id);
            message.success(t("assets:asset-deleted"));
            setDeletingAsset(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assets:failed-to-delete-asset"));
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
            message.success(t("assets:deleted-param-assets", { length: selectedAssets.length }));
            setSelectedIds([]);
            setBatchDeleteOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assets:batch-delete-failed"));
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page">
                <div className="studio-band">
                    <PageHeader
                        title={t("assets:asset-library")}
                        description={t("assets:manage-text-image-video-audio-and-3d-model-assets")}
                        meta={
                            <span className="app-projects-header-meta assets-header-meta">
                                {validAssets.length} {t("assets:assets-2")}
                            </span>
                        }
                        actions={
                            <div className="assets-header-actions">
                                <div className="assets-header-action-buttons">
                                    <Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={openCreate}>
                                        {t("assets:new-asset-3")}
                                    </Button>
                                    <Button icon={<FolderOpen className="size-3.5" />} onClick={() => navigate("/plugins/eagle")}>
                                        {t("assets:eagle-library")}
                                    </Button>
                                    <Button title={t("assets:export-all-assets")} aria-label={t("assets:export-all-assets")} icon={<Download className="size-4" />} onClick={() => void exportAllAssets()} />
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            items: [
                                                { key: "package", icon: <FileUp className="size-4" />, label: t("assets:import-asset-archive-2"), onClick: () => assetInputRef.current?.click() },
                                                { key: "model", icon: <Upload className="size-4" />, label: t("assets:upload-3d-model"), onClick: () => modelInputRef.current?.click() },
                                            ],
                                        }}
                                    >
                                        <Button title={t("assets:import-assets")} aria-label={t("assets:import-assets")} icon={<FileUp className="size-4" />} />
                                    </Dropdown>
                                </div>
                                <AssetStorageUsage />
                            </div>
                        }
                    />
                    <ListToolbar
                        className="library-toolbar"
                        active={Boolean(keyword || kindFilter !== "all" || categoryFilter !== "all")}
                        onReset={() => {
                            setKeyword("");
                            setKindFilter("all");
                            setCategoryFilter("all");
                            setPage(1);
                        }}
                    >
                        <Input
                            allowClear
                            className="w-full sm:w-80"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("assets:search-titles-content-tags-or-source")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                        />
                    </ListToolbar>
                </div>

                <div className="canvas-library-frame assets-library-frame">
                    <div className="grid min-h-0 gap-4 lg:grid-cols-[176px_minmax(0,1fr)]">
                        <aside className="thin-scrollbar flex gap-2 overflow-x-auto py-3 lg:sticky lg:top-0 lg:block lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-3">
                            <AssetFilterGroup
                                title={t("assets:asset-type")}
                                options={kindOptions}
                                value={kindFilter}
                                counts={kindCounts}
                                onChange={(value) => {
                                    setKindFilter(value as AssetKind | "all");
                                    setPage(1);
                                }}
                            />
                            <AssetFilterGroup
                                title={t("assets:category")}
                                options={categoryOptions}
                                value={categoryFilter}
                                counts={categoryCounts}
                                onChange={(value) => {
                                    setCategoryFilter(value as AssetCategory | "all");
                                    setPage(1);
                                }}
                                className="lg:mt-5"
                            />
                        </aside>
                        <section className="min-w-0">
                            {selectedAssets.length ? (
                                <AssetsBatchBar
                                    count={selectedAssets.length}
                                    allSelected={allFilteredSelected}
                                    onSelectAll={() => setSelectedIds((current) => Array.from(new Set([...current, ...filteredAssetIds])))}
                                    onClear={() => setSelectedIds([])}
                                    onExport={() => void exportSelectedAssets()}
                                    onDelete={() => setBatchDeleteOpen(true)}
                                />
                            ) : null}
                            {validAssets.length === 0 ? (
                                <AssetsEmptyState onNew={openCreate} onImport={() => assetInputRef.current?.click()} onGoCanvas={() => navigate("/canvas")} />
                            ) : (
                                <>
                                    {filteredAssets.length === 0 ? (
                                        <WorkspaceState icon="assets" compact title={t("assets:no-matching-assets")} description={t("assets:adjust-the-keywords-or-category-on-the-left-and-try-again")} />
                                    ) : (
                                        <CollectionGrid className="library-grid assets-library-grid">
                                            {canCreateAsset ? (
                                                <button type="button" className="library-create-card" onClick={openCreate}>
                                                    <span className="library-create-cover">
                                                        <Plus className="size-8" />
                                                    </span>
                                                    <span className="library-create-title">{t("assets:new-asset-3")}</span>
                                                    <span className="library-create-meta">{t("assets:text-image-audio-video-or-model")}</span>
                                                </button>
                                            ) : null}
                                            {visibleAssets.map((asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    selected={selectedIds.includes(asset.id)}
                                                    onSelect={(selected) => setSelectedIds((current) => (selected ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id)))}
                                                    onOpen={() => setPreviewAsset(asset)}
                                                    onEdit={() => openEdit(asset)}
                                                    onCopy={copyAssetText}
                                                    onDownload={downloadImage}
                                                    onDelete={() => setDeletingAsset(asset)}
                                                />
                                            ))}
                                        </CollectionGrid>
                                    )}
                                    <PaginationBar
                                        current={page}
                                        pageSize={pageSize}
                                        total={filteredAssets.length}
                                        pageSizeOptions={[20, 40, 80]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </>
                            )}
                        </section>
                    </div>
                </div>
            </WorkspacePage>

            <Modal
                className="workspace-modal workspace-modal-wide library-modal"
                title={editingAsset ? t("assets:edit-asset") : t("assets:new-asset-3")}
                open={isAssetOpen}
                onCancel={() => setIsAssetOpen(false)}
                onOk={() => void saveAsset()}
                okText={t("assets:save")}
                cancelText={t("assets:cancel")}
                destroyOnHidden
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", category: "other", tags: [] }}>
                        <Form.Item name="kind" label={t("assets:type")}>
                            <Select
                                options={[
                                    { label: t("assets:text"), value: "text" },
                                    { label: t("assets:image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="category" label={t("assets:category")}>
                            <Select options={categoryOptions.slice(1)} />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets:title")} rules={[{ required: true, message: t("assets:enter-a-title") }]}>
                            <Input placeholder={t("assets:give-the-asset-an-easily-searchable-name")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets:cover-url")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets:paste-an-image-url-or-upload-a-local-cover")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("assets:upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets:tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets:type-a-tag-and-press-enter")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets:source")}>
                                <Input placeholder={t("assets:manual-canvas-task-center")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets:notes-2")}>
                                <Input placeholder={t("assets:optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets:text-content")} rules={[{ required: true, message: t("assets:enter-text-content") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets:save-prompts-notes-reference-descriptions-and-other-text-assets")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets:image-content")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets:choose-an-image-file-2")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs" title={resourceStorageTitle(imageDraft.storageKey)}>
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)} · {resourceStorageLabel(imageDraft.storageKey)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets:no-image-selected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="lg:pl-4">
                        <Typography.Text strong className="text-xs">
                            {t("assets:preview")}
                        </Typography.Text>
                        <div className="mt-2 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets:no-cover-yet")}</div>
                            )}
                            <div className="bg-background p-3">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets:untitled-asset")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets:untagged")}</Tag>
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
            <input
                ref={modelInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(event) => {
                    void readModelFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />

            <Modal
                className="library-modal library-confirm-modal"
                title={t("assets:delete-asset")}
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={() => void confirmDelete()}
                okText={t("assets:delete-2")}
                okButtonProps={{ danger: true }}
                cancelText={t("assets:cancel")}
            >
                {t("assets:confirm-deleting")}
                {deletingAsset?.title}
                {t("assets:server-side-or-object-storage-files-not-referenced-by-other-content-will")}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={t("assets:batch-delete-assets")}
                open={batchDeleteOpen}
                onCancel={() => setBatchDeleteOpen(false)}
                onOk={() => void confirmBatchDelete()}
                okText={t("assets:delete-2")}
                okButtonProps={{ danger: true }}
                cancelText={t("assets:cancel")}
            >
                {t("assets:confirm-deleting-the-selected")} {selectedAssets.length} {t("assets:assets-unused-server-files-are-deleted-too-assets-still-used-by-canvases")}
            </Modal>
        </>
    );
}

function AssetCard({
    asset,
    selected,
    onSelect,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onDelete,
}: {
    asset: LibraryAsset;
    selected: boolean;
    onSelect: (selected: boolean) => void;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation("canvas");
    const summary = assetSummary(asset);
    const menuItems: MenuProps["items"] = [
        ...(asset.kind === "text" || asset.kind === "image" ? [{ key: "edit", icon: <PencilLine className="size-3.5" />, label: t("assets:edit"), onClick: onEdit }] : []),
        ...(asset.kind === "text" ? [{ key: "copy", icon: <Copy className="size-3.5" />, label: t("assets:copy-text-2"), onClick: () => void onCopy(asset) }] : []),
        ...(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? [{ key: "download", icon: <Download className="size-3.5" />, label: t("assets:download"), onClick: () => onDownload(asset) }] : []),
        { type: "divider" as const },
        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: t("assets:delete-2"), onClick: onDelete },
    ];
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} onSelect={onSelect} onOpen={onOpen} menuItems={menuItems} />
            <button type="button" className="block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={onOpen}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={asset.title}>
                        {asset.title}
                    </h2>
                    <span className="shrink-0 text-[var(--fs-tiny)] tabular-nums text-foreground/38">{formatAssetTime(asset.updatedAt)}</span>
                </div>
                <div className="mt-1 truncate text-[var(--fs-label)] text-foreground/52" title={summary}>
                    {summary}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/38">
                    <span className="truncate">{asset.source || t("assets:no-source-recorded")}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{assetProjectLabel(asset)}</span>
                </div>
            </button>
        </AssetLibraryCard>
    );
}

function AssetCover({ asset, selected, onSelect, onOpen, menuItems }: { asset: LibraryAsset; selected: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; menuItems: MenuProps["items"] }) {
    const { t } = useTranslation("canvas");
    const KindIcon = assetKindIcons[asset.kind];
    const clock = asset.kind === "video" || asset.kind === "audio" ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={t("assets:view-asset-param", { title: asset.title })}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "text" ? (
                    <TextCover asset={asset} />
                ) : asset.kind === "model" ? (
                    <ModelCover asset={asset} />
                ) : (
                    <AssetMediaPreview
                        asset={asset}
                        alt={asset.title}
                        className="assets-cover-media"
                        fallback={
                            <div className="assets-cover-fallback">
                                <KindIcon className="size-7" />
                            </div>
                        }
                    />
                )}
                <span className="assets-cover-vignette" aria-hidden="true" />
                {showPlay ? (
                    <span className="assets-cover-play">
                        <Play className="size-4" />
                    </span>
                ) : null}
            </button>
            <span className="assets-cover-badges">
                <span className="assets-cover-badge is-kind">
                    <KindIcon />
                    {assetKindLabel(asset.kind)}
                </span>
                <span className="assets-cover-badge is-category">{assetCategoryLabel(asset.category)}</span>
            </span>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="assets-select-check" aria-label={t("assets:select-param", { title: asset.title })} />
            <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                <button type="button" className="assets-cover-more" aria-label={t("assets:more-asset-actions")} title={t("assets:more-actions")}>
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
            {bars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
            ))}
            <AudioLines className="assets-cover-wave-glyph" />
        </div>
    );
}

function TextCover({ asset }: { asset: LibraryAsset & { kind: "text" } }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="assets-cover-text">
            <p>{asset.data.content || t("assets:blank-text-asset")}</p>
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
    const { t } = useTranslation("canvas");
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label={t("assets:batch-actions")}>
            <span className="assets-batch-count">
                {t("assets:selected")} <strong>{count}</strong> {t("assets:assets-2")}
            </span>
            <div className="assets-batch-actions">
                <Button size="small" icon={<CheckCheck className="size-3.5" />} disabled={allSelected} onClick={onSelectAll}>
                    {t("assets:select-all")}
                </Button>
                <Button size="small" onClick={onClear}>
                    {t("assets:deselect-all")}
                </Button>
                <Button size="small" icon={<Download className="size-3.5" />} onClick={onExport}>
                    {t("assets:export")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("assets:delete-2")}
                </Button>
            </div>
        </div>
    );
}

const assetsEmptyBannerFrames = [
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: t("assets:asset-01-rooftop-reunion") },
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: t("assets:asset-02-neon-rain-night") },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: t("assets:asset-03-alley-chase") },
];

function AssetsEmptyState({ onNew, onImport, onGoCanvas }: { onNew: () => void; onImport: () => void; onGoCanvas: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="assets-empty">
            <div className="assets-empty-banner" aria-hidden="true">
                {assetsEmptyBannerFrames.map((frame, index) => (
                    <figure key={frame.caption} className={`assets-empty-banner-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                        <img src={frame.src} alt="" loading="lazy" decoding="async" />
                        <span>{frame.caption}</span>
                    </figure>
                ))}
                <span className="assets-empty-banner-caption">
                    <span>{t("assets:yingce-asset-library")}</span>
                    {t("assets:archive-every-generation-into-reusable-assets")}
                </span>
            </div>
            <div className="assets-empty-cards">
                <button type="button" className="assets-empty-card" onClick={onNew}>
                    <span className="assets-empty-card-icon">
                        <Plus />
                    </span>
                    <strong>{t("assets:new-asset-4")}</strong>
                    <span>{t("assets:enter-prompts-and-notes-or-upload-image-assets")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onImport}>
                    <span className="assets-empty-card-icon">
                        <FileUp />
                    </span>
                    <strong>{t("assets:import-asset-archive-2")}</strong>
                    <span>{t("assets:restore-old-assets-from-an-archive-in-one-click-and-keep-creating")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onGoCanvas}>
                    <span className="assets-empty-card-icon">
                        <Clapperboard />
                    </span>
                    <strong>{t("assets:save-from-canvas")}</strong>
                    <span>{t("assets:archive-shots-and-frames-you-like-from-the-canvas-into-the-asset-library")}</span>
                </button>
            </div>
        </div>
    );
}

function AssetFilterGroup({
    title,
    options,
    value,
    counts,
    onChange,
    className = "",
}: {
    title: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    counts: Map<string, number>;
    onChange: (value: string) => void;
    className?: string;
}) {
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
    const { t } = useTranslation("canvas");
    const facts = asset ? assetArchiveFacts(asset) : [];
    const KindIcon = asset ? assetKindIcons[asset.kind] : Clapperboard;
    return (
        <Drawer className="library-drawer" title={t("assets:asset-archive")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <span className="asset-archive-header-icon">
                            <KindIcon />
                        </span>
                        <div className="min-w-0">
                            <h2 className="asset-archive-title">{asset.title}</h2>
                            <p className="asset-archive-subtitle">
                                {assetCategoryLabel(asset.category)} · {formatAssetDateTime(asset.createdAt)} {t("assets:create-2")}
                            </p>
                        </div>
                    </div>
                    <div className="asset-archive-preview">
                        {asset.kind === "text" ? (
                            <div className="asset-archive-preview-note">{asset.data.content}</div>
                        ) : asset.kind === "audio" ? (
                            <div className="asset-archive-audio">
                                <audio src={asset.data.url} controls />
                            </div>
                        ) : asset.kind === "model" ? (
                            <div className="asset-archive-preview-model">
                                <Box />
                                <span>
                                    {asset.data.fileName} · {formatBytes(asset.data.bytes)}
                                </span>
                            </div>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="asset-archive-preview-media" />
                        ) : (
                            <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="asset-archive-preview-media" />
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {(asset.tags || []).map((tag) => (
                            <Tag key={tag} className="m-0">
                                {tag}
                            </Tag>
                        ))}
                        <StorageTag asset={asset} />
                    </div>
                    <div className="asset-archive-facts">
                        {facts.map((fact) => (
                            <div key={fact.label} className="asset-archive-fact">
                                <span className="asset-archive-fact-label">{fact.label}</span>
                                <span className="asset-archive-fact-value" title={fact.value}>
                                    {fact.value}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="asset-archive-link">
                        <Link2 />
                        <span>{t("assets:project")}</span>
                        <strong>{assetProjectLabel(asset)}</strong>
                    </div>
                    {asset.note ? (
                        <div className="asset-archive-section">
                            <span className="asset-archive-section-title">{t("assets:notes-2")}</span>
                            <p className="asset-archive-section-body">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="asset-archive-actions">
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets:copy-text-2")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {assetDownloadLabel(asset)}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetArchiveFacts(asset: LibraryAsset) {
    const facts: Array<{ label: string; value: string }> = [
        { label: translate("assets:type"), value: assetKindLabel(asset.kind) },
        { label: translate("assets:category-2"), value: assetCategoryLabel(asset.category) },
    ];
    if (asset.kind === "image" || asset.kind === "video") {
        facts.push({ label: t("assets:size"), value: `${asset.data.width}x${asset.data.height}` });
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        facts.push({ label: translate("assets:duration"), value: formatAssetClock(asset.data.durationMs) || translate("assets:unknown") });
    }
    if (asset.kind !== "text") {
        facts.push({ label: translate("assets:file-size"), value: formatBytes(asset.data.bytes) });
        facts.push({ label: translate("assets:format"), value: asset.data.mimeType });
        facts.push({ label: translate("assets:storage"), value: resourceStorageLabel(asset.data.storageKey) });
    }
    facts.push({ label: translate("assets:source"), value: asset.source || translate("assets:not-labeled") });
    facts.push({ label: translate("assets:create-2"), value: formatAssetDateTime(asset.createdAt) });
    facts.push({ label: translate("assets:update"), value: formatAssetDateTime(asset.updatedAt) });
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
    return categoryOptions.find((item) => item.value === (category || "other"))?.label || translate("assets:other");
}

function assetProjectLabel(asset: LibraryAsset) {
    const projectName = asset.metadata?.projectName;
    if (typeof projectName === "string" && projectName.trim()) return projectName;
    return Array.isArray(asset.metadata?.projectIds) && asset.metadata.projectIds.length ? translate("assets:linked-to-project") : translate("assets:not-linked-to-a-project");
}

function assetKindLabel(kind: AssetKind) {
    return kind === "image" ? translate("assets:image") : kind === "video" ? translate("assets:video") : kind === "audio" ? translate("assets:audio") : kind === "model" ? translate("assets:3d-models") : translate("assets:text");
}

function assetDownloadLabel(asset: LibraryAsset) {
    if (asset.kind === "video") return translate("assets:download-video");
    if (asset.kind === "audio") return translate("assets:download-audio");
    if (asset.kind === "model") return translate("assets:download-model");
    return translate("assets:download-image");
}

function formatAssetDuration(durationMs?: number) {
    if (!durationMs) return translate("assets:unknown-duration");
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
