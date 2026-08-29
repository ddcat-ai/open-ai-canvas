import { Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { Check, ChevronDown, FileText, FolderOpen, HardDrive, Image as ImageIcon, LoaderCircle, Music2, Puzzle, Search, Upload, UserRound, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AssetLibraryCard } from "@/components/assets/asset-library-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { PaginationBar } from "@/components/layout/workspace-page";
import { cn } from "@/lib/utils";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import type { Asset } from "@/stores/use-asset-store";

export type AssetLibraryPickerItem = {
    id: string;
    title: string;
    category: string;
    kindLabel: string;
    asset?: Asset;
    imageUrl?: string;
    imageStorageKey?: string;
    imageFit?: "cover" | "contain";
    description?: string;
    searchText?: string;
    disabledReason?: string;
    folderId?: string;
    external?: ExternalAssetPickerReference;
};

export type AssetLibraryPickerFolder = {
    id: string;
    parentId?: string;
    name: string;
};

type Props = {
    open: boolean;
    items: AssetLibraryPickerItem[];
    categoryLabels: Record<string, string>;
    initialCategory?: string;
    initialFolderId?: string;
    folders?: AssetLibraryPickerFolder[];
    initialSelectedIds?: Iterable<string>;
    multiple?: boolean;
    title?: string;
    eyebrow?: string;
    confirmLabel?: (count: number) => string;
    emptyTitle?: string;
    emptyDescription?: string;
    footerNote?: string;
    loading?: boolean;
    pagination?: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void };
    folderActionLabel?: string;
    folderActionSource?: "local" | "all";
    upload?: {
        accept: string;
        description: string;
        onUpload: (files: FileList) => Promise<string[]>;
        external?: {
            accept: string;
            description: string;
            onUpload: (files: FileList, folderId?: string) => Promise<AssetLibraryPickerItem[]>;
        };
    };
    onClose: () => void;
    onConfirm: (ids: string[]) => Promise<void> | void;
    onFolderAction?: (folderId: string) => Promise<void> | void;
};

export function AssetLibraryPickerModal({
    open,
    items,
    categoryLabels,
    initialCategory = "all",
    initialFolderId = "all",
    folders = [],
    initialSelectedIds,
    multiple = true,
    title = "素材库",
    eyebrow = "参考内容",
    confirmLabel = (count) => `使用已选素材${count ? `（${count}）` : ""}`,
    emptyTitle = "这个分类还没有素材",
    emptyDescription = "换个分类后再试。",
    footerNote,
    loading = false,
    pagination,
    folderActionLabel = "将文件夹放到画布",
    folderActionSource = "all",
    upload,
    onClose,
    onConfirm,
    onFolderAction,
}: Props) {
    const [category, setCategory] = useState(initialCategory);
    const [folderId, setFolderId] = useState(initialFolderId);
    const [source, setSource] = useState<"local" | "plugin">("local");
    const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploadedItems, setUploadedItems] = useState<AssetLibraryPickerItem[]>([]);
    const [working, setWorking] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState("");
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const initialSelectedIdsRef = useRef(initialSelectedIds);
    const itemsRef = useRef(items);
    initialSelectedIdsRef.current = initialSelectedIds;
    const allItems = useMemo(() => {
        const known = new Set(items.map((item) => item.id));
        return [...items, ...uploadedItems.filter((item) => !known.has(item.id))];
    }, [items, uploadedItems]);
    itemsRef.current = allItems;
    const localItems = useMemo(() => allItems.filter((item) => !item.external), [allItems]);
    const pluginItems = useMemo(() => allItems.filter((item) => Boolean(item.external)), [allItems]);
    const hasPluginSource = useMemo(
        () => Object.keys(categoryLabels).some((value) => value.startsWith("external:")) || pluginItems.some((item) => item.category.startsWith("external:")),
        [categoryLabels, pluginItems],
    );
    const sourceItems = source === "plugin" ? pluginItems : localItems;
    const sourceFolders = source === "plugin" ? folders : [];
    const showCategories = source === "local" || !sourceFolders.length;
    const categories = useMemo(() => ["all", ...Array.from(new Set(sourceItems.map((item) => item.category || "other")))], [sourceItems]);
    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return sourceItems.filter((item) => {
            if (category !== "all" && item.category !== category) return false;
            if (folderId !== "all" && (item.folderId || "") !== folderId) return false;
            return !query || [item.title, item.searchText || "", item.description || ""].join(" ").toLowerCase().includes(query);
        });
    }, [category, folderId, keyword, sourceItems]);
    const selectedIds = useMemo(() => Array.from(selected).filter((id) => {
        const item = allItems.find((entry) => entry.id === id);
        return !item?.disabledReason;
    }), [allItems, selected]);

    useEffect(() => {
        if (!open) return;

        setFolderId(initialFolderId);
        setCategory(initialCategory);
        setSource("local");
        setKeyword("");
        setUploadedItems([]);
        const selectableIds = new Set(itemsRef.current.filter((item) => !item.disabledReason).map((item) => item.id));
        setSelected(new Set(Array.from(initialSelectedIdsRef.current || []).filter((id) => selectableIds.has(id))));
        setWorking(false);
        setUploadingCount(0);
        setError("");
    }, [initialCategory, initialFolderId, open]);

    useEffect(() => {
        if (category === "all" || categories.includes(category)) return;
        setCategory("all");
    }, [categories, category]);

    useEffect(() => {
        if (hasPluginSource || source === "local") return;
        setSource("local");
    }, [hasPluginSource, source]);

    const selectSource = (nextSource: "local" | "plugin") => {
        if (nextSource === "plugin" && !hasPluginSource) return;
        setSource(nextSource);
        setCategory("all");
        setFolderId("all");
        setError("");
    };

    const toggle = (item: AssetLibraryPickerItem) => {
        if (item.disabledReason || working) return;
        setError("");
        setSelected((current) => {
            if (!multiple) return current.has(item.id) ? new Set() : new Set([item.id]);
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
        });
    };

    const confirm = async () => {
        if (!selectedIds.length || working) return;
        setWorking(true);
        setError("");
        try {
            await onConfirm(selectedIds);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "素材操作失败，请重试");
        } finally {
            setWorking(false);
        }
    };

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length || working || (source === "local" && !upload) || (source === "plugin" && !upload?.external)) return;
        setWorking(true);
        setError("");
        setUploadingCount(files.length);
        try {
            if (source === "plugin") {
                const uploaded = await upload!.external!.onUpload(files, folderId === "all" ? undefined : folderId);
                setUploadedItems((current) => [...current, ...uploaded]);
                const ids = uploaded.map((item) => item.id);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            } else {
                const ids = await upload!.onUpload(files);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "素材上传失败，请重试");
        } finally {
            if (uploadInputRef.current) uploadInputRef.current.value = "";
            setWorking(false);
            setUploadingCount(0);
        }
    };

    const runFolderAction = async () => {
        if (!onFolderAction || folderId === "all" || working) return;
        setWorking(true);
        setError("");
        try {
            await onFolderAction(folderId);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "文件夹操作失败，请重试");
        } finally {
            setWorking(false);
        }
    };

    const countFor = (value: string) => value === "all" ? sourceItems.length : sourceItems.filter((item) => item.category === value).length;
    const sourceLabel = source === "plugin" ? "插件来源" : "本地素材";
    const sourceMenuItems: MenuProps["items"] = [
        { key: "local", icon: <HardDrive aria-hidden="true" />, label: <span className="asset-picker-source-menu-label"><span>本地素材</span><em>{localItems.length}</em></span> },
        ...(hasPluginSource ? [{ key: "plugin", icon: <Puzzle aria-hidden="true" />, label: <span className="asset-picker-source-menu-label"><span>插件来源</span><em>{pluginItems.length}</em></span> }] : []),
    ];
    const activeUpload = source === "plugin" ? upload?.external : upload;
    const uploading = uploadingCount > 0;

    return (
        <Modal
            open={open}
            footer={null}
            title={null}
            destroyOnHidden
            closable={!working}
            maskClosable={!working}
            keyboard={!working}
            onCancel={() => {
                if (!working) onClose();
            }}
            className="workspace-modal workspace-modal-wide asset-library-picker-modal"
            styles={{ container: { padding: 0 }, body: { padding: 0 } }}
        >
            <div className="asset-picker-shell">
                <header className="asset-picker-toolbar">
                    <div className="asset-picker-heading">
                        <div className="asset-picker-heading-copy">
                            <span>{eyebrow}</span>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomLeft"
                                rootClassName="asset-picker-source-dropdown"
                                onOpenChange={setSourceMenuOpen}
                                menu={{
                                    selectedKeys: [source],
                                    items: sourceMenuItems,
                                    onClick: ({ key }) => {
                                        if (key === "local" || key === "plugin") selectSource(key);
                                    },
                                }}
                            >
                                <button type="button" className="asset-picker-title-trigger" aria-haspopup="menu" aria-expanded={sourceMenuOpen} aria-label={"素材库来源：" + sourceLabel}>
                                    <strong>{title}</strong><ChevronDown aria-hidden="true" />
                                </button>
                            </Dropdown>
                        </div>
                    </div>
                    <label className="asset-picker-search"><Search aria-hidden /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材名称或标签" aria-label="搜索素材" /></label>
                    <span className="asset-picker-count">已选 {selectedIds.length} · {pagination ? pagination.total : visibleItems.length} 个素材</span>
                </header>
                <div className="asset-picker-body">
                    <nav className="asset-picker-categories" aria-label="素材分类">
                        {sourceFolders.length ? <><span className="asset-picker-nav-label">文件夹</span><button type="button" className={cn("assets-filter-item", folderId === "all" && "is-active")} aria-pressed={folderId === "all"} onClick={() => setFolderId("all")}><span className="assets-filter-item-label">全部文件夹</span><span className="assets-filter-count">{sourceItems.length}</span></button>{renderPickerFolders(sourceFolders, sourceItems, folderId, setFolderId)}</> : null}
                        {showCategories ? <><span className="asset-picker-nav-label">分类</span>{categories.map((value) => (
                            <button key={value} type="button" className={cn("assets-filter-item", category === value && "is-active")} aria-pressed={category === value} onClick={() => setCategory(value)}>
                                <span className="assets-filter-item-label">{categoryLabels[value] || "其他"}</span><span className="assets-filter-count">{countFor(value)}</span>
                            </button>
                        ))}</> : null}
                    </nav>
                    <div className="asset-picker-grid-wrap">
                        <div className="asset-picker-grid">
                            {loading ? (
                                <div className="asset-picker-empty"><LoaderCircle className="animate-spin" /><strong>正在读取素材</strong><span>素材会按页加载，不会一次下载整个项目库。</span></div>
                            ) : visibleItems.length ? visibleItems.map((item) => (
                                <PickerCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item)} />
                            )) : (
                                <div className="asset-picker-empty"><FolderOpen /><strong>{emptyTitle}</strong><span>{activeUpload ? "换个分类，或从底部上传一份新素材。" : emptyDescription}</span></div>
                            )}
                        </div>
                        {pagination ? <PaginationBar alwaysShow current={pagination.current} pageSize={pagination.pageSize} total={pagination.total} itemLabel="项" pageSizeOptions={[20, 40, 80]} onChange={pagination.onChange} /> : null}
                    </div>
                </div>
                <footer className={cn("asset-picker-footer", !activeUpload && "is-compact")}>
                    {activeUpload ? (
                        <>
                            <input ref={uploadInputRef} type="file" hidden accept={activeUpload.accept} multiple={multiple} onChange={(event) => void handleUpload(event.target.files)} />
                            <button type="button" className="asset-picker-upload" onClick={() => uploadInputRef.current?.click()} disabled={working} aria-busy={uploading}>
                                {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                                <span><strong>{uploading ? `正在上传 ${uploadingCount} 个素材` : "上传新素材"}</strong><small>{uploading ? "保存完成后会自动选中" : activeUpload.description}</small></span>
                            </button>
                        </>
                    ) : footerNote ? <span className="asset-picker-footer-note">{footerNote}</span> : <span />}
                    {error ? <span className="asset-picker-footer-error" role="alert">{error}</span> : null}
                    <div className="asset-picker-actions">
                        {onFolderAction && folderId !== "all" && (folderActionSource !== "local" || source === "local") ? <Button type="text" icon={<FolderOpen />} disabled={working} onClick={() => void runFolderAction()}>{folderActionLabel}</Button> : null}
                        <Button type="text" onClick={onClose} disabled={working}>取消</Button>
                        <Button type="primary" icon={<Check />} disabled={working || !selectedIds.length} loading={working && !uploading} onClick={() => void confirm()}>
                            {confirmLabel(selectedIds.length)}
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function PickerCard({ item, selected, onToggle }: { item: AssetLibraryPickerItem; selected: boolean; onToggle: () => void }) {
    const disabled = Boolean(item.disabledReason);
    return (
        <AssetLibraryCard selected={selected} className={cn("asset-picker-card", disabled && "is-disabled")}>
            <button type="button" className="asset-picker-card-action" onClick={onToggle} disabled={disabled} aria-pressed={selected} title={item.disabledReason || item.title}>
                <div className="assets-cover asset-picker-card-media">
                    {item.imageUrl || item.imageStorageKey ? <CachedResourceImage storageKey={item.imageStorageKey} src={item.imageUrl} alt={item.title} loading="lazy" decoding="async" className={item.imageFit === "contain" ? "is-contain" : undefined} fallback={<div className="assets-cover-fallback">{kindIcon(item.kindLabel)}</div>} /> : <AssetMediaPreview asset={item.asset} alt={item.title} fallback={<div className="assets-cover-fallback">{kindIcon(item.kindLabel)}</div>} />}
                    <span className="assets-cover-vignette" aria-hidden="true" />
                    <span className="assets-cover-badges" aria-hidden="true">
                        <span className="assets-cover-badge is-kind">{item.kindLabel}</span></span>
                    <span className="asset-picker-card-check" aria-hidden="true"><Check /></span>
                    {item.disabledReason ? <span className="asset-picker-card-lock">{item.disabledReason}</span> : null}
                </div>
                <div className="asset-picker-card-copy"><strong>{item.title || "未命名素材"}</strong>{item.description ? <span>{item.description}</span> : null}</div>
            </button>
        </AssetLibraryCard>
    );
}

function renderPickerFolders(folders: AssetLibraryPickerFolder[], items: AssetLibraryPickerItem[], selectedId: string, onSelect: (folderId: string) => void, parentId = "", depth = 0, visited: ReadonlySet<string> = new Set()): ReactNode {
    if (depth >= 8) return null;
    return folders.filter((folder) => (folder.parentId || "") === parentId && !visited.has(folder.id)).map((folder) => {
        const nextVisited = new Set(visited).add(folder.id);
        return (
            <span key={folder.id} className="contents">
                <button type="button" className={cn("assets-filter-item", selectedId === folder.id && "is-active")} aria-pressed={selectedId === folder.id} onClick={() => onSelect(folder.id)} style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}>
                    <span className="assets-filter-item-label" title={folder.name}>{folder.name}</span><span className="assets-filter-count">{items.filter((item) => item.folderId === folder.id).length}</span>
                </button>
                {renderPickerFolders(folders, items, selectedId, onSelect, folder.id, depth + 1, nextVisited)}
            </span>
        );
    });
}

function kindIcon(label: string): ReactNode {
    if (label.includes("角色")) return <UserRound />;
    if (label.includes("视频")) return <Video />;
    if (label.includes("音频")) return <Music2 />;
    if (label.includes("文本")) return <FileText />;
    return <ImageIcon />;
}
