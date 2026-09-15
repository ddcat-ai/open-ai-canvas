import { useState, useEffect, useRef } from "react";
import { 
    X, ZoomIn, ZoomOut, RotateCw, Download, ArrowLeft, ArrowRight, 
    Copy, Check, Sparkles, Maximize2, MoveRight, Film, LayoutGrid,
    BookmarkCheck, BookmarkPlus
} from "lucide-react";
import { Button, Tooltip, message } from "antd";
import { useNavigate } from "react-router";
import { AestheticBlueprintCard } from "./aesthetic-blueprint-card";
import { resolveInspirationImageUrl, type PromptPresetItem, saveCustomPrompt, savePresetOverride } from "@/pages/prompts/prompt-data";
import { applyPromptToCanvas } from "@/pages/prompts/prompt-canvas-helper";
import { cn } from "@/lib/utils";

interface InspirationLightboxModalProps {
    open: boolean;
    item: PromptPresetItem | null;
    itemsList: PromptPresetItem[];
    currentIndex: number;
    onClose: () => void;
    onSelectIndex: (index: number) => void;
    onUpdateItem?: (item: PromptPresetItem) => void;
}

export function InspirationLightboxModal({
    open,
    item,
    itemsList,
    currentIndex,
    onClose,
    onSelectIndex,
    onUpdateItem,
}: InspirationLightboxModalProps) {
    const navigate = useNavigate();
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [copiedPositive, setCopiedPositive] = useState(false);
    const [copiedNegative, setCopiedNegative] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const dragStartRef = useRef({ x: 0, y: 0 });

    const [editablePrompt, setEditablePrompt] = useState<string>(item?.positivePrompt || "");
    const [isSaving, setIsSaving] = useState(false);
    const [hasSaved, setHasSaved] = useState(false);

    // 素材源派生
    const videoSrc = item?.previewVideo || (item?.previewImage?.endsWith(".mp4") ? item.previewImage : (item?.previewThumbnail?.endsWith(".mp4") ? item.previewThumbnail : ""));
    const isVideo = Boolean(videoSrc || item?.kind === "video");
    const rawThumb = (!item?.previewThumbnail?.endsWith(".mp4") ? item?.previewThumbnail : undefined) || (!item?.previewImage?.endsWith(".mp4") ? item?.previewImage : undefined) || "";
    const rawFull = isVideo ? videoSrc : (item?.previewImage || item?.previewThumbnail || "");

    const [currentThumbSrc, setCurrentThumbSrc] = useState<string>(rawThumb);
    const [currentFullSrc, setCurrentFullSrc] = useState<string>(rawFull);
    const [isFullLoaded, setIsFullLoaded] = useState<boolean>(false);
    const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);
    const [modalVideoError, setModalVideoError] = useState<boolean>(false);
    const [imgHasError, setImgHasError] = useState<boolean>(false);

    // Reset view state and image loading state whenever item changes
    useEffect(() => {
        setScale(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
        setCopiedPositive(false);
        setCopiedNegative(false);
        setModalVideoError(false);
        setImgHasError(!rawFull && !rawThumb && !videoSrc);
        setCurrentThumbSrc(rawThumb);
        setCurrentFullSrc(rawFull);
        setIsFullLoaded(false);
        setIsVideoLoaded(false);
        setEditablePrompt(item?.positivePrompt || "");
        setHasSaved(false);
    }, [item?.id, item?.positivePrompt, rawFull, rawThumb, videoSrc]);

    // 自动预加载前后各两张相邻素材，保证键盘左右箭头切换 0ms 瞬间秒开
    useEffect(() => {
        if (!open || !itemsList || itemsList.length === 0) return;
        const preloadIndices = [currentIndex + 1, currentIndex - 1, currentIndex + 2, currentIndex - 2];
        preloadIndices.forEach((idx) => {
            if (idx >= 0 && idx < itemsList.length) {
                const target = itemsList[idx];
                const pSrc = target?.remoteBackupUrl || target?.previewImage || target?.previewThumbnail;
                if (pSrc && !pSrc.endsWith(".mp4")) {
                    const img = new Image();
                    img.src = resolveInspirationImageUrl(pSrc, false);
                }
            }
        });
    }, [open, currentIndex, itemsList]);

    const handleThumbImgError = () => {
        // 1. 若本地缩略图 404，优先回退到远程缩略图备份
        const remoteThumb = item?.remoteThumbBackupUrl;
        if (remoteThumb && currentThumbSrc !== remoteThumb) {
            setCurrentThumbSrc(resolveInspirationImageUrl(remoteThumb, true));
            return;
        }
        // 2. 若无远程缩略图或已失败，回退到远程大图备份
        const remoteBackup = item?.remoteBackupUrl;
        if (remoteBackup && currentThumbSrc !== remoteBackup) {
            setCurrentThumbSrc(resolveInspirationImageUrl(remoteBackup, true));
            return;
        }
        // 3. 若都失败，置空，由 fullSrc 层兜底
        setCurrentThumbSrc("");
    };

    const handleModalImgError = () => {
        // 1. 视频回退：若本地视频离线文件尚未下载完成，优先平滑回退到远程 CDN 视频
        const remoteVideo = item?.remoteBackupUrl;
        if (isVideo && remoteVideo && currentFullSrc !== remoteVideo && !remoteVideo.endsWith(".jpg") && !remoteVideo.endsWith(".webp") && !remoteVideo.endsWith(".png")) {
            setCurrentFullSrc(remoteVideo);
            return;
        }
        // 2. 视频若依然无法加载（防盗链/跨域/未下载），优雅切换至高清分镜海报展示，绝不黑屏！
        if (isVideo && !modalVideoError) {
            setModalVideoError(true);
            setIsVideoLoaded(false);
            return;
        }
        // 3. 图片回退：若本地大图离线文件尚未下载完成，优先平滑回退到远程 CDN 图片
        const remoteImage = item?.remoteBackupUrl || item?.remoteThumbBackupUrl;
        if (!isVideo && remoteImage && currentFullSrc !== remoteImage) {
            setCurrentFullSrc(resolveInspirationImageUrl(remoteImage, false));
            return;
        }
        // 4. wsrv.nl 转换回退
        if (currentFullSrc.includes("wsrv.nl/?url=")) {
            const raw = decodeURIComponent(currentFullSrc.split("url=")[1].split("&")[0]);
            const normalized = raw.startsWith("http") ? raw : `https://${raw}`;
            if (normalized.includes("pbs.twimg.com")) {
                setCurrentFullSrc(`https://youmind.com/_next/image?url=${encodeURIComponent(normalized)}&w=1080&q=75`);
                return;
            } else {
                setCurrentFullSrc(normalized);
                return;
            }
        }
        // 5. YouMind proxy 回退到原图
        if (currentFullSrc.includes("youmind.com/_next/image?url=")) {
            try {
                const u = new URL(currentFullSrc);
                const original = u.searchParams.get("url");
                if (original && original !== currentFullSrc) {
                    setCurrentFullSrc(original);
                    return;
                }
            } catch {}
        }
        if (currentThumbSrc && currentThumbSrc !== currentFullSrc) {
            setCurrentFullSrc(currentThumbSrc);
        } else {
            setImgHasError(true);
        }
    };

    // Keyboard navigation and ESC close (AGENTS.md rule 5.1)
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            } else if (e.key === "ArrowLeft") {
                e.stopPropagation();
                if (currentIndex > 0) {
                    onSelectIndex(currentIndex - 1);
                }
            } else if (e.key === "ArrowRight") {
                e.stopPropagation();
                if (currentIndex < itemsList.length - 1) {
                    onSelectIndex(currentIndex + 1);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [open, currentIndex, itemsList.length, onClose, onSelectIndex]);

    if (!open || !item) return null;

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < itemsList.length - 1;

    const handleCopy = (text: string, isNeg = false) => {
        navigator.clipboard.writeText(text);
        if (isNeg) {
            setCopiedNegative(true);
            setTimeout(() => setCopiedNegative(false), 2000);
        } else {
            setCopiedPositive(true);
            setTimeout(() => setCopiedPositive(false), 2000);
        }
        message.success("提示词已复制到剪切板");
    };

    const handleDownload = () => {
        const downloadUrl = currentFullSrc || currentThumbSrc || item.remoteBackupUrl || item.previewVideo || item.previewImage;
        if (!downloadUrl) return;
        const isMp4 = isVideo || downloadUrl.endsWith(".mp4");
        const ext = isMp4 ? "mp4" : "webp";
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `${item.title.replace(/\s+/g, "_")}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSaveAndCollect = () => {
        if (!item) return;
        setIsSaving(true);
        try {
            const updatedItem: PromptPresetItem = {
                ...item,
                positivePrompt: editablePrompt,
                isOverridden: !item.isCustom ? true : item.isOverridden,
            };

            const { isCustom: _c, createdAt: _ca, ...customFields } = updatedItem;
            if (item.isCustom) {
                saveCustomPrompt(customFields);
            } else {
                savePresetOverride(item.id, { positivePrompt: editablePrompt });
                saveCustomPrompt({
                    ...customFields,
                    id: `custom-${item.id}-${Date.now().toString(36)}`,
                    title: item.title,
                });
            }

            setHasSaved(true);
            onUpdateItem?.(updatedItem);
            message.success("灵感提示词已保存并收录至我的灵感库");
            setTimeout(() => setHasSaved(false), 3000);
        } catch (e) {
            console.error(e);
            message.error("保存失败，请重试");
        } finally {
            setIsSaving(false);
        }
    };

    const handleUseInCanvas = () => {
        if (!item) return;
        onClose();
        applyPromptToCanvas({ ...item, positivePrompt: editablePrompt }, navigate);
    };

    const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
    const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
    const handleResetZoom = () => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        setRotation(0);
    };
    const handleToggleZoom = () => {
        if (scale > 1.1) {
            handleResetZoom();
        } else {
            setScale(1.6);
        }
    };

    // Mouse drag pan support when zoomed in
    const handleMouseDown = () => {
        if (scale <= 1) return;
        setIsDragging(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || scale <= 1) return;
        setPosition((prev) => ({
            x: prev.x + e.movementX,
            y: prev.y + e.movementY,
        }));
    };

    const handleMouseUp = () => setIsDragging(false);

    // Render positive prompt with highlighted slot placeholders {xxx}
    const renderHighlightedPrompt = (promptText: string) => {
        const parts = promptText.split(/(\{[^}]+\})/g);
        return parts.map((part, idx) => {
            if (part.startsWith("{") && part.endsWith("}")) {
                return (
                    <span 
                        key={idx} 
                        className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 text-xs"
                    >
                        {part}
                    </span>
                );
            }
            return <span key={idx}>{part}</span>;
        });
    };

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 select-none animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className="relative flex flex-col lg:flex-row w-full max-w-7xl h-[92vh] max-h-[920px] rounded-2xl sm:rounded-3xl bg-[#111113] border border-white/10 shadow-2xl overflow-hidden text-stone-100"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 关闭按钮 (右上角浮动) */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 z-20 flex size-9 items-center justify-center rounded-full bg-black/60 hover:bg-white/20 text-stone-300 hover:text-white backdrop-blur-md border border-white/10 transition-all cursor-pointer"
                    title="按 Esc 关闭"
                >
                    <X className="size-5" />
                </button>

                {/* 左侧：画廊视口 (Gallery Viewport, ~62%) */}
                <div 
                    className="relative flex-1 flex flex-col justify-between bg-[#08080a] overflow-hidden border-b lg:border-b-0 lg:border-r border-white/[0.08]"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* 顶部悬浮控制栏 */}
                    <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-xl bg-black/60 backdrop-blur-md px-3 py-1.5 border border-white/10 text-xs font-medium text-stone-300">
                            {item.kind === "video" || item.previewVideo ? (
                                <>
                                    <Film className="size-3.5 text-indigo-400 mr-1" />
                                    <span>Seedance 2.0 视频分镜演示</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles className="size-3.5 text-amber-400 mr-1" />
                                    <span>商业范例画册</span>
                                </>
                            )}
                            <span className="text-stone-500 ml-1">
                                ({currentIndex + 1} / {itemsList.length})
                            </span>
                        </div>
                    </div>

                    {/* 图片视口容器 */}
                    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
                        {(currentFullSrc || currentThumbSrc) && !imgHasError ? (
                            <div 
                                className="relative flex items-center justify-center transition-transform duration-150 ease-out cursor-zoom-in min-h-[220px]"
                                style={{
                                    transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
                                    cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in"
                                }}
                                onClick={handleToggleZoom}
                            >
                                {isVideo ? (
                                    <>
                                        {/* 视频解码准备中：0ms 瞬间呈现本地 WebP 高清海报，杜绝黑屏等待 */}
                                        {currentThumbSrc && !isVideoLoaded && !modalVideoError && (
                                            <img
                                                src={currentThumbSrc}
                                                alt={item.title}
                                                referrerPolicy="no-referrer"
                                                onError={handleThumbImgError}
                                                className="max-h-[72vh] max-w-full rounded-xl shadow-2xl object-contain pointer-events-none select-none"
                                            />
                                        )}
                                        {!modalVideoError ? (
                                            <video
                                                src={currentFullSrc || videoSrc}
                                                controls
                                                autoPlay
                                                loop
                                                playsInline
                                                {...({ referrerPolicy: "no-referrer" } as Record<string, string>)}
                                                onLoadedData={() => setIsVideoLoaded(true)}
                                                onError={handleModalImgError}
                                                className={`max-h-[72vh] max-w-full rounded-xl shadow-2xl pointer-events-auto transition-opacity duration-300 ${
                                                    isVideoLoaded ? "opacity-100" : (currentThumbSrc ? "opacity-0 absolute" : "opacity-100")
                                                }`}
                                            />
                                        ) : (
                                            /* 优雅降级：若视频遭遇第三方防盗链或离线包未下载，展示高清分镜海报，绝不黑屏！ */
                                            <img
                                                src={currentThumbSrc || resolveInspirationImageUrl(item.remoteThumbBackupUrl || item.remoteBackupUrl || item.previewImage, false)}
                                                alt={item.title}
                                                referrerPolicy="no-referrer"
                                                onError={handleThumbImgError}
                                                className="max-h-[72vh] max-w-full rounded-xl shadow-2xl object-contain pointer-events-none select-none"
                                            />
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {/* 1. 基础首屏层：0ms 瞬间秒显（浏览器直接复用网格中已加载的 WebP，绝无白屏或卡顿） */}
                                        {currentThumbSrc && currentThumbSrc !== currentFullSrc && (
                                            <img
                                                src={currentThumbSrc}
                                                alt={item.title}
                                                referrerPolicy="no-referrer"
                                                onError={handleThumbImgError}
                                                className={`max-h-[72vh] max-w-full rounded-xl shadow-2xl object-contain pointer-events-none select-none transition-opacity duration-300 ${
                                                    isFullLoaded ? "opacity-0 absolute" : "opacity-100"
                                                }`}
                                            />
                                        )}

                                        {/* 2. 高清平滑叠加层：高清就绪后平滑交叉淡入；若与缩略图同源则作为单图加载 */}
                                        {currentFullSrc && (
                                            <img
                                                src={currentFullSrc}
                                                alt={item.title}
                                                referrerPolicy="no-referrer"
                                                onLoad={() => setIsFullLoaded(true)}
                                                onError={handleModalImgError}
                                                className={`max-h-[72vh] max-w-full rounded-xl shadow-2xl object-contain pointer-events-none select-none transition-opacity duration-300 ${
                                                    currentThumbSrc && currentThumbSrc !== currentFullSrc
                                                        ? isFullLoaded
                                                            ? "opacity-100"
                                                            : "opacity-0 absolute"
                                                        : "opacity-100"
                                                }`}
                                            />
                                        )}

                                        {/* 3. 微型非阻塞高清就绪指示徽标（仅在高清加载中浮现于右上角，绝不遮挡画面） */}
                                        {!isFullLoaded && currentFullSrc && currentThumbSrc && currentThumbSrc !== currentFullSrc && (
                                            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-amber-300 pointer-events-none animate-pulse">
                                                <div className="size-2 rounded-full border border-amber-400 border-t-transparent animate-spin" />
                                                <span>快速预览中 · 高清无缝载入</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-full max-h-[72vh] p-2">
                                <AestheticBlueprintCard preset={item} variant="hero" />
                            </div>
                        )}

                        {/* 视频降级友好提示浮层 */}
                        {isVideo && modalVideoError && (
                            <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-amber-500/30 text-xs text-stone-200 shadow-xl">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <Film className="size-4 text-amber-400 shrink-0" />
                                    <span className="truncate">视频源受第三方防盗链或本地尚未下载离线包限制，已呈现高清分镜海报</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {videoSrc && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText(videoSrc);
                                                message.success("视频源链接已复制");
                                            }}
                                            className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] text-amber-300 transition-colors cursor-pointer"
                                        >
                                            复制源链接
                                        </button>
                                    )}
                                    {videoSrc && videoSrc.startsWith("http") && (
                                        <a
                                            href={videoSrc}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[11px] text-amber-300 transition-colors"
                                        >
                                            新标签页打开
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 左右导航箭头按钮 */}
                        {hasPrev && (
                            <button
                                type="button"
                                onClick={() => onSelectIndex(currentIndex - 1)}
                                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 hover:bg-amber-600 hover:scale-105 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition-all shadow-xl cursor-pointer"
                                title="上一个灵感 (← 方向键)"
                            >
                                <ArrowLeft className="size-5" />
                            </button>
                        )}
                        {hasNext && (
                            <button
                                type="button"
                                onClick={() => onSelectIndex(currentIndex + 1)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 hover:bg-amber-600 hover:scale-105 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition-all shadow-xl cursor-pointer"
                                title="下一个灵感 (→ 方向键)"
                            >
                                <ArrowRight className="size-5" />
                            </button>
                        )}
                    </div>

                    {/* 底部悬浮工具条 (缩放/旋转/下载) */}
                    <div className="flex items-center justify-between px-6 py-3 bg-black/40 backdrop-blur-md border-t border-white/[0.06] text-xs text-stone-400">
                        <div className="flex items-center gap-1.5">
                            <Tooltip title="缩小">
                                <button 
                                    onClick={handleZoomOut} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer"
                                >
                                    <ZoomOut className="size-4" />
                                </button>
                            </Tooltip>
                            <span className="font-mono text-[11px] px-1.5 text-stone-400">
                                {Math.round(scale * 100)}%
                            </span>
                            <Tooltip title="放大">
                                <button 
                                    onClick={handleZoomIn} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer"
                                >
                                    <ZoomIn className="size-4" />
                                </button>
                            </Tooltip>
                            <Tooltip title="重置缩放">
                                <button 
                                    onClick={handleResetZoom} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors ml-1 cursor-pointer"
                                >
                                    <Maximize2 className="size-4" />
                                </button>
                            </Tooltip>
                            <Tooltip title="顺时针旋转 90°">
                                <button 
                                    onClick={() => setRotation((r) => (r + 90) % 360)} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors ml-1 cursor-pointer"
                                >
                                    <RotateCw className="size-4" />
                                </button>
                            </Tooltip>
                        </div>

                        <div className="flex items-center gap-2">
                            {(item.previewImage || item.previewVideo || currentThumbSrc || item.remoteBackupUrl) && (
                                <Tooltip title={isVideo ? "下载演示视频 (MP4)" : "下载范例图原图 (WebP)"}>
                                    <button
                                        onClick={handleDownload}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-stone-300 hover:text-white transition-all cursor-pointer"
                                    >
                                        <Download className="size-3.5" />
                                        <span>{isVideo ? "视频下载" : "原图下载"}</span>
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                    </div>
                </div>

                {/* 右侧：美学蓝图与提示词检视抽屉 (~38%) */}
                <div className="w-full lg:w-[460px] flex flex-col h-full bg-[#141416] overflow-hidden border-t lg:border-t-0 lg:border-l border-white/[0.08]">
                    {/* 滚动内容区 */}
                    <div className="flex-1 overflow-y-auto p-6 thin-scrollbar flex flex-col gap-5 min-h-0">
                        {/* 标题与分类徽标 */}
                        <div className="pr-8">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                    {item.category}
                                </span>
                                {item.crossCategories?.map((cc: string) => (
                                    <span key={cc} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                        {cc}
                                    </span>
                                ))}
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono text-stone-400 bg-white/5">
                                    {item.kind === "image" ? "生图美学" : "生视频运镜"}
                                </span>
                            </div>
                            <h2 className="text-xl font-bold text-white tracking-tight">
                                {item.title}
                            </h2>
                            <p className="text-xs text-stone-400 mt-1.5 leading-relaxed">
                                {item.description}
                            </p>
                            {item.linkedPresetId && (
                                <div className="mt-2.5 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                                    <Film className="size-3.5 text-amber-400 shrink-0" />
                                    <span>
                                        已双模态联动：配套包含{item.kind === "image" ? "Seedance 2.0 图生视频分镜与实拍视频" : "16:9 生图故事板全景大图"}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* 正向提示词 */}
                        <div className="flex flex-col gap-2 rounded-xl bg-black/40 border border-white/[0.08] p-3.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-stone-300 flex items-center gap-1.5">
                                    <Sparkles className="size-3.5 text-amber-400" />
                                    <span>核心正向提示词</span>
                                    {editablePrompt !== item.positivePrompt && (
                                        <span className="text-[10px] font-normal text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                            已修改
                                        </span>
                                    )}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(editablePrompt, false)}
                                        className="h-7 text-xs px-2.5 rounded-lg text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-1.5 cursor-pointer transition-all"
                                    >
                                        {copiedPositive ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                                        <span>{copiedPositive ? "已复制" : "复制"}</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={handleSaveAndCollect}
                                        style={{
                                            backgroundColor: hasSaved ? '#10b981' : '#fbbf24',
                                            color: hasSaved ? '#ffffff' : '#0c0a09',
                                            border: hasSaved ? '1px solid #34d399' : '1px solid #fde68a',
                                            boxShadow: hasSaved ? '0 2px 10px rgba(16, 185, 129, 0.4)' : '0 2px 12px rgba(251, 191, 36, 0.45)',
                                        }}
                                        className={cn(
                                            "h-7 text-xs px-3 rounded-lg flex items-center gap-1.5 font-bold cursor-pointer transition-all duration-200",
                                            hasSaved
                                                ? "hover:brightness-110 active:brightness-95"
                                                : "hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                                        )}
                                    >
                                        {hasSaved ? <BookmarkCheck className="size-3.5 text-white" /> : <BookmarkPlus className="size-3.5 text-stone-950" />}
                                        <span>{hasSaved ? "已保存收录" : "保存并收录"}</span>
                                    </button>
                                </div>
                            </div>
                            <div className="relative mt-1">
                                <textarea
                                    value={editablePrompt}
                                    onChange={(e) => setEditablePrompt(e.target.value)}
                                    placeholder="输入或微调正向提示词..."
                                    rows={4}
                                    className="w-full rounded-lg bg-[#0c0c0e] border border-white/[0.08] p-2.5 font-mono text-xs text-stone-100 leading-relaxed placeholder:text-stone-600 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all resize-y select-text thin-scrollbar min-h-[110px] max-h-[220px]"
                                />
                            </div>
                        </div>

                        {/* 负向提示词 (如果存在) */}
                        {item.negativePrompt && (
                            <div className="flex flex-col gap-2 rounded-xl bg-black/30 border border-white/[0.06] p-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-stone-400">负向规避词 (Negative Prompt)</span>
                                    <button
                                        onClick={() => handleCopy(item.negativePrompt!, true)}
                                        className="text-[11px] text-stone-400 hover:text-stone-200 transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        {copiedNegative ? <Check className="size-3" /> : <Copy className="size-3" />}
                                        <span>{copiedNegative ? "已复制" : "复制"}</span>
                                    </button>
                                </div>
                                <div className="text-[11px] font-mono text-stone-400 leading-normal max-h-[70px] overflow-y-auto thin-scrollbar select-text bg-[#0c0c0e] p-2 rounded border border-white/[0.03]">
                                    {item.negativePrompt}
                                </div>
                            </div>
                        )}

                        {/* 推荐工程参数 */}
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                                <span className="text-[11px] text-stone-400">推荐画幅 / 比例</span>
                                <span className="text-sm font-semibold font-mono text-amber-400">
                                    {item.recommendedParams?.aspectRatio || "1:1"}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                                <span className="text-[11px] text-stone-400">适配基底模型</span>
                                <span className="text-sm font-semibold text-stone-200">
                                    {item.recommendedParams?.model || (item.kind === "image" ? "FLUX.1-dev" : "Kling 1.5")}
                                </span>
                            </div>
                        </div>



                        {/* 标签池 */}
                        {item.tags && item.tags.length > 0 && (
                            <div>
                                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-2">
                                    检索标签
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {item.tags.map((tag: string) => (
                                        <span 
                                            key={tag}
                                            className="text-xs px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-stone-300 border border-white/[0.05] transition-colors"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 底部吸底固定行动按钮栏 (常驻底部，绝对不被内容挤出屏幕) */}
                    <div className="shrink-0 p-4 sm:p-5 border-t border-white/[0.08] bg-[#141416]/95 backdrop-blur-md flex items-center gap-2.5 z-10">
                        <button
                            type="button"
                            onClick={() => handleCopy(editablePrompt, false)}
                            className="flex-1 h-11 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 border border-white/15 hover:border-white/30 text-stone-100 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap text-xs sm:text-sm font-medium transition-all duration-200"
                        >
                            <Copy className="size-4 text-stone-300" />
                            <span>复制提示词</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleUseInCanvas}
                            style={{
                                background: isVideo
                                    ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #7c3aed 100%)'
                                    : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                                color: isVideo ? '#ffffff' : '#0c0a09',
                                border: isVideo ? '1px solid #c4b5fd' : '1px solid #fde68a',
                                boxShadow: isVideo
                                    ? '0 4px 16px rgba(99, 102, 241, 0.45)'
                                    : '0 4px 16px rgba(251, 191, 36, 0.45)'
                            }}
                            className="group/import flex-[1.5] h-11 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap text-xs sm:text-sm transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <LayoutGrid className={`size-4 transition-transform duration-200 group-hover/import:scale-110 ${isVideo ? "text-white" : "text-stone-950"}`} />
                            <span>一键导入画布</span>
                            <MoveRight className={`size-3.5 transition-transform duration-200 group-hover/import:translate-x-1 ${isVideo ? "text-white" : "text-stone-950"}`} />
                        </button>
                        
                    </div>
                </div>
            </div>
        </div>
    );
}
