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

type CanvasSubtitleDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    projectId: string;
    config: AiConfig;
    onClose: () => void;
    onSave: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
};

export function CanvasSubtitleDialog({ node, open, projectId, config, onClose, onSave }: CanvasSubtitleDialogProps) {
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
        message.success(next.length ? "已删除该条字幕并同步到视频节点与时间线" : "字幕已清空并同步到视频节点与时间线");
    };

    const splitEntry = (position: number) => {
        const entry = entries[position];
        if (!entry || !entry.text.trim()) {
            message.warning("该条字幕没有可切分的内容");
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
            message.info(`所有字幕均未超过单条上限 ${maxChars} 字，无需切分；可在“字幕样式”中调低上限后重试`);
            return;
        }
        setEntries(next);
        const { remapped, dropped } = remapHighlightsAfterResegment(highlights, next);
        setHighlights(remapped);
        message.success(`自动切分完成：${entries.length} 条 → ${next.length} 条`);
        if (dropped.length) message.info(`已移除 ${dropped.length} 条未能匹配的旧高亮`);
    };

    const importSrt = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const parsed = parseSrt(String(reader.result || ""));
            if (!parsed.length) {
                message.warning("未解析到有效字幕：文件需为 SRT 格式（序号 + 时间码 + 正文），纯文本请用“导入文本”");
                return;
            }
            const autoSegmented = style.autoResegment ? resegmentSrtEntries(parsed, style.maxCharsPerEntry || DEFAULT_MAX_CHARS_PER_ENTRY) : parsed;
            setEntries(renumber(autoSegmented));
            setHighlights([]);
            message.success(autoSegmented.length > parsed.length ? `已导入 ${parsed.length} 条字幕，按单条上限自动切分为 ${autoSegmented.length} 条` : `已导入 ${parsed.length} 条字幕`);
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
                message.warning("文本中没有可导入的内容");
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
            message.success(durationMs && durationMs > 0 ? `已导入 ${entries.length} 条字幕，按视频时长 ${formatDurationMs(durationMs)} 平均分配` : `已导入 ${entries.length} 条字幕（视频时长未知，按每条 4 秒估算）`);
        };
        reader.readAsText(file);
    };

    const exportSrt = () => {
        const content = serializeSrtEntries(entries);
        if (!content) {
            message.warning("暂无字幕可导出");
            return;
        }
        saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), `${node.title || "subtitle"}.srt`);
    };

    const runAiHighlight = async () => {
        if (!entries.length) {
            message.warning("请先添加字幕内容");
            return;
        }
        if (!isAiConfigReady(config, config.textModel)) {
            // 未配置文本模型时本地回退：按终止标点取首段作为高亮，保证功能不中断。
            setHighlights(buildFallbackHighlights(entries));
            message.info("未配置可用的文本模型，已使用本地标点高亮");
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
            message.success(`已生成 ${nextHighlights.length} 条关键词高亮`);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            message.error(error instanceof Error ? error.message : "关键词高亮生成失败");
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
        message.success(normalized.length ? "字幕已保存" : "字幕已清空并保存");
        onClose();
    };

    const formatDurationMs = (ms: number) => {
        const seconds = Math.round(ms / 1000);
        return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
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
                        {videoError ? <div className="absolute inset-0 grid place-items-center text-xs opacity-70">视频预览加载失败，请检查素材是否仍然可用</div> : null}
                        {activeEntry ? (
                            <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 ${activePositionClass}`}>
                                <span className="rounded-lg px-2 py-0.5 text-center leading-7" style={{ background: "rgba(0,0,0,.62)", color: style.color, fontSize: style.fontSize, borderRadius: style.highlightRadius, maxWidth: "90%" }}>
                                    <SubtitleHighlightedText text={activeEntry.text} highlight={activeHighlight} style={style} />
                                </span>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="grid h-40 w-full max-w-[640px] place-items-center px-4 text-center text-xs opacity-60">{videoError ? "视频预览加载失败，请检查素材是否仍然可用" : "暂无视频素材可预览，可先在节点上传或生成视频"}</div>
                )}
            </div>
            <div className="shrink-0 text-center text-xs opacity-40">点击字幕条目可跳转预览</div>
        </div>
    );

    const styleControls = (
        <>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>字号</span>
                <InputNumber size="small" min={12} max={40} value={style.fontSize} onChange={(fontSize) => setStyle((current) => ({ ...current, fontSize: fontSize ?? current.fontSize }))} className="w-20" />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>颜色</span>
                <ColorPicker size="small" value={style.color} onChange={(color) => setStyle((current) => ({ ...current, color: color.toHexString() }))} />
            </label>
            <div className="text-xs opacity-70">
                <div className="mb-1">位置</div>
                <Segmented
                    block
                    size="small"
                    value={style.position}
                    options={[
                        { label: "顶部", value: "top" },
                        { label: "居中", value: "center" },
                        { label: "底部", value: "bottom" },
                    ]}
                    onChange={(position) => setStyle((current) => ({ ...current, position: position as SubtitlePosition }))}
                />
            </div>
            <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                <span>单条上限</span>
                <span className="flex items-center gap-1">
                    <InputNumber
                        size="small"
                        min={MIN_CHARS_PER_ENTRY}
                        max={MAX_CHARS_PER_ENTRY_LIMIT}
                        value={style.maxCharsPerEntry}
                        onChange={(maxCharsPerEntry) => setStyle((current) => ({ ...current, maxCharsPerEntry: maxCharsPerEntry ?? DEFAULT_MAX_CHARS_PER_ENTRY }))}
                        className="w-20"
                    />
                    <span className="opacity-40">字</span>
                </span>
            </label>
            <div className="border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                <div className="mb-2 flex items-center justify-between text-xs font-medium opacity-55">
                    <span>关键词高亮</span>
                    <Switch size="small" checked={style.highlightEnabled} onChange={(highlightEnabled) => setStyle((current) => ({ ...current, highlightEnabled }))} />
                </div>
                <div className="space-y-2.5">
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>背景色</span>
                        <ColorPicker size="small" value={style.highlightBackgroundColor} onChange={(color) => setStyle((current) => ({ ...current, highlightBackgroundColor: color.toHexString() }))} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>文字色</span>
                        <ColorPicker size="small" value={style.highlightTextColor} onChange={(color) => setStyle((current) => ({ ...current, highlightTextColor: color.toHexString() }))} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>内边距 X</span>
                        <InputNumber size="small" min={0} max={24} value={style.highlightPaddingX} onChange={(highlightPaddingX) => setStyle((current) => ({ ...current, highlightPaddingX: highlightPaddingX ?? 0 }))} className="w-20" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>内边距 Y</span>
                        <InputNumber size="small" min={0} max={24} value={style.highlightPaddingY} onChange={(highlightPaddingY) => setStyle((current) => ({ ...current, highlightPaddingY: highlightPaddingY ?? 0 }))} className="w-20" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs opacity-70">
                        <span>圆角</span>
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
                            title="点击跳转到该条字幕时间"
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
                                <InputNumber size="small" min={0} step={100} value={entry.startMs} onChange={(startMs) => updateEntry(idx, { startMs: startMs ?? 0 })} className="w-32" aria-label={`第 ${idx + 1} 条开始时间（毫秒）`} />
                                <span className="text-xs opacity-40">→</span>
                                <InputNumber size="small" min={0} step={100} value={entry.endMs} onChange={(endMs) => updateEntry(idx, { endMs: endMs ?? 0 })} className="w-32" aria-label={`第 ${idx + 1} 条结束时间（毫秒）`} />
                                <button
                                    type="button"
                                    title="切分这条字幕"
                                    className="ml-auto grid size-7 place-items-center rounded-lg border transition-colors hover:opacity-75"
                                    style={{ borderColor: theme.toolbar.border }}
                                    disabled={running}
                                    onClick={() => splitEntry(idx)}
                                >
                                    <Scissors className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    title="删除这条字幕"
                                    className="grid size-7 place-items-center rounded-lg border text-red-500 transition-colors hover:opacity-75"
                                    style={{ borderColor: theme.toolbar.border }}
                                    disabled={running}
                                    onClick={() => deleteEntry(idx)}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                            <Input.TextArea value={entry.text} autoSize={{ minRows: 1, maxRows: 3 }} placeholder="字幕文本" className="mt-2" onChange={(event) => updateEntry(idx, { text: event.target.value })} />
                            {highlight ? (
                                <div className="mt-1.5 text-xs" style={{ color: theme.accent.primary }}>
                                    重点：{highlight.highlightText}
                                </div>
                            ) : null}
                        </div>
                    );
                })
            ) : (
                <div className="grid h-40 place-items-center text-center">
                    <div className="text-xs opacity-45">
                        <ListPlus className="mx-auto mb-2 size-8" />
                        还没有字幕：导入 SRT 或文本文件，或点击工具栏“新增字幕”。
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
                <div className="truncate text-[var(--fs-heading-lg)] font-semibold leading-6 tracking-[-0.02em]">字幕编辑</div>
                <div className="truncate text-xs opacity-45">{node.title || "视频节点"}</div>
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
                        导入 SRT
                    </Button>
                    <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => textInputRef.current?.click()}>
                        导入文本
                    </Button>
                    <Button size="small" icon={<FileDown className="size-3.5" />} disabled={!entries.length} onClick={exportSrt}>
                        导出 SRT
                    </Button>
                    <Button size="small" icon={<Scissors className="size-3.5" />} disabled={!entries.length || running} onClick={resegmentAll}>
                        自动切分
                    </Button>
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={running} onClick={addEntry}>
                        新增字幕
                    </Button>
                    <Button
                        size="small"
                        danger
                        icon={<Trash2 className="size-3.5" />}
                        disabled={!entries.length || running}
                        onClick={() =>
                            modal.confirm({
                                title: "清空全部字幕",
                                content: `将删除全部 ${entries.length} 条字幕及关键词高亮，此操作不可撤销。`,
                                okText: "清空",
                                okButtonProps: { danger: true },
                                cancelText: "取消",
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
                                    message.success("已清空全部字幕并同步到视频节点与时间线");
                                },
                            })
                        }
                    >
                        清空全部
                    </Button>
                    <Button
                        size="small"
                        type={running ? "default" : "primary"}
                        icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        disabled={!entries.length}
                        onClick={running ? cancelAiHighlight : () => void runAiHighlight()}
                    >
                        {running ? "取消高亮" : "AI 关键词高亮"}
                    </Button>
                </div>

                {progress && running ? (
                    <div className="border-b px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                        <Progress percent={progress.percent} size="small" format={() => `${progress.processedEntries}/${progress.totalEntries} 条 · 批次 ${progress.batchIndex}/${progress.batchTotal}`} />
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 px-4 py-3">
                    <div className="grid h-full grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(230px,270px)] gap-3">
                        {entriesBlock}
                        {previewBlock}
                        <div className="thin-scrollbar min-h-0 space-y-3 overflow-y-auto pr-1">
                            <div className="text-xs font-medium opacity-55">字幕样式</div>
                            {styleControls}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                    <div className="text-xs opacity-45">
                        {entries.length} 条字幕 · 单条上限 {style.maxCharsPerEntry || DEFAULT_MAX_CHARS_PER_ENTRY} 字
                    </div>
                    <div className="flex items-center gap-2">
                        <Button disabled={running} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" disabled={running} onClick={handleSave}>
                            保存
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
