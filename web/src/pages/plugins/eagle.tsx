import { ArrowLeft, ChevronDown, ChevronUp, Download, FileAudio, FileBox, FileImage, FileVideo, FolderOpen, FolderPlus, RefreshCw, Search, Settings2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { App, Button, Drawer, Empty, Input, Spin, Tag, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useNavigate } from "react-router";

import "@/lib/plugins/builtin";
import { createEagleAssetSource, EAGLE_DEFAULT_BASE_URL, eagleAssetPlugin } from "@/lib/plugins/builtin/eagle";
import type { ExternalAssetFolder, ExternalAssetItem } from "@/lib/plugins/plugin-types";
import type { Asset } from "@/stores/use-asset-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { CollectionGrid, ListToolbar, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import "./eagle.css";
import { useTranslation } from "react-i18next";

export default function EagleLibraryPage() {
    const { t } = useTranslation("canvas");
    const navigate = useNavigate();
    const { message } = App.useApp();
    const installations = usePluginStore((state) => state.installations);
    const hydrated = usePluginStore((state) => state.hydrated);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const installation = installations.find((item) => item.manifest.id === eagleAssetPlugin.manifest.id);
    const enabled = Boolean(installation?.enabled);
    const savedBaseUrl = installation?.config.baseUrl;
    const baseUrl = typeof savedBaseUrl === "string" && savedBaseUrl.trim() ? savedBaseUrl.trim() : EAGLE_DEFAULT_BASE_URL;
    const provider = useMemo(() => createEagleAssetSource(baseUrl), [baseUrl]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [folders, setFolders] = useState<ExternalAssetFolder[]>([]);
    const [items, setItems] = useState<ExternalAssetItem[]>([]);
    const [selectedFolder, setSelectedFolder] = useState("");
    const [keyword, setKeyword] = useState("");
    const [folderName, setFolderName] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(40);
    const [previewItem, setPreviewItem] = useState<ExternalAssetItem | null>(null);
    const [foldersExpanded, setFoldersExpanded] = useState(true);

    const treeData = useMemo<DataNode[]>(() => renderFolderNodes(folders), [folders]);
    const folderPath = useMemo(() => externalFolderPath(folders, selectedFolder), [folders, selectedFolder]);
    const currentFolder = folders.find((folder) => folder.id === selectedFolder);
    const visibleItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
    const totalBytes = useMemo(() => items.reduce((total, item) => total + (item.bytes || 0), 0), [items]);

    useEffect(() => {
        ensurePlugin(eagleAssetPlugin.manifest);
    }, [ensurePlugin]);

    const load = async (folderId = selectedFolder, search = keyword) => {
        setLoading(true);
        setError("");
        try {
            const [nextFolders, nextItems] = await Promise.all([provider.listFolders?.(), provider.list?.({ folderId: folderId || undefined, keyword: search.trim() || undefined, limit: 100, offset: 0 })]);
            setFolders(nextFolders || []);
            setItems(nextItems || []);
            setPage(1);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("plugins:failed-to-connect-to-eagle-make-sure-eagle-is-running"));
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!enabled) return;
        setSelectedFolder("");
        setKeyword("");
        void load("", "");
        // provider 随本机 API 地址变化；页面进入或配置变化时重新读取 Eagle。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, provider]);

    const handleFolderSelect = (nextFolder: string) => {
        const folderId = nextFolder === "root" ? "" : nextFolder;
        setSelectedFolder(folderId);
        setKeyword("");
        setPreviewItem(null);
        setPage(1);
        void load(folderId, "");
    };

    const handleCreateFolder = async () => {
        const name = folderName.trim();
        if (!name || !provider.createFolder || creatingFolder) return;
        setCreatingFolder(true);
        setError("");
        try {
            await provider.createFolder(name, selectedFolder || undefined);
            setFolderName("");
            message.success(t("plugins:created-folder-in") + (currentFolder?.name || t("plugins:eagle-library-2")) + t("plugins:item"));
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("plugins:failed-to-create-eagle-folder"));
        } finally {
            setCreatingFolder(false);
        }
    };

    const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        if (!files.length || !provider.uploadFile || working) return;
        setWorking(true);
        setError("");
        let uploaded = 0;
        try {
            for (const [index, file] of files.entries()) {
                setProgress(t("plugins:writing-to-eagle") + (index + 1) + "/" + files.length + "：" + file.name);
                await provider.uploadFile(file, selectedFolder || undefined);
                uploaded += 1;
            }
            message.success(t("plugins:written-to-eagle") + uploaded + t("plugins:files"));
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("plugins:failed-to-write-to-eagle"));
            if (uploaded) message.warning(t("plugins:written") + uploaded + t("plugins:files-remaining-files-incomplete"));
        } finally {
            setProgress("");
            setWorking(false);
        }
    };

    if (hydrated && !enabled) {
        return (
            <WorkspacePage grid className="library-page eagle-library-page">
                <PageHeader
                    title={t("plugins:eagle-library-2")}
                    description={t("plugins:use-eagle-as-an-external-asset-source-for-yingce-and-browse-manage-origi")}
                    actions={
                        <Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/assets")}>
                            {t("plugins:back-to-yingce-library")}
                        </Button>
                    }
                />
                <section className="mt-4 library-card-surface flex min-h-72 flex-col items-center justify-center rounded-[var(--r-xl)] px-6 py-10 text-center">
                    <span className="grid size-14 place-items-center rounded-[var(--r-lg)] bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)]">
                        <FolderOpen className="size-7" aria-hidden="true" />
                    </span>
                    <h2 className="mt-4 text-base font-semibold">{t("plugins:enable-the-eagle-source-first")}</h2>
                    <p className="mt-2 max-w-md text-sm leading-6 text-foreground/55">{t("plugins:once-enabled-eagle-s-own-folders-and-files-appear-here-directly-nothing")}</p>
                    <Button type="primary" className="mt-5" icon={<Settings2 className="size-4" />} onClick={() => navigate("/plugins")}>
                        {t("plugins:enable-in-plugin-center")}
                    </Button>
                </section>
            </WorkspacePage>
        );
    }

    return (
        <>
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page eagle-library-page">
                <div className="studio-band">
                    <PageHeader
                        title={t("plugins:eagle-library-2")}
                        description={t("plugins:eagle-is-an-external-asset-source-for-yingce-this-view-reuses-the-yingce")}
                        meta={<span className="app-projects-header-meta assets-header-meta">{error ? t("plugins:eagle-connection-error") : t("plugins:eagle-connected")}</span>}
                        actions={
                            <div className="assets-header-actions">
                                <div className="assets-header-action-buttons">
                                    <Button className="library-primary-action" type="primary" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()} disabled={working}>
                                        {t("plugins:write-assets")}
                                    </Button>
                                    <Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/assets")}>
                                        {t("plugins:yingce-asset-library")}
                                    </Button>
                                    <Button icon={<Settings2 className="size-3.5" />} onClick={() => navigate("/plugins")}>
                                        {t("plugins:plugin-settings")}
                                    </Button>
                                </div>
                            </div>
                        }
                    />
                    <ListToolbar
                        className="library-toolbar"
                        active={Boolean(keyword)}
                        onReset={() => {
                            setKeyword("");
                            setPage(1);
                            void load(selectedFolder, "");
                        }}
                        trailing={
                            <Button icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load()}>
                                {t("plugins:refresh")}
                            </Button>
                        }
                    >
                        <Input
                            allowClear
                            className="w-full sm:w-80"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("plugins:search-eagle-titles-tags-or-folders")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            onPressEnter={() => void load()}
                        />
                    </ListToolbar>
                </div>

                {error ? (
                    <div className="mt-3 flex items-start justify-between gap-3 rounded-[var(--r-lg)] bg-danger/[.08] px-4 py-3 text-sm text-danger" role="alert">
                        <span>{error}</span>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void load()}>
                            {t("plugins:retry")}
                        </Button>
                    </div>
                ) : null}

                <div className="canvas-library-frame assets-library-frame eagle-library-frame mt-4">
                    <div className="grid min-h-0 gap-4 lg:grid-cols-[176px_minmax(0,1fr)]">
                        <aside className="eagle-folder-sidebar thin-scrollbar flex gap-2 overflow-x-auto py-3 lg:sticky lg:top-0 lg:block lg:max-h-[calc(100vh-190px)] lg:overflow-y-auto lg:pr-3">
                            <div className="eagle-folder-sidebar-header">
                                <span className="text-[var(--fs-label)] font-semibold">{t("plugins:eagle-folders")}</span>
                                <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} aria-label={t("plugins:refresh-eagle-folders")} loading={loading} onClick={() => void load()} />
                            </div>
                            <button type="button" className={"assets-filter-item " + (selectedFolder === "" ? "is-active" : "")} aria-pressed={selectedFolder === ""} onClick={() => handleFolderSelect("root")}>
                                <span className="assets-filter-item-label">{t("plugins:all-assets-2")}</span>
                                <span className="assets-filter-count">{items.length}</span>
                            </button>
                            <div className="eagle-folder-sidebar-label">
                                <span>{t("plugins:folders")}</span>
                                <button type="button" className="eagle-folder-collapse" aria-expanded={foldersExpanded} aria-controls="eagle-folder-tree" onClick={() => setFoldersExpanded((expanded) => !expanded)}>
                                    {foldersExpanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
                                    <span className="sr-only">{foldersExpanded ? t("plugins:collapse-folders") : t("plugins:expand-folders")}</span>
                                </button>
                            </div>
                            {foldersExpanded ? (
                                treeData.length ? (
                                    <div id="eagle-folder-tree">
                                        <Tree className="eagle-folder-tree" blockNode selectable selectedKeys={selectedFolder ? [selectedFolder] : []} treeData={treeData} onSelect={(keys) => handleFolderSelect(String(keys[0] || "root"))} />
                                    </div>
                                ) : (
                                    <div className="eagle-folder-empty">{t("plugins:no-folders-in-eagle-yet")}</div>
                                )
                            ) : null}
                            <Button className="eagle-folder-create" icon={<FolderPlus className="size-3.5" />} onClick={() => setFolderName((value) => (value ? "" : t("plugins:new-folder")))}>
                                {t("plugins:new-folder-3")}
                            </Button>
                        </aside>

                        <section className="min-w-0">
                            <nav aria-label={t("plugins:eagle-folder-path")} className="mb-3 flex min-w-0 items-center gap-1 text-xs text-foreground/48">
                                <button type="button" className="truncate rounded px-1.5 py-1 hover:bg-surface-hover" onClick={() => handleFolderSelect("root")}>
                                    {t("plugins:eagle-library-2")}
                                </button>
                                {folderPath.map((folder) => (
                                    <span key={folder.id} className="contents">
                                        <span aria-hidden="true">/</span>
                                        <button type="button" className="truncate rounded px-1.5 py-1 font-medium text-foreground hover:bg-surface-hover" onClick={() => handleFolderSelect(folder.id)}>
                                            {folder.name}
                                        </button>
                                    </span>
                                ))}
                            </nav>

                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-base font-semibold">{currentFolder?.name || t("plugins:all-assets-2")}</h2>
                                        <span className="app-projects-header-meta">
                                            {items.length} {t("plugins:assets")}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-foreground/48">{currentFolder ? t("plugins:this-folder-is-managed-by-eagle-yingce-only-displays-and-invokes-it") : t("plugins:showing-all-files-from-the-eagle-library")}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button icon={<FolderPlus className="size-3.5" />} onClick={() => setFolderName((value) => (value ? "" : t("plugins:new-folder")))}>
                                        {t("plugins:new-folder-3")}
                                    </Button>
                                    <Button
                                        icon={<Download className="size-3.5" />}
                                        onClick={() => {
                                            const firstFile = visibleItems.find((item) => item.fileUrl);
                                            if (firstFile?.fileUrl) window.open(firstFile.fileUrl, "_blank", "noopener,noreferrer");
                                        }}
                                    >
                                        {t("plugins:download-current-file")}
                                    </Button>
                                </div>
                            </div>

                            {folderName ? (
                                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] bg-surface-secondary p-3">
                                    <Input
                                        autoFocus
                                        value={folderName}
                                        onChange={(event) => setFolderName(event.target.value)}
                                        onPressEnter={() => void handleCreateFolder()}
                                        placeholder={t("plugins:enter-folder-name")}
                                        className="min-w-48 flex-1"
                                        aria-label={t("plugins:new-folder-name")}
                                    />
                                    <Button type="primary" loading={creatingFolder} onClick={() => void handleCreateFolder()}>
                                        {t("plugins:create")}
                                    </Button>
                                    <Button onClick={() => setFolderName("")}>{t("plugins:cancel")}</Button>
                                </div>
                            ) : null}

                            {loading ? (
                                <div className="library-loading-grid grid min-h-64 place-items-center">
                                    <Spin tip={t("plugins:reading-eagle-files")} />
                                </div>
                            ) : items.length ? (
                                <>
                                    <CollectionGrid className="library-grid assets-library-grid eagle-assets-grid">
                                        {visibleItems.map((item) => (
                                            <EagleItemCard key={item.id} item={item} selected={previewItem?.id === item.id} onOpen={() => setPreviewItem(item)} />
                                        ))}
                                    </CollectionGrid>
                                    <PaginationBar
                                        current={page}
                                        pageSize={pageSize}
                                        total={items.length}
                                        pageSizeOptions={[20, 40, 80]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </>
                            ) : (
                                <div className="eagle-empty-state">
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("plugins:this-eagle-folder-has-no-files")} />
                                </div>
                            )}
                        </section>
                    </div>
                </div>

                <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => void handleUpload(event)} />
            </WorkspacePage>
            <EagleAssetDrawer item={previewItem} onClose={() => setPreviewItem(null)} totalBytes={totalBytes} />
        </>
    );
}

function EagleItemCard({ item, selected, onOpen }: { item: ExternalAssetItem; selected: boolean; onOpen: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <AssetLibraryCard selected={selected}>
            <AssetLibraryCardMedia className={item.kind === "image" || item.kind === "video" ? "assets-cover" : "assets-cover is-light"}>
                <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={t("plugins:view-eagle-asset") + item.title}>
                    {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.title} loading="lazy" decoding="async" className="assets-cover-media" />
                    ) : (
                        <div className="assets-cover-fallback">
                            <AssetKindIcon kind={item.kind} size="size-7" />
                        </div>
                    )}
                    <span className="assets-cover-vignette" aria-hidden="true" />
                </button>
                <span className="assets-cover-badges">
                    <span className="assets-cover-badge is-kind">
                        <AssetKindIcon kind={item.kind} size="size-3" />
                        {assetKindLabel(item.kind)}
                    </span>
                    <span className="assets-cover-badge is-category">Eagle</span>
                </span>
                {item.fileUrl ? (
                    <a href={item.fileUrl} download={item.title} target="_blank" rel="noreferrer" className="eagle-cover-download" aria-label={t("plugins:download-original") + item.title}>
                        <Download className="size-3.5" aria-hidden="true" />
                    </a>
                ) : null}
            </AssetLibraryCardMedia>
            <button type="button" className="block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={onOpen}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={item.title}>
                        {item.title}
                    </h2>
                    <span className="shrink-0 text-[var(--fs-tiny)] tabular-nums text-foreground/38">{formatBytes(item.bytes || 0)}</span>
                </div>
                <div className="mt-1 truncate text-[var(--fs-label)] text-foreground/52" title={item.folderPath?.join(" / ") || t("plugins:eagle-root")}>
                    {item.folderPath?.join(" / ") || t("plugins:eagle-root")}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/38">
                    <span className="truncate">{formatDimensions(item)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{t("plugins:eagle-originals")}</span>
                </div>
            </button>
        </AssetLibraryCard>
    );
}

function EagleAssetDrawer({ item, onClose, totalBytes }: { item: ExternalAssetItem | null; onClose: () => void; totalBytes: number }) {
    const { t } = useTranslation("canvas");
    return (
        <Drawer className="library-drawer" title={t("plugins:asset-archive")} open={Boolean(item)} size="large" onClose={onClose}>
            {item ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <span className="asset-archive-header-icon">
                            <AssetKindIcon kind={item.kind} size="size-5" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="asset-archive-title">{item.title}</h2>
                            <p className="asset-archive-subtitle">
                                {t("plugins:eagle-originals-2")} {item.folderPath?.join(" / ") || t("plugins:root")}
                            </p>
                        </div>
                    </div>
                    <div className="eagle-drawer-preview">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title} loading="lazy" decoding="async" /> : <AssetKindIcon kind={item.kind} size="size-9" />}</div>
                    <div className="grid gap-2">
                        <EagleFact label={t("plugins:type")} value={assetKindLabel(item.kind)} />
                        <EagleFact label={t("plugins:size")} value={formatDimensions(item)} />
                        <EagleFact label={t("plugins:file-size")} value={formatBytes(item.bytes || 0)} />
                        <EagleFact label={t("plugins:folder")} value={item.folderPath?.join(" / ") || t("plugins:eagle-root")} />
                        <EagleFact label={t("plugins:total-library-size")} value={formatBytes(totalBytes)} />
                    </div>
                    {item.tags?.length ? (
                        <div>
                            <Typography.Text strong className="text-xs">
                                {t("plugins:tags")}
                            </Typography.Text>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {item.tags.map((tag) => (
                                    <Tag key={tag} className="m-0">
                                        {tag}
                                    </Tag>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {item.description ? (
                        <div>
                            <Typography.Text strong className="text-xs">
                                {t("plugins:notes")}
                            </Typography.Text>
                            <p className="mt-2 text-sm leading-6 text-foreground/65">{item.description}</p>
                        </div>
                    ) : null}
                    {item.fileUrl ? (
                        <a href={item.fileUrl} download={item.title} target="_blank" rel="noreferrer" className="eagle-drawer-download inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium">
                            <Download className="size-4" aria-hidden="true" />
                            {t("plugins:download-eagle-original")}
                        </a>
                    ) : null}
                </div>
            ) : null}
        </Drawer>
    );
}

function EagleFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-secondary px-3 py-2 text-sm">
            <span className="text-foreground/48">{label}</span>
            <span className="max-w-[65%] truncate text-right font-medium" title={value}>
                {value}
            </span>
        </div>
    );
}

function AssetKindIcon({ kind, size = "size-5" }: { kind: Asset["kind"]; size?: string }) {
    if (kind === "image") return <FileImage className={size + " text-foreground/48"} aria-hidden="true" />;
    if (kind === "video") return <FileVideo className={size + " text-foreground/48"} aria-hidden="true" />;
    if (kind === "audio") return <FileAudio className={size + " text-foreground/48"} aria-hidden="true" />;
    return <FileBox className={size + " text-foreground/48"} aria-hidden="true" />;
}

function assetKindLabel(kind: Asset["kind"]) {
    const { t } = useTranslation("canvas");
    if (kind === "image") return t("plugins:image");
    if (kind === "video") return t("plugins:video");
    if (kind === "audio") return t("plugins:audio");
    if (kind === "model") return t("plugins:models");
    return t("plugins:files-2");
}

function formatBytes(bytes: number) {
    if (!bytes) return "—";
    if (bytes < 1024) return String(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDimensions(item: ExternalAssetItem) {
    if (item.width && item.height) return item.width + " × " + item.height;
    return item.mimeType || assetKindLabel(item.kind);
}

function renderFolderNodes(folders: ExternalAssetFolder[], parentId = ""): DataNode[] {
    return folders
        .filter((folder) => (folder.parentId || "") === parentId)
        .map((folder) => ({
            key: folder.id,
            title: (
                <span className="eagle-folder-tree-title" title={folder.name}>
                    {folder.name}
                </span>
            ),
            children: renderFolderNodes(folders, folder.id),
        }));
}

function externalFolderPath(folders: ExternalAssetFolder[], folderId: string) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result: ExternalAssetFolder[] = [];
    const seen = new Set<string>();
    let current = byId.get(folderId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        result.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return result;
}
