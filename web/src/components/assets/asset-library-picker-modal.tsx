import { Button, Modal } from "antd";
import { Check, FileText, FolderOpen, Image as ImageIcon, LoaderCircle, Music2, Search, Upload, UserRound, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { cn } from "@/lib/utils";
import type { Asset } from "@/stores/use-asset-store";

export type AssetLibraryPickerItem = {
    id: string;
    title: string;
    category: string;
    kindLabel: string;
    asset?: Asset;
    imageUrl?: string;
    imageFit?: "cover" | "contain";
    description?: string;
    searchText?: string;
    disabledReason?: string;
    folderId?: string;
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
    folderActionLabel?: string;
    upload?: {
        accept: string;
        description: string;
        onUpload: (files: FileList) => Promise<string[]>;
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
    folderActionLabel = "将文件夹放到画布",
    upload,
    onClose,
    onConfirm,
    onFolderAction,
}: Props) {
    const [category, setCategory] = useState(initialCategory);
    const [folderId, setFolderId] = useState(initialFolderId);
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [working, setWorking] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState("");
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const initialSelectedIdsRef = useRef(initialSelectedIds);
    const itemsRef = useRef(items);
    initialSelectedIdsRef.current = initialSelectedIds;
    itemsRef.current = items;
    const categories = useMemo(() => ["all", ...Array.from(new Set(items.map((item) => item.category || "other")))], [items]);
    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return items.filter((item) => {
            if (category !== "all" && item.category !== category) return false;
            if (folderId !== "all" && (item.folderId || "") !== folderId) return false;
            return !query || [item.title, item.searchText || "", item.description || ""].join(" ").toLowerCase().includes(query);
        });
    }, [category, folderId, items, keyword]);
    const selectedIds = useMemo(
        () => items.filter((item) => !item.disabledReason && selected.has(item.id)).map((item) => item.id),
        [items, selected],
    );

    useEffect(() => {
        if (!open) return;
        setCategory(initialCategory);
        setFolderId(initialFolderId);
        setKeyword("");
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
        if (!upload || !files?.length || working) return;
        setWorking(true);
        setError("");
        setUploadingCount(files.length);
        try {
            const ids = await upload.onUpload(files);
            if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
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

    const countFor = (value: string) => value === "all" ? items.length : items.filter((item) => item.category === value).length;
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
                    <div className="asset-picker-heading"><span>{eyebrow}</span><strong>{title}</strong></div>
                    <label className="asset-picker-search"><Search aria-hidden /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材名称或标签" aria-label="搜索素材" /></label>
                    <span className="asset-picker-count">已选 {selectedIds.length} · {visibleItems.length} 个素材</span>
                </header>
                <div className="asset-picker-body">
                    <nav className="asset-picker-categories" aria-label="素材分类">
                        {folders.length ? <><span className="asset-picker-nav-label">文件夹</span><button type="button" className={folderId === "all" ? "is-active" : ""} aria-pressed={folderId === "all"} onClick={() => setFolderId("all")}><span>全部文件夹</span><em>{items.length}</em></button>{renderPickerFolders(folders, items, folderId, setFolderId)}<span className="asset-picker-nav-label">分类</span></> : null}
                        {categories.map((value) => (
                            <button key={value} type="button" className={category === value ? "is-active" : ""} aria-pressed={category === value} onClick={() => setCategory(value)}>
                                <span>{categoryLabels[value] || "其他"}</span><em>{countFor(value)}</em>
                            </button>
                        ))}
                    </nav>
                    <div className="asset-picker-grid-wrap">
                        <div className="asset-picker-grid">
                            {visibleItems.length ? visibleItems.map((item) => (
                                <PickerCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item)} />
                            )) : (
                                <div className="asset-picker-empty"><FolderOpen /><strong>{emptyTitle}</strong><span>{upload ? "换个分类，或从底部上传一份新素材。" : emptyDescription}</span></div>
                            )}
                        </div>
                    </div>
                </div>
                <footer className={cn("asset-picker-footer", !upload && "is-compact")}>
                    {upload ? (
                        <>
                            <input ref={uploadInputRef} type="file" hidden accept={upload.accept} multiple={multiple} onChange={(event) => void handleUpload(event.target.files)} />
                            <button type="button" className="asset-picker-upload" onClick={() => uploadInputRef.current?.click()} disabled={working} aria-busy={uploading}>
                                {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                                <span><strong>{uploading ? `正在上传 ${uploadingCount} 个素材` : "上传新素材"}</strong><small>{uploading ? "保存完成后会自动选中" : upload.description}</small></span>
                            </button>
                        </>
                    ) : footerNote ? <span className="asset-picker-footer-note">{footerNote}</span> : <span />}
                    {error ? <span className="asset-picker-footer-error" role="alert">{error}</span> : null}
                    <div className="asset-picker-actions">
                        {onFolderAction && folderId !== "all" ? <Button type="text" icon={<FolderOpen />} disabled={working} onClick={() => void runFolderAction()}>{folderActionLabel}</Button> : null}
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
        <button type="button" className={cn("asset-picker-card", selected && "is-selected", disabled && "is-disabled")} onClick={onToggle} disabled={disabled} aria-pressed={selected} title={item.disabledReason || item.title}>
            <div className="asset-picker-card-media">
                {item.imageUrl ? <img src={item.imageUrl} alt={item.title} loading="lazy" decoding="async" className={item.imageFit === "contain" ? "is-contain" : undefined} /> : <AssetMediaPreview asset={item.asset} alt={item.title} fallback={<div className="asset-picker-card-fallback">{kindIcon(item.kindLabel)}</div>} />}
                <span className="asset-picker-card-check"><Check /></span>
                <span className="asset-picker-card-kind">{item.kindLabel}</span>
                {item.disabledReason ? <span className="asset-picker-card-lock">{item.disabledReason}</span> : null}
            </div>
            <div className="asset-picker-card-copy"><strong>{item.title || "未命名素材"}</strong>{item.description ? <span>{item.description}</span> : null}</div>
        </button>
    );
}

function renderPickerFolders(folders: AssetLibraryPickerFolder[], items: AssetLibraryPickerItem[], selectedId: string, onSelect: (folderId: string) => void, parentId = "", depth = 0, visited: ReadonlySet<string> = new Set()): ReactNode {
    if (depth >= 8) return null;
    return folders.filter((folder) => (folder.parentId || "") === parentId && !visited.has(folder.id)).map((folder) => {
        const nextVisited = new Set(visited).add(folder.id);
        return (
            <span key={folder.id} className="contents">
                <button type="button" className={selectedId === folder.id ? "is-active" : ""} aria-pressed={selectedId === folder.id} onClick={() => onSelect(folder.id)} style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}>
                    <span>{folder.name}</span><em>{items.filter((item) => item.folderId === folder.id).length}</em>
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
