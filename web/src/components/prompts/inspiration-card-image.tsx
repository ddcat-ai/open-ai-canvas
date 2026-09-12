import React, { useState, useEffect, useRef } from "react";
import { Film, Play } from "lucide-react";
import { AestheticBlueprintCard } from "./aesthetic-blueprint-card";
import { InspirationCache } from "./inspiration-cache";
import { resolveInspirationImageUrl, type PromptPresetItem } from "@/pages/prompts/prompt-data";

interface InspirationCardImageProps {
    preset: PromptPresetItem;
    children?: React.ReactNode;
    onClick?: () => void;
}

export function InspirationCardImage({ preset, children, onClick }: InspirationCardImageProps) {
    const rawThumb = preset.previewThumbnail || preset.previewImage;
    const videoSrc = preset.previewVideo || (preset.previewImage?.endsWith(".mp4") ? preset.previewImage : (rawThumb?.endsWith(".mp4") ? rawThumb : ""));
    const isVideo = Boolean(videoSrc);
    // 封面图：如果是视频，绝不把 MP4 作为封面，优先取缩略图或高保真封面，若没有则为 undefined
    const posterSrc = !rawThumb?.endsWith(".mp4") ? rawThumb : (!preset.previewImage?.endsWith(".mp4") ? preset.previewImage : undefined);

    // 状态管理
    const [imgSrc, setImgSrc] = useState<string>(posterSrc || (!isVideo ? rawThumb || "" : ""));
    const [activeVideoSrc, setActiveVideoSrc] = useState<string>(videoSrc);
    const [isImgLoaded, setIsImgLoaded] = useState<boolean>(false);
    const [hasError, setHasError] = useState<boolean>(!rawThumb && !videoSrc);
    const [attempt, setAttempt] = useState<number>(0);

    // 视频按需交互状态：首屏加载绝对不挂载 video，仅在鼠标悬停或交互时按需动态挂载
    const [isVideoHovered, setIsVideoHovered] = useState<boolean>(false);
    const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);
    const hoverTimerRef = useRef<any>(null);

    // 当换页或筛选变更导致 preset 改变时重置状态并优先查本地缓存
    useEffect(() => {
        const pSrc = !rawThumb?.endsWith(".mp4") ? rawThumb : (!preset.previewImage?.endsWith(".mp4") ? preset.previewImage : undefined);
        const targetImg = pSrc || (!isVideo ? rawThumb || "" : "");
        setImgSrc(targetImg);
        setActiveVideoSrc(videoSrc);
        setIsImgLoaded(false);
        setIsVideoHovered(false);
        setIsVideoLoaded(false);
        setHasError(!targetImg && !videoSrc);
        setAttempt(0);

        // 优先检查内存中是否已有缓存镜像
        if (targetImg && !targetImg.startsWith("blob:") && !targetImg.startsWith("data:")) {
            const memHit = InspirationCache.getMemoryCached(targetImg);
            if (memHit) {
                setImgSrc(memHit);
            }
        }
    }, [preset.id, preset.previewThumbnail, preset.previewImage, preset.previewVideo, videoSrc]);

    const [videoPlayFailed, setVideoPlayFailed] = useState<boolean>(false);

    // 智能视频故障转移 (Local 404 -> Remote CDN -> 优雅保持封面)
    const handleVideoError = () => {
        const remoteVid = preset.remoteBackupUrl;
        if (remoteVid && activeVideoSrc !== remoteVid && !remoteVid.endsWith(".jpg") && !remoteVid.endsWith(".webp") && !remoteVid.endsWith(".png")) {
            setActiveVideoSrc(remoteVid);
        } else {
            // 视频播放失败时，仅关闭悬停播放并平滑保持封面展示，绝不破坏卡片本身！
            setIsVideoHovered(false);
            setIsVideoLoaded(false);
            setVideoPlayFailed(true);
        }
    };

    // 智能多级镜像故障转移 (Local First -> Remote Backup -> Edge WebP CDN)
    const handleError = () => {
        // 1. 若当前是 wsrv.nl 的链接且加载失败，尝试提取原图走 YouMind 镜像或原图直连
        if (imgSrc.includes("wsrv.nl/?url=")) {
            const rawUrl = decodeURIComponent(imgSrc.split("url=")[1].split("&")[0]);
            const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
            if (normalized.includes("pbs.twimg.com")) {
                setImgSrc(`https://youmind.com/_next/image?url=${encodeURIComponent(normalized)}&w=640&q=75`);
                return;
            } else {
                setImgSrc(normalized);
                return;
            }
        }
        // 2. 若当前是 YouMind next/image 镜像失败，尝试直接回退到原图
        if (imgSrc.includes("youmind.com/_next/image?url=")) {
            try {
                const u = new URL(imgSrc);
                const original = u.searchParams.get("url");
                if (original && original !== imgSrc) {
                    setImgSrc(original);
                    return;
                }
            } catch {}
        }

        // 3. 本地离线 404 或普通路径失败：自动切换为远端缩略图/原图备份
        const remoteThumb = preset.remoteThumbBackupUrl;
        const remoteBackup = preset.remoteBackupUrl;

        if (attempt === 0 && remoteThumb && remoteThumb !== imgSrc) {
            setAttempt(1);
            setImgSrc(resolveInspirationImageUrl(remoteThumb, true));
        } else if (attempt <= 1 && remoteBackup && remoteBackup !== imgSrc) {
            setAttempt(2);
            setImgSrc(resolveInspirationImageUrl(remoteBackup, true));
        } else if (attempt <= 2 && preset.previewImage && preset.previewImage !== imgSrc && !preset.previewImage.endsWith(".mp4")) {
            setAttempt(3);
            setImgSrc(resolveInspirationImageUrl(preset.previewImage, false));
        } else if (attempt <= 3 && imgSrc.includes("wsrv.nl/?url=cdn.jsdelivr.net")) {
            setAttempt(4);
            const rawJsdelivr = decodeURIComponent(imgSrc.split("url=")[1].split("&")[0]);
            setImgSrc(rawJsdelivr.startsWith("http") ? rawJsdelivr : `https://${rawJsdelivr}`);
        } else {
            setHasError(true);
        }
    };

    // 鼠标悬停事件：视频卡片防抖 220ms 挂载；图片卡片预热预载高清大图 (Pre-warm)
    const handleMouseEnter = () => {
        if (isVideo && videoSrc && !videoPlayFailed) {
            hoverTimerRef.current = setTimeout(() => {
                setIsVideoHovered(true);
            }, 220);
        } else {
            const targetPreload = preset.remoteBackupUrl || preset.previewImage;
            if (targetPreload && !targetPreload.endsWith(".mp4")) {
                const img = new Image();
                img.src = resolveInspirationImageUrl(targetPreload, false);
            }
        }
    };

    const handleMouseLeave = () => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        setIsVideoHovered(false);
        setIsVideoLoaded(false);
    };

    if (hasError || (!imgSrc && !videoSrc)) {
        return (
            <AestheticBlueprintCard 
                preset={preset} 
                onInspect={onClick} 
            />
        );
    }

    return (
        <div 
            className="relative aspect-[16/10] w-full overflow-hidden bg-[#0d0e12] cursor-pointer group/img select-none"
            onClick={onClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* 优雅微光骨架屏 (Skeleton Shimmer) - 彻底消灭黑屏卡顿感 */}
            {!isImgLoaded && !isVideoLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#131419] overflow-hidden">
                    <div 
                        className="absolute inset-0 opacity-20 blur-3xl"
                        style={{ background: preset.gradient }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-pulse" />
                    <div 
                        className="absolute inset-0 opacity-20 pointer-events-none"
                        style={{
                            backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
                            backgroundSize: "20px 20px"
                        }}
                    />
                    <div className="relative z-10 flex flex-col items-center gap-2 opacity-50">
                        <div className="size-4 rounded-full border border-stone-600 border-t-amber-500 animate-spin" />
                        <span className="text-[9px] font-mono text-stone-500 tracking-wider">LOADING...</span>
                    </div>
                </div>
            )}

            {/* 竖屏素材环境微光衬底 (保留整体构图通透，消除画面生硬空隙) */}
            {(preset.recommendedParams?.aspectRatio === "9:16" || preset.recommendedParams?.aspectRatio === "3:4") && imgSrc && (
                <div
                    className="absolute inset-0 bg-cover bg-center filter blur-xl scale-110 opacity-30 select-none pointer-events-none transition-opacity duration-300"
                    style={{ backgroundImage: `url(${imgSrc})` }}
                />
            )}

            {/* 静态 WebP 压缩封面图：无论是图片还是视频，页面首次渲染 100% 只加载封面，优先保证页面急速渲染 */}
            {imgSrc && (
                <img
                    src={imgSrc}
                    alt={preset.title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={() => setIsImgLoaded(true)}
                    onError={handleError}
                    className={`h-full ${
                        preset.recommendedParams?.aspectRatio === "9:16" || preset.recommendedParams?.aspectRatio === "3:4"
                            ? "w-auto object-contain mx-auto relative z-[1] drop-shadow-md"
                            : "w-full object-cover"
                    } transition-all duration-300 select-none group-hover/img:scale-105 ${
                        isImgLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
                    } ${isVideoHovered && isVideoLoaded ? "hidden" : "block"}`}
                />
            )}

            {/* 视频类按需交互播放：仅在鼠标悬浮超过 220ms 时才挂载并启动播放，杜绝页面首屏带宽阻塞 */}
            {isVideo && isVideoHovered && !videoPlayFailed && (
                <video
                    src={activeVideoSrc}
                    poster={posterSrc}
                    muted
                    loop
                    playsInline
                    autoPlay
                    {...({ referrerPolicy: "no-referrer" } as Record<string, string>)}
                    onLoadedData={() => setIsVideoLoaded(true)}
                    onError={handleVideoError}
                    className={`h-full ${
                        preset.recommendedParams?.aspectRatio === "9:16" || preset.recommendedParams?.aspectRatio === "3:4"
                            ? "w-auto object-contain mx-auto relative z-[1] drop-shadow-md"
                            : "w-full object-cover"
                    } select-none`}
                />
            )}

            {/* 视频类专属交互徽标与播放指引 */}
            {isVideo && (
                <>
                    {/* 居中半透明高质感播放按钮（未处于悬停播放状态时展示） */}
                    {!isVideoHovered && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-transform duration-300 group-hover/img:scale-110">
                            <div className="flex size-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-white shadow-xl border border-white/20 group-hover/img:bg-amber-500 group-hover/img:text-black transition-colors">
                                <Play className="size-5 fill-current ml-0.5 text-amber-400 group-hover/img:text-black transition-colors" />
                            </div>
                        </div>
                    )}

                    {/* 右下角视频分镜时长与调度徽标 */}
                    <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5 rounded-md bg-black/75 backdrop-blur-md px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/30 pointer-events-none shadow-md">
                        <Film className="size-3 text-amber-400" />
                        <span>{preset.recommendedParams?.duration ? `${preset.recommendedParams.duration}s 视频` : "Seedance 2.0 视频"}</span>
                    </div>
                </>
            )}

            {/* 徽标、标签与操作层插槽 */}
            {children}
        </div>
    );
}
