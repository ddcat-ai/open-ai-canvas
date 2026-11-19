import { ChevronLeft, ChevronRight, Folder, ImagePlus, LoaderCircle, Trash2, UploadCloud, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";

import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, type AssetCategory } from "@/lib/asset-category";
import { ll2LibraryItems, ll2SetAssetArchived, ll2UploadAsset, type LL2LibraryItem } from "@/services/ll2/ll2-assets";
import { ll2MentionToken } from "@/services/ll2/ll2-media";
import { useAssetStore } from "@/stores/use-asset-store";

const MENU_WIDTH = 336;
const LIST_LIMIT = 6;
// 截图里「个人素材库 → 角色 / 场景 / 道具」那种紧凑菜单：点分类再展开素材，选完直接 @ 引用。
const FOLDER_CATEGORIES = ASSET_CATEGORIES.filter((category) => category !== "ark");

type Anchor = { left: number; top: number };

export function LL2AssetLibrary({ open, anchor, onClose, onQuote }: { open: boolean; anchor?: Anchor | null; onClose: () => void; onQuote: (title: string) => void }) {
    const navigate = useNavigate();
    const assets = useAssetStore((state) => state.assets);
    const items = useMemo(() => (open ? ll2LibraryItems() : []), [open, assets]);
    const [category, setCategory] = useState<AssetCategory | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [note, setNote] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setCategory(null);
        setExpanded(false);
        setError("");
        setNote("");
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open, onClose]);

    const grouped = useMemo(() => {
        const map = new Map<AssetCategory, LL2LibraryItem[]>();
        for (const item of items) map.set(item.category, [...(map.get(item.category) || []), item]);
        return FOLDER_CATEGORIES.filter((categoryKey) => map.has(categoryKey)).map((categoryKey) => ({
            category: categoryKey,
            label: ASSET_CATEGORY_LABELS[categoryKey],
            items: map.get(categoryKey) || [],
        }));
    }, [items]);

    const position = useMemo(() => {
        const width = Math.min(MENU_WIDTH, window.innerWidth - 24);
        const estimated = category ? 360 : 300;
        const left = Math.max(12, Math.min(anchor?.left ?? window.innerWidth / 2 - width / 2, window.innerWidth - width - 12));
        const preferredTop = anchor?.top ?? 180;
        const top = preferredTop + estimated > window.innerHeight - 12 ? Math.max(12, preferredTop - estimated - 40) : preferredTop;
        return { left, top, width };
    }, [anchor, category]);

    if (!open) return null;

    const current = grouped.find((group) => group.category === category) || null;
    const currentItems = current?.items || [];
    const shown = expanded ? currentItems : currentItems.slice(0, LIST_LIMIT);
    const hidden = Math.max(0, currentItems.length - shown.length);

    const upload = async (files: File[]) => {
        if (busy || !files.length) return;
        setBusy(true);
        setError("");
        setNote("");
        const failed: string[] = [];
        let ok = 0;
        for (const file of files) {
            try {
                await ll2UploadAsset(file);
                ok += 1;
            } catch (cause) {
                failed.push(cause instanceof Error ? cause.message : `「${file.name}」上传失败`);
            }
        }
        setNote(ok ? `已存进这台电脑的素材库：${ok} 个` : "");
        if (failed.length) setError(failed.slice(0, 2).join("；"));
        setBusy(false);
        setDragOver(false);
    };

    const remove = async (item: LL2LibraryItem) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            await ll2SetAssetArchived(item.id, true);
            setNote(`「${item.title}」已放进回收站，可在「资产」页还原`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "移除失败，请重试");
        }
        setBusy(false);
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        void upload(Array.from(event.dataTransfer.files || []));
    };

    return (
        <div
            ref={panelRef}
            className="ll2-ref-menu"
            role="dialog"
            aria-label="个人素材库"
            style={{ left: position.left, top: position.top, width: position.width }}
            onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes("Files")) {
                    event.preventDefault();
                    setDragOver(true);
                }
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
            }}
            onDrop={onDrop}
        >
            <div className={`ll2-ref-menu-body${dragOver ? " is-drag-over" : ""}`}>
                <header className="ll2-ref-head">
                    {category ? (
                        <button type="button" className="ll2-ref-back" onClick={() => { setCategory(null); setExpanded(false); }} aria-label="返回分类">
                            <ChevronLeft className="size-4" />
                        </button>
                    ) : null}
                    <strong>{category ? ASSET_CATEGORY_LABELS[category] : "个人素材库"}</strong>
                    <div className="ll2-ref-head-actions">
                        <button type="button" className="ll2-ref-upload" onClick={() => inputRef.current?.click()} disabled={busy} title="上传图片或视频">
                            {busy ? <LoaderCircle className="size-3.5 is-spinning" /> : <UploadCloud className="size-3.5" />}
                            上传
                        </button>
                        <button type="button" className="ll2-ref-close" onClick={onClose} aria-label="关闭素材库"><X className="size-3.5" /></button>
                    </div>
                </header>

                <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime"
                    multiple
                    hidden
                    onChange={(event) => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }}
                />

                {!category ? (
                    <div className="ll2-ref-folders">
                        {grouped.map((group) => (
                            <button key={group.category} type="button" className="ll2-ref-folder" onClick={() => setCategory(group.category)}>
                                <span className="ll2-ref-folder-icon"><Folder className="size-4" /></span>
                                <span>{group.label}</span>
                                <small>{group.items.length}</small>
                                <ChevronRight className="ll2-ref-folder-arrow size-3.5" />
                            </button>
                        ))}
                        {!grouped.length ? (
                            <div className="ll2-ref-empty">
                                <strong>素材库还是空的</strong>
                                <p>上传一张图，句子里打 @ 选它，就能照着这张图出片。</p>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="ll2-ref-items">
                        {shown.map((item) => (
                            <div key={item.id} className="ll2-ref-item">
                                <button
                                    type="button"
                                    className="ll2-ref-item-main"
                                    onClick={() => (item.kind === "image" ? onQuote(ll2MentionToken(item.title)) : undefined)}
                                    disabled={busy || item.kind === "video"}
                                    title={item.kind === "video" ? "视频只能存着预览下载（参考视频要公网 HTTPS 地址）" : `引用「${item.title}」`}
                                >
                                    {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <span className="ll2-ref-item-icon">{item.kind === "video" ? <Video className="size-4" /> : <ImagePlus className="size-4" />}</span>}
                                    <span className="ll2-ref-item-title">{item.title}</span>
                                </button>
                                <button type="button" className="ll2-ref-item-remove" onClick={() => void remove(item)} disabled={busy} aria-label={`移除 ${item.title}`}>
                                    <Trash2 className="size-3" />
                                </button>
                            </div>
                        ))}
                        {!currentItems.length ? <p className="ll2-ref-empty-line">这个分类还没有素材。</p> : null}
                    </div>
                )}

                {error ? <p className="ll2-ref-message is-error" role="alert">{error}</p> : null}
                {note ? <p className="ll2-ref-message">{note}</p> : null}

                <footer className="ll2-ref-foot">
                    {category && hidden ? (
                        <button type="button" className="ll2-ref-more" onClick={() => setExpanded(true)}>还有 {hidden} 个结果</button>
                    ) : null}
                    <button type="button" className="ll2-ref-link" onClick={() => { onClose(); navigate("/assets"); }}>打开完整资产库</button>
                </footer>
            </div>
        </div>
    );
}
