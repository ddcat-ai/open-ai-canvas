import { useEffect, useRef, useState, type CSSProperties } from "react";
import { App, Button, InputNumber, Modal } from "antd";
import { Check, Image as ImageIcon, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatVideoFrameTime, normalizeVideoFrameTimes } from "@/lib/canvas/canvas-video-frame";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

type SelectedVideoFrame = {
    id: string;
    timeMs: number;
};

export type CanvasVideoFrameParams = {
    timesMs: number[];
};

type CanvasVideoFrameDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasVideoFrameParams) => void;
};

const MAX_SELECTED_FRAMES = 30;

export function CanvasVideoFrameDialog({ node, open, onClose, onConfirm }: CanvasVideoFrameDialogProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [videoError, setVideoError] = useState(false);
    const [durationMs, setDurationMs] = useState(0);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [frames, setFrames] = useState<SelectedVideoFrame[]>([]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setVideoUrl("");
        setVideoError(false);
        setDurationMs(0);
        setCurrentTimeMs(0);
        setFrames([]);
        const storageKey = node.metadata?.storageKey || "";
        const fallback = node.metadata?.content || "";
        const applyUrl = (url: string) => {
            if (!cancelled) setVideoUrl(url);
        };
        if (resourceIdFromStorageKey(storageKey)) {
            void cacheResourceObjectUrl(storageKey)
                .then((cached) => {
                    if (cancelled) return;
                    if (cached) setVideoUrl(cached);
                    else void resolveMediaUrl(storageKey, fallback).then(applyUrl);
                })
                .catch(() => {
                    if (!cancelled) void resolveMediaUrl(storageKey, fallback).then(applyUrl);
                });
        } else {
            void resolveMediaUrl(storageKey, fallback).then(applyUrl);
        }
        return () => {
            cancelled = true;
        };
    }, [node.id, node.metadata?.content, node.metadata?.storageKey, open]);

    const seekTo = (timeMs: number) => {
        const normalized = normalizeVideoFrameTimes([timeMs], durationMs)[0];
        if (normalized === undefined) return;
        setCurrentTimeMs(normalized);
        if (videoRef.current) videoRef.current.currentTime = normalized / 1000;
    };

    const addFrame = (timeMs: number) => {
        const normalized = normalizeVideoFrameTimes([timeMs], durationMs)[0];
        if (normalized === undefined) {
            message.warning("视频时长未就绪，请稍候再试");
            return;
        }
        if (frames.some((frame) => frame.timeMs === normalized)) {
            message.info("该时间点已经添加");
            return;
        }
        if (frames.length >= MAX_SELECTED_FRAMES) {
            message.warning(`单次最多提取 ${MAX_SELECTED_FRAMES} 帧，请先完成当前批次`);
            return;
        }
        setFrames((current) => [...current, { id: nanoid(), timeMs: normalized }].sort((left, right) => left.timeMs - right.timeMs));
    };

    const removeFrame = (id: string) => setFrames((current) => current.filter((frame) => frame.id !== id));
    const lastFrameMs = Math.max(0, durationMs - 1);

    const title = (
        <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                <ImageIcon className="size-4" />
            </span>
            <div className="min-w-0">
                <div className="truncate font-semibold leading-6">提取视频画面</div>
                <div className="truncate text-xs opacity-45">{node.title || "视频节点"}</div>
            </div>
        </div>
    );

    return (
        <Modal title={title} open={open} onCancel={onClose} footer={null} width={760} centered destroyOnHidden>
            <div className="space-y-4">
                <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black">
                    {videoUrl ? (
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="block max-h-[var(--video-segment-preview-max-height)] w-full"
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                                setDurationMs(Math.round(video.duration * 1000));
                                setCurrentTimeMs(Math.round(video.currentTime * 1000));
                            }}
                            onTimeUpdate={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
                            onSeeked={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
                            onError={() => setVideoError(true)}
                        />
                    ) : (
                        <div className="grid h-44 w-full place-items-center text-xs opacity-60">{videoError ? "视频预览加载失败，请检查素材是否仍然可用" : "正在加载视频…"}</div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: theme.toolbar.itemHover }}>
                    <span className="text-xs font-medium opacity-60">当前时间</span>
                    <InputNumber
                        size="small"
                        min={0}
                        max={Math.max(0, lastFrameMs / 1000)}
                        step={0.001}
                        precision={3}
                        value={currentTimeMs / 1000}
                        className="w-28"
                        aria-label="当前取帧时间（秒）"
                        onChange={(value) => seekTo(Math.round((value || 0) * 1000))}
                    />
                    <span className="mr-auto text-xs opacity-45">/ {durationMs ? formatVideoFrameTime(durationMs) : "--:--.---"}</span>
                    <Button
                        size="small"
                        icon={<SkipBack className="size-3.5" />}
                        disabled={!durationMs}
                        onClick={() => {
                            seekTo(0);
                            addFrame(0);
                        }}
                    >
                        首帧
                    </Button>
                    <Button size="small" type="primary" icon={<ImageIcon className="size-3.5" />} disabled={!durationMs} onClick={() => addFrame(currentTimeMs)}>
                        添加当前画面
                    </Button>
                    <Button
                        size="small"
                        icon={<SkipForward className="size-3.5" />}
                        disabled={!durationMs}
                        onClick={() => {
                            seekTo(lastFrameMs);
                            addFrame(lastFrameMs);
                        }}
                    >
                        尾帧
                    </Button>
                </div>

                <section aria-labelledby="selected-video-frames-title">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div id="selected-video-frames-title" className="text-sm font-medium">
                            已选画面
                        </div>
                        <div className="text-xs opacity-45">
                            {frames.length}/{MAX_SELECTED_FRAMES}
                        </div>
                    </div>
                    {frames.length ? (
                        <div className="thin-scrollbar grid max-h-52 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                            {frames.map((frame, index) => (
                                <div key={frame.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: theme.toolbar.itemHover }}>
                                    <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2" style={{ "--tw-ring-color": theme.node.activeStroke } as CSSProperties} onClick={() => seekTo(frame.timeMs)}>
                                        <span className="block text-[var(--fs-micro)] opacity-45">画面 {index + 1}</span>
                                        <span className="block truncate font-mono text-xs font-medium">{formatVideoFrameTime(frame.timeMs)}</span>
                                    </button>
                                    <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={`删除画面 ${index + 1}`} onClick={() => removeFrame(frame.id)} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg px-3 py-5 text-center text-xs opacity-50" style={{ background: theme.toolbar.itemHover }}>
                            播放或拖动到需要的位置，然后添加当前画面。可以连续添加多个时间点。
                        </div>
                    )}
                </section>

                <div className="flex items-center justify-between gap-3">
                    <div className="text-xs opacity-45">提取后只创建图片节点，不会自动发起生成任务。</div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<Check className="size-4" />} disabled={!frames.length} onClick={() => onConfirm({ timesMs: frames.map((frame) => frame.timeMs) })}>
                            {frames.length ? `提取 ${frames.length} 帧` : "提取画面"}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
