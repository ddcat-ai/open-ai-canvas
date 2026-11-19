import { ImagePlus, LoaderCircle, Trash2, UploadCloud, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";

import {
    ll2LibraryItems,
    ll2SetAssetArchived,
    ll2UploadAsset,
} from "@/services/ll2/ll2-assets";
import { ll2MentionToken } from "@/services/ll2/ll2-media";
import { useAssetStore } from "@/stores/use-asset-store";

/**
 * C 端「素材库」抽屉：上传 → 存本机 → 在提示词里 @ 引用。
 * 不新增侧栏入口、不用影策 /assets 页（那页上传要登录态后端），
 * 写的是同一个 useAssetStore，所以能看到以前在影策存过的本机素材。
 */
export function LL2AssetLibrary({ open, onClose, onQuote }: { open: boolean; onClose: () => void; onQuote: (title: string) => void }) {
    const navigate = useNavigate();
    const assets = useAssetStore((state) => state.assets);
    const items = useMemo(() => (open ? ll2LibraryItems() : []), [open, assets]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [note, setNote] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

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
        setNote(ok ? `已存进这台电脑的素材库：${ok} 个。在句子里打 @ 就能引用。` : "");
        if (failed.length) setError(failed.slice(0, 3).join("；"));
        setBusy(false);
        setDragOver(false);
    };

    const remove = async (id: string, title: string) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            // 与资产页一致：先进回收站，可在「资产」页还原，不做不可恢复的删除。
            await ll2SetAssetArchived(id, true);
            setNote(`「${title}」已放进回收站，可在左侧「资产」页还原`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "移除失败，请重试");
        }
        setBusy(false);
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragOver(false);
        void upload(Array.from(event.dataTransfer.files || []));
    };

    return (
        <div className="ll2-library-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="ll2-library" role="dialog" aria-modal="true" aria-label="素材库">
                <header className="ll2-library-head">
                    <div>
                        <strong>素材库</strong>
                        <p>
                            先上传图片或视频。素材只存在这台电脑，不用登录；图片打 @ 就能引用，
                            <strong>视频只能存着预览下载（生成需要公网地址）</strong>。
                        </p>
                    </div>
                    <button type="button" className="ll2-library-close" onClick={onClose} aria-label="关闭素材库"><X className="size-4" /></button>
                </header>

                <div
                    className={`ll2-library-upload${dragOver ? " is-drag-over" : ""}`}
                    onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragOver(true); } }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
                    onDrop={onDrop}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime"
                        multiple
                        hidden
                        onChange={(event) => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }}
                    />
                    <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                        {busy ? <LoaderCircle className="size-4 is-spinning" /> : <UploadCloud className="size-4" />}
                        {busy ? "正在存到这台电脑" : "上传图片 / 视频"}
                    </button>
                    <span>也可以直接把文件拖到这里 · 图片 JPG / PNG / WebP，视频 MP4 / MOV</span>
                </div>

                {error ? <p className="ll2-library-message is-error" role="alert">{error}</p> : null}
                {note ? <p className="ll2-library-message" role="note">{note}</p> : null}

                <div className="ll2-library-grid">
                    {items.length ? items.map((item) => (
                        <article key={item.id} className="ll2-library-card">
                            <div className="ll2-library-cover">
                                {item.kind === "image" && item.coverUrl ? (
                                    <img src={item.coverUrl} alt={item.title} />
                                ) : (
                                    <span className="ll2-library-cover-icon">
                                        {item.kind === "video" ? <Video className="size-6" /> : <ImagePlus className="size-6" />}
                                        <small>{item.kind === "video" ? "视频" : "图片"}</small>
                                    </span>
                                )}
                            </div>
                            <strong title={item.title}>{item.title}</strong>
                            <small>{item.kind === "video" ? "视频" : "图片"} · {Math.max(1, Math.ceil(item.bytes / 1_000_000))}MB</small>
                            <div className="ll2-library-card-actions">
                                {/* 2026-11-19 真网关实测：参考视频只认公网 HTTPS 地址，本机视频转 Base64 会被 400 打回。
                                    所以本机视频不能 @ 引用，按钮直接置灰并说明，别让用户白填一次 Key 才失败。 */}
                                {item.kind === "video" ? (
                                    <button
                                        type="button"
                                        className="is-primary"
                                        disabled
                                        title="参考视频需要公网 HTTPS 地址；本机视频传不上去，暂时不能直接引用。图片可以直接引用。"
                                    >
                                        视频需公网链接
                                    </button>
                                ) : (
                                    <button type="button" className="is-primary" onClick={() => onQuote(ll2MentionToken(item.title))} disabled={busy}>@ 引用</button>
                                )}
                                <button type="button" onClick={() => void remove(item.id, item.title)} disabled={busy} aria-label={`移除 ${item.title}`}><Trash2 className="size-3.5" /></button>
                            </div>
                        </article>
                    )) : (
                        <div className="ll2-library-empty">
                            <strong>素材库还是空的</strong>
                            <p>上传一张图，句子里打 @ 选它，就能照着这张图出片；传两张图可以指定首帧和尾帧。</p>
                        </div>
                    )}
                </div>

                <footer className="ll2-library-foot">
                    <span>拖到输入框的图只能一张；想用好几个素材，就用 @ 引用，可以选很多张图片。视频参考需要公网 HTTPS 地址，本机视频暂时不能直接引用。</span>
                    <div className="ll2-library-foot-actions">
                        <button type="button" className="is-ghost" onClick={() => { onClose(); navigate("/assets"); }}>打开完整资产库</button>
                        <button type="button" onClick={onClose}>好了</button>
                    </div>
                </footer>
            </section>
        </div>
    );
}
