import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, ColorPicker, Input, InputNumber, Modal, Progress, Segmented, Switch } from "antd";
import { Captions, FileDown, FileUp, ListPlus, LoaderCircle, Plus, Scissors, Sparkles, Trash2 } from "lucide-react";
import { saveAs } from "file-saver";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { parseSrt, serializeSrtEntries } from "@/lib/timeline/srt-parser";
import { DEFAULT_MAX_CHARS_PER_ENTRY, MAX_CHARS_PER_ENTRY_LIMIT, MIN_CHARS_PER_ENTRY, resegmentSrtEntries, splitLongEntry } from "@/lib/timeline/srt-resegment";
import { buildFallbackHighlights, remapHighlightsAfterResegment } from "@/lib/timeline/subtitle-highlights";
import { generateSubtitleHighlights, type SubtitleHighlightProgress } from "@/lib/timeline/subtitle-highlight-runner";
import { createDefaultSubtitleStyle, type SrtEntry, type SubtitleHighlight, type SubtitlePosition, type SubtitleStyle } from "@/types/timeline";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { SubtitleHighlightedText } from "./canvas-subtitle-text";
import { useTranslation } from "react-i18next";

type CanvasSubtitleDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    projectId: string;
    config: AiConfig;
    onClose: () => void;
    onSave: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
};

export function CanvasSubtitleDialog({ node, open, projectId, config, onClose, onSave }: CanvasSubtitleDialogProps) {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [entries, setEntries] = useState<SrtEntry[]>([]);
    const [highlights, setHighlights] = useState<SubtitleHighlight[]>([]);
    const [style, setStyle] = useState<SubtitleStyle>(createDefaultSubtitleStyle);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<SubtitleHighlightProgress | null>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
    const [previewBoxWidth, setPreviewBoxWidth] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [videoError, setVideoError] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const previewBoxRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    // 打开弹窗时从节点 metadata 同步字幕数据；关闭后卸载，重开重新读取。
    useEffect(() => {
        if (!open) return;
        setEntries(node.metadata?.subtitleEntries || []);
        setHighlights(node.metadata?.subtitleHighlights || []);
        setStyle(node.metadata?.subtitleStyle || createDefaultSubtitleStyle());
        setRunning(false);
        setProgress(null);
    }, [open, node]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    // 打开弹窗时解析视频地址，用于字幕叠加预览。
    // 远端资源优先走节点同款缓存下载（对象 URL），失败再退回资源代理地址。
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setCurrentTimeMs(0);
        setVideoSize(null);
        setVideoError(false);
        const storageKey = node.metadata?.storageKey || "";
        const fallback = node.metadata?.content || "";
        const applyUrl = (url: string) => {
            if (!cancelled) setVideoUrl(url);
        };
        if (resourceIdFromStorageKey(storageKey)) {
            void cacheResourceObjectUrl(storageKey)
                .then((cached) => {
                    if (cancelled) return;
                    if (cached) {
                        setVideoUrl(cached);
                    } else {
                        void resolveMediaUrl(storageKey, fallback).then(applyUrl);
                    }
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
    }, [open, node]);

    // 监听预览容器与视口尺寸，视频按分辨率等比缩放，不撑满也不变形。
    useEffect(() => {
        if (!open || !videoUrl) return;
        const measure = () => {
            setPreviewBoxWidth(previewBoxRef.current?.clientWidth || 0);
            setViewportHeight(window.innerHeight);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (previewBoxRef.current) observer.observe(previewBoxRef.current);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [open, videoUrl]);

    const previewDisplay = useMemo(() => {
        if (!videoSize || videoSize.height <= 0) return null;
        const maxHeight = Math.round((viewportHeight || window.innerHeight) * 0.45);
        const maxWidth = Math.max(1, previewBoxWidth || 800);
        const ratio = videoSize.width / videoSize.height;
        let width = Math.min(maxWidth, videoSize.width);
        let height = width / ratio;
        if (height > maxHeight) {
            height = maxHeight;
            width = Math.round(height * ratio);
        }
        return { width: Math.round(width), height: Math.round(height) };
    }, [previewBoxWidth, videoSize, viewportHeight]);

    const highlightByEntry = new Map(highlights.map((item) => [item.entryIndex, item]));
    const activeEntry = entries.find((entry) => currentTimeMs >= entry.startMs && currentTimeMs < entry.endMs);
    const activeHighlight = activeEntry ? highlightByEntry.get(activeEntry.index) : undefined;
    const activePositionClass = style.position === "top" ? "top-3" : style.position === "center" ? "top-1/2 -translate-y-1/2" : "bottom-4";

    const updateEntry = (position: number, patch: Partial<SrtEntry>) => {
        setEntries((current) => current.map((entry, idx) => (idx === position ? { ...entry, ...patch } : entry)));
    };

    const renumber = (list: SrtEntry[]) => list.map((entry, idx) => ({ ...entry, index: idx + 1 }));

    const normalizeEntries = (list: SrtEntry[]) =>
        renumber(
            list
                .filter((entry) => entry.text.trim())
                .map((entry) => ({ ...entry, startMs: Math.max(0, entry.startMs), endMs: Math.max(0, entry.endMs) }))
                .sort((a, b) => a.startMs - b.startMs || a.index - b.index),
        );

    const addEntry = () => {
        setEntries((current) => {
            const last = current[current.length - 1];
            const startMs = last ? last.endMs : 0;
            return [...current, { index: current.length + 1, startMs, endMs: startMs + 2_000, text: "" }];
        });
    };

    const deleteEntry = (position: number) => {
        const removed = entries[position];
        if (!removed) return;
        const next = normalizeEntries(entries.filter((_, idx) => idx !== position));
        const { remapped } = remapHighlightsAfterResegment(highlights, next);
        // 互通加固：逐条删除立即持久化到节点并同步时间线，与「清空全部」行为一致，
        // 避免删除后直接关闭弹窗（未点保存）导致重开视频节点旧字幕复活。
        setEntries(next);
        setHighlights(next.length ? remapped : []);
        onSave(node.id, {
            subtitleEntries: next,
            subtitleHighlights: next.length ? remapped : [],
            subtitleStyle: style,
            subtitleUpdatedAt: new Date().toISOString(),
        });
        message.success(next.length ? t("canvas:subtitle-deleted-and-synced-to-the-video-node-and-timeline") : t("canvas:subtitles-cleared-and-synced-to-the-video-node-and-timeline"));
    };

    const splitEntry = (position: number) => {
        const entry = entries[position];
        if (!entry || !entry.text.trim()) {
            message.warning(t("canvas:this-subtitle-has-nothing-to-split"));
            return;
        }
        const segments = splitLongEntry(entry, Math.max(2, Math.ceil(entry.text.length / 2)));
        const next = renumber([...entries.slice(0, position), ...segments, ...entries.slice(position + 1)]);
        setEntries(next);
        const { remapped } = remapHighlightsAfterResegment(highlights, next);
        setHighlights(remapped);
    };

    const seekToEntry = (entry: SrtEntry) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = Math.max(0, entry.startMs / 1000);
            setCurrentTimeMs(entry.startMs);
        }
    };

    const resegmentAll = () => {
        if (!entries.length) return;
        const maxChars = style.maxCharsPerEntry || DEFAULT_MAX_CHARS_PER_ENTRY;
        const next = resegmentSrtEntries(entries, maxChars);
        if (next.length === entries.length) {
            message.info(t("canvas:no-subtitle-exceeds-the-param-character-limit-nothing-to-split-lower-the", { maxChars: maxChars }));
            return;
        }
        setEntries(next);
        const { remapped, dropped } = remapHighlightsAfterResegment(highlights, next);
        setHighlights(remapped);
        message.success(t("canvas:auto-split-finished-param-param-entries", { length: entries.length, length_1: next.length }));
        if (dropped.length) message.info(t("canvas:removed-param-unmatched-old-highlights", { length: dropped.length }));
    };

    const importSrt = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const parsed = parseSrt(String(reader.result || ""));
            if (!parsed.length) {
                message.warning(t("canvas:no-valid-subtitles-parsed-the-file-must-be-srt-index-timecode-text-for-p"));
                return;
            }
            const autoSegmented = style.autoResegment ? resegmentSrtEntries(parsed, style.maxCharsPerEntry || DEFAULT_MAX_CHARS_PER_ENTRY) : parsed;
            setEntries(renumber(autoSegmented));
            setHighlights([]);
            message.success(
                autoSegmented.length > parsed.length
                    ? t("canvas:imported-param-subtitles-auto-split-to-param-entries-by-the-per-entry-li", { length: parsed.length, length_1: autoSegmented.length })
                    : t("canvas:imported-param-subtitles", { length: parsed.length }),
            );
        };
        reader.readAsText(file);
    };

    // 纯文本导入：一行一条字幕，按视频时长平均分配起止时间；视频时长未知时按每条 4 秒估算。
    const importPlainText = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const lines = String(reader.result || "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            if (!lines.length) {
                message.warning(t("canvas:no-importable-content-in-the-text"));
                return;
            }
            const durationMs = node.metadata?.durationMs;
            const stepMs = durationMs && durationMs > 0 ? durationMs / lines.length : 4_000;
            const entries: SrtEntry[] = lines.map((text, idx) => ({
                index: idx + 1,
                startMs: Math.round(idx * stepMs),
                endMs: Math.round((idx + 1) * stepMs),
                text,
            }));
            setEntries(entries);
            setHighlights([]);
            message.success(
                durationMs && durationMs > 0
                    ? t("canvas:imported-subtitles-allocated", { length: entries.length, duration: formatDurationMs(durationMs) })
                    : t("canvas:imported-param-subtitles-video-duration-unknown-estimated-4s-each", { length: entries.length }),
            );
        };
        reader.readAsText(file);
    };

    const exportSrt = () => {
        const content = serializeSrtEntries(entries);
        if (!content) {
            message.warning(t("canvas:no-subtitles-to-export"));
            return;
        }
        saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), `${node.title || "subtitle"}.srt`);
    };

    const runAiHighlight = async () => {
        if (!entries.length) {
            message.warning(t("canvas:add-subtitle-content-first"));
            return;
        }
        if (!isAiConfigReady(config, config.textModel)) {
            // 未配置文本模型时本地回退：按终止标点取首段作为高亮，保证功能不中断。
            setHighlights(buildFallbackHighlights(entries));
            message.info(t("canvas:no-text-model-configured-local-punctuation-based-highlighting-used"));
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setProgress({ batchIndex: 0, batchTotal: 1, processedEntries: 0, totalEntries: entries.length, percent: 0 });
        try {
            const nextHighlights = await generateSubtitleHighlights(entries, {
                projectId,
                nodeId: node.id,
                config,
                signal: controller.signal,
                onProgress: setProgress,
            });
            setHighlights(nextHighlights);
            message.success(t("canvas:generated-param-keyword-highlights", { length: nextHighlights.length }));
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            message.error(error instanceof Error ? error.message : t("canvas:keyword-highlighting-failed"));
        } finally {
            setRunning(false);
            setProgress(null);
            abortRef.current = null;
        }
    };

    const cancelAiHighlight = () => {
        abortRef.current?.abort();
    };

    const handleSave = () => {
        const normalized = normalizeEntries(entries);
        const { remapped } = remapHighlightsAfterResegment(highlights, normalized);
        onSave(node.id, {
            subtitleEntries: normalized,
            subtitleHighlights: normalized.length ? remapped : [],
            subtitleStyle: style,
            subtitleUpdatedAt: new Date().toISOString(),
        });
        message.success(normalized.length ? t("canvas:subtitles-saved") : t("canvas:subtitles-cleared-and-saved"));
        onClose();
    };

    const formatDurationMs = (ms: number) => {
        const seconds = Math.round(ms / 1000);
        return seconds >= 60 ? t("canvas:minutes-seconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : t("canvas:params-2", { seconds: seconds });
    };

    const previewBlock = (
        <div className="flex min-h-0 flex-col gap-2">
            <div ref={previewBoxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border" style={{ borderColor: theme.toolbar.border, background: "#000" }}>
                {videoUrl ? (
                    <div className="relative" style={previewDisplay ? { width: previewDisplay.width, height: previewDisplay.height } : { width: "100%", maxWidth: 640, aspectRatio: "16 / 9" }}>
                        <video
                            ref={videoRef}
                            className="block h-full w-full"
                            src={videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                if (video.videoWidth > 0 && video.videoHeight > 0) {
                                    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
                                }
                            }}
                            onError={() => setVideoError(true)}
                            onTimeUpdate={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
                        />
                        {videoError ? <div className="absolute inset-0 grid place-items-center text-xs opacity-70">{t("canvas:video-preview-failed-to-load-check-the-media-is-still-available-3")}</div> : null}
                        {activeEntry ? (
                            <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 ${activePositionClass}`}>
                                <span className="rounded-lg px-2 py-0.5 text-center leading-7" style={{ background: "rgba(0,0,0,.62)", color: style.color, fontSize: style.fontSize, borderRadius: style.highlightRadius, maxWidth: "90%" }}>
                                    <SubtitleHighlightedText text={activeEntry.text} highlight={activeHighlight} style={style} />
                                </span>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="grid h-40 w-full max-w-[640px] place-items-center px-4 text-center text-xs opacity-60">
                        {videoError ? t("canvas:video-preview-failed-to-load-check-the-media-is-still-available-3") : t("canvas:no-video-to-preview-yet-upload-or-generate-a-video-on-the-node-first")}
                    </div>
                )}
            </div>
            <div className="shrink-0 text-center text-xs opacity-40">{t("canvas:click-a-subtitle-entry-to-jump-to-preview-2")}</div>
        </div>
    );

    const styleControls = (
        <>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>{t("canvas:font-size-2")}</span>
                <InputNumber size="small" min={12} max={40} value={style.fontSize} onChange={(fontSize) => setStyle((current) => ({ ...current, fontSize: fontSize ?? current.fontSize }))} className="w-20" />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>{t("canvas:color-2")}</span>
                <ColorPicker size="small" value={style.color} onChange={(color) => setStyle((current) => ({ ...current, color: color.toHexString() }))} />
            </label>
            <div className="text-xs opacity-70">
                <div className="mb-1">{t("canvas:position-2")}</div>
                <Segmented
                    block
                    size="small"
                    value={style.position}
                    options={[
                        { label: t("canvas:top"), value: "top" },
                        { label: t("canvas:center"), value: "center" },
                        { label: t("canvas:bottom"), value: "bottom" },
                    ]}
                    onChange={(position) => setStyle((current) => ({ ...current, position: position as SubtitlePosition }))}
                />
            </div>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>{t("canvas:per-entry-limit-2")}</span>
                <span className="flex items-center gap-1">
                    <InputNumber
                        size="small"
                        min={MIN_CHARS_PER_ENTRY}
                        max={MAX_CHARS_PER_ENTRY_LIMIT}
                        value={style.maxCharsPerEntry}
                        onChange={(maxCharsPerEntry) => setStyle((current) => ({ ...current, maxCharsPerEntry: maxCharsPerEntry ?? DEFAULT_MAX_CHARS_PER_ENTRY }))}
                        className="w-20"
                    />
                    <span className="opacity-40">{t("canvas:item-9")}</span>
                </span>
            </label>
            <div className="border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                <div className="mb-2 flex items-center justify-between text-xs font-medium opacity-55">
                    <span>{t("canvas:keyword-highlighting-2")}</span>
                    <Switch size="small" checked={style.highlightEnabled} onChange={(highlightEnabled) => setStyle((current) => ({ ...current, highlightEnabled }))} />
                </div>
                <div className="space-y-2.5">
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>{t("canvas:background-color-2")}</span>
                        <ColorPicker size="small" value={style.highlightBackgroundColor} onChange={(color) => setStyle((current) => ({ ...current, highlightBackgroundColor: color.toHexString() }))} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>{t("canvas:text-color-3")}</span>
                        <ColorPicker size="small" value={style.highlightTextColor} onChange={(color) => setStyle((current) => ({ ...current, highlightTextColor: color.toHexString() }))} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>{t("canvas:padding-x-2")}</span>
                        <InputNumber size="small" min={0} max={24} value={style.highlightPaddingX} onChange={(highlightPaddingX) => setStyle((current) => ({ ...current, highlightPaddingX: highlightPaddingX ?? 0 }))} className="w-20" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>{t("canvas:padding-y-2")}</span>
                        <InputNumber size="small" min={0} max={24} value={style.highlightPaddingY} onChange={(highlightPaddingY) => setStyle((current) => ({ ...current, highlightPaddingY: highlightPaddingY ?? 0 }))} className="w-20" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>{t("canvas:corner-radius-2")}</span>
                        <InputNumber size="small" min={0} max={24} value={style.highlightRadius} onChange={(highlightRadius) => setStyle((current) => ({ ...current, highlightRadius: highlightRadius ?? 0 }))} className="w-20" />
                    </label>
                </div>
            </div>
        </>
    );

    const entriesBlock = (
        <div className="thin-scrollbar min-h-0 space-y-2 overflow-y-auto pr-1">
            {entries.length ? (
                entries.map((entry, idx) => {
                    const highlight = highlightByEntry.get(entry.index);
                    return (
                        <div
                            key={`${entry.index}-${idx}`}
                            className="cursor-pointer rounded-xl border p-2.5 transition-colors"
                            title={t("canvas:click-to-jump-to-this-subtitle-s-time")}
                            style={{ background: theme.node.fill, borderColor: activeEntry?.index === entry.index ? theme.accent.primary : theme.node.stroke }}
                            onClick={(event) => {
                                const target = event.target as HTMLElement;
                                if (target.closest("input,button,textarea")) return;
                                seekToEntry(entry);
                            }}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                    {idx + 1}
                                </span>
                                <InputNumber size="small" min={0} step={100} value={entry.startMs} onChange={(startMs) => updateEntry(idx, { startMs: startMs ?? 0 })} className="w-32" aria-label={t("canvas:entry-start-ms-aria", { index: idx + 1 })} />
                                <span className="text-xs opacity-40">→</span>
                                <InputNumber size="small" min={0} step={100} value={entry.endMs} onChange={(endMs) => updateEntry(idx, { endMs: endMs ?? 0 })} className="w-32" aria-label={t("canvas:entry-end-ms-aria", { index: idx + 1 })} />
                                <button
                                    type="button"
                                    title={t("canvas:split-this-subtitle")}
                                    className="ml-auto grid size-7 place-items-center rounded-lg border transition-colors hover:opacity-75"
                                    style={{ borderColor: theme.toolbar.border }}
                                    disabled={running}
                                    onClick={() => splitEntry(idx)}
                                >
                                    <Scissors className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    title={t("canvas:delete-this-subtitle")}
                                    className="grid size-7 place-items-center rounded-lg border text-red-500 transition-colors hover:opacity-75"
                                    style={{ borderColor: theme.toolbar.border }}
                                    disabled={running}
                                    onClick={() => deleteEntry(idx)}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                            <Input.TextArea value={entry.text} autoSize={{ minRows: 1, maxRows: 3 }} placeholder={t("canvas:subtitle-text")} className="mt-2" onChange={(event) => updateEntry(idx, { text: event.target.value })} />
                            {highlight ? (
                                <div className="mt-1.5 text-xs" style={{ color: theme.accent.primary }}>
                                    {t("canvas:highlights-2")}
                                    {highlight.highlightText}
                                </div>
                            ) : null}
                        </div>
                    );
                })
            ) : (
                <div className="grid h-40 place-items-center text-center">
                    <div className="text-xs opacity-45">
                        <ListPlus className="mx-auto mb-2 size-8" />
                        {t("canvas:no-subtitles-yet-import-srt-text-or-click-new-subtitle-in-the-toolbar-2")}
                    </div>
                </div>
            )}
        </div>
    );

    const title = (
        <div className="flex min-w-0 items-center gap-2.5 pr-10">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                <Captions className="size-4" />
            </span>
            <div className="min-w-0">
                <div className="truncate text-[var(--fs-heading-lg)] font-semibold leading-6 tracking-[-0.02em]">{t("canvas:subtitle-editor-4")}</div>
                <div className="truncate text-xs opacity-45">{node.title || t("canvas:video-node")}</div>
            </div>
        </div>
    );

    return (
        <Modal className="canvas-subtitle-dialog" title={title} open={open} centered footer={null} width={1120} destroyOnHidden onCancel={onClose} styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
            <div className="flex h-[min(72vh,680px)] min-h-[420px] flex-col text-sm" style={{ color: theme.node.text }}>
                <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".srt"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) importSrt(file);
                            event.target.value = "";
                        }}
                    />
                    <input
                        ref={textInputRef}
                        type="file"
                        accept=".txt,text/plain"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) importPlainText(file);
                            event.target.value = "";
                        }}
                    />
                    <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                        {t("canvas:import-srt-2")}
                    </Button>
                    <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => textInputRef.current?.click()}>
                        {t("canvas:import-text-2")}
                    </Button>
                    <Button size="small" icon={<FileDown className="size-3.5" />} disabled={!entries.length} onClick={exportSrt}>
                        {t("canvas:export-srt-2")}
                    </Button>
                    <Button size="small" icon={<Scissors className="size-3.5" />} disabled={!entries.length || running} onClick={resegmentAll}>
                        {t("canvas:auto-split-3")}
                    </Button>
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={running} onClick={addEntry}>
                        {t("canvas:new-subtitle-2")}
                    </Button>
                    <Button
                        size="small"
                        danger
                        icon={<Trash2 className="size-3.5" />}
                        disabled={!entries.length || running}
                        onClick={() =>
                            modal.confirm({
                                title: t("canvas:clear-all-subtitles"),
                                content: t("canvas:this-deletes-all-param-subtitles-and-keyword-highlights-this-cannot-be-u", { length: entries.length }),
                                okText: t("canvas:clear-4"),
                                okButtonProps: { danger: true },
                                cancelText: t("canvas:cancel-11"),
                                onOk: () => {
                                    // 互通加固：清空全部立即持久化到节点并同步时间线，避免清空后直接关闭弹窗（未点保存）导致重开视频节点旧字幕复活。
                                    onSave(node.id, {
                                        subtitleEntries: [],
                                        subtitleHighlights: [],
                                        subtitleStyle: style,
                                        subtitleUpdatedAt: new Date().toISOString(),
                                    });
                                    setEntries([]);
                                    setHighlights([]);
                                    message.success(t("canvas:all-subtitles-cleared-and-synced-to-the-video-node-and-timeline"));
                                },
                            })
                        }
                    >
                        {t("canvas:clear-all-2")}
                    </Button>
                    <Button
                        size="small"
                        type={running ? "default" : "primary"}
                        icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        disabled={!entries.length}
                        onClick={running ? cancelAiHighlight : () => void runAiHighlight()}
                    >
                        {running ? t("canvas:remove-highlight") : t("canvas:ai-keyword-highlighting")}
                    </Button>
                </div>

                {progress && running ? (
                    <div className="border-b px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                        <Progress
                            percent={progress.percent}
                            size="small"
                            format={() => t("canvas:progress-batch-summary", { processed: progress.processedEntries, total: progress.totalEntries, batchIndex: progress.batchIndex, batchTotal: progress.batchTotal })}
                        />
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 px-4 py-3">
                    <div className="grid h-full grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(230px,270px)] gap-3">
                        {entriesBlock}
                        {previewBlock}
                        <div className="thin-scrollbar min-h-0 space-y-3 overflow-y-auto pr-1">
                            <div className="text-xs font-medium opacity-55">{t("canvas:subtitle-style-2")}</div>
                            {styleControls}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                    <div className="text-xs opacity-45">
                        {entries.length} {t("canvas:subtitles-per-entry-limit-2")} {style.maxCharsPerEntry || DEFAULT_MAX_CHARS_PER_ENTRY} {t("canvas:item-9")}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button disabled={running} onClick={onClose}>
                            {t("canvas:cancel-11")}
                        </Button>
                        <Button type="primary" disabled={running} onClick={handleSave}>
                            {t("canvas:save-3")}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
