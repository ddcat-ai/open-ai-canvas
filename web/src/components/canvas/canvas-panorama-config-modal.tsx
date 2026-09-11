import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Compass, Copy, Globe, HelpCircle, Image as ImageIcon, Info, Plus, Search, Sparkles, Type, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type PanoramaProjection = "spherical" | "cylindrical";
export type PanoramaSourceMode = "ai" | "image";

export interface PanoramaReferenceImage {
    id: string;
    url: string;
    label: string;
    color?: string;
}

export interface PanoramaGenerateConfig {
    projection: PanoramaProjection;
    sourceMode: PanoramaSourceMode;
    referenceImages: PanoramaReferenceImage[];
    directImageUrl?: string | null;
    smartBase: boolean;
}

interface CanvasPanoramaConfigModalProps {
    open: boolean;
    onCancel: () => void;
    onConfirm: (composedPrompt: string, config: PanoramaGenerateConfig) => void;
    onCopyPrompt?: (prompt: string) => void;
    previewImageUrl?: string | null;
    initialProjection?: PanoramaProjection;
    initialSourceMode?: PanoramaSourceMode;
    initialSmartBase?: boolean;
    nodes: CanvasNodeData[];
}

const PANORAMA_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185", "#38bdf8", "#4ade80"];

function normalizeInitialSourceMode(mode: PanoramaSourceMode | undefined, hasPreview: boolean): PanoramaSourceMode {
    if (mode === "image") return "image";
    if (mode === "ai") return "ai";
    return hasPreview ? "image" : "ai";
}

function buildPanoramaPrompt(sourceMode: PanoramaSourceMode, projection: PanoramaProjection, userPrompt: string): string {
    const base = userPrompt.trim();

    const common = [
        "最终图像必须适合导入全景查看器，作为包裹场景的环境球内壁或水平环绕背景使用",
        "画面中不要出现摄影师、相机、镜头、三脚架、头显或任何拍摄设备",
        "不要分屏拼贴，不要多宫格，不要画中画，不要插入小图，只保留一个连续环境",
        "不要水印，不要文字，不要界面元素，不要边框，不要明显拼接线或接缝",
        "除非用户另有说明，保持真实摄影质感、电影级光影和自然空间纵深",
    ].join(", ");

    const projectionLabel = projection === "spherical" ? "720度球形" : "360度环绕";
    const ratio = projection === "spherical" ? "2:1" : "4:1";

    const fallbackText = `生成一张可用于全景查看器的完整沉浸式全景图，画面必须是比例${ratio}的等距柱状投影结构，宽度是高度的${projection === "spherical" ? "2倍" : "4倍"}，结合导入图片的主体、材质、色彩和风格，并根据文字描述补全四周环境、天空或天花板、地面或地板，让左右边缘自然衔接。${common}`;

    if (!base) {
        return fallbackText;
    }

    return `${base}。${fallbackText}`;
}

const PanoramaSetupForm = memo(
    ({
        onSubmit,
        onCopyPrompt,
        previewImageUrl,
        initialProjection = "spherical",
        initialSourceMode,
        initialSmartBase = true,
        canvasNodes,
    }: {
        onSubmit: (composedPrompt: string, config: PanoramaGenerateConfig) => void;
        onCopyPrompt?: (prompt: string) => void;
        previewImageUrl?: string | null;
        initialProjection?: PanoramaProjection;
        initialSourceMode?: PanoramaSourceMode;
        initialSmartBase?: boolean;
        canvasNodes: CanvasNodeData[];
    }) => {
        const [projection, setProjection] = useState<PanoramaProjection>(initialProjection);
        const [sourceMode, setSourceMode] = useState<PanoramaSourceMode>(normalizeInitialSourceMode(initialSourceMode, Boolean(previewImageUrl)));
        const [smartBase, setSmartBase] = useState(initialSmartBase);
        const [prompt, setPrompt] = useState("");
        const [showSmartHelp, setShowSmartHelp] = useState(false);
        const [assetQuery, setAssetQuery] = useState("");
        const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
        const [selectedIds, setSelectedIds] = useState<string[]>([]);
        const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);

        const canvasReferences = useMemo<PanoramaReferenceImage[]>(() => {
            const list: PanoramaReferenceImage[] = [];
            canvasNodes.forEach((node) => {
                if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return;
                const raw = node.metadata?.content;
                if (!raw) return;
                const label = (node.title || "").trim() || `图${list.length + 1}`;
                list.push({
                    id: node.id,
                    url: raw,
                    label,
                    color: PANORAMA_COLORS[list.length % PANORAMA_COLORS.length],
                });
            });
            return list;
        }, [canvasNodes]);

        const allReferences = useMemo<PanoramaReferenceImage[]>(() => {
            if (!previewImageUrl) return canvasReferences;
            const exists = canvasReferences.some((item) => item.url === previewImageUrl);
            if (exists) return canvasReferences;
            return [
                {
                    id: "selected-preview",
                    url: previewImageUrl,
                    label: "当前图片",
                    color: PANORAMA_COLORS[0],
                },
                ...canvasReferences,
            ];
        }, [canvasReferences, previewImageUrl]);

        useEffect(() => {
            if (selectedIds.length > 0) {
                const available = new Set(allReferences.map((item) => item.id));
                setSelectedIds((current) => current.filter((id) => available.has(id)));
                return;
            }
            if (previewImageUrl) {
                const first = allReferences.find((item) => item.url === previewImageUrl) ?? allReferences[0];
                if (first) setSelectedIds([first.id]);
            }
        }, [allReferences, previewImageUrl, selectedIds.length]);

        useEffect(() => {
            if (sourceMode !== "image") return;
            setSelectedIds((current) => (current.length > 1 ? current.slice(0, 1) : current));
            setDraftSelectedIds((current) => (current.length > 1 ? current.slice(0, 1) : current));
        }, [sourceMode]);

        const selectedReferences = useMemo(() => {
            const byId = new Map(allReferences.map((item) => [item.id, item]));
            return selectedIds.map((id) => byId.get(id)).filter((item): item is PanoramaReferenceImage => Boolean(item));
        }, [allReferences, selectedIds]);

        const filteredReferences = useMemo(() => {
            const query = assetQuery.trim().toLowerCase();
            if (!query) return allReferences;
            return allReferences.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(query));
        }, [allReferences, assetQuery]);

        const defaultAiPrompt = "生成一张可用于全景查看器的完整沉浸式全景图，画面必须是比例2比1的等距柱状投影结构，宽度是高度的2倍，结合导入图片的主体、材质、色彩和风格，并根据文字描述补全四周环境、天空或天花板、地面或地板，让左右边缘自然衔接";
        const effectivePrompt = sourceMode === "image" ? prompt.trim() : prompt.trim() || defaultAiPrompt;
        const composed = sourceMode === "image" ? effectivePrompt : buildPanoramaPrompt(sourceMode, projection, effectivePrompt);
        const directReference = selectedReferences[0] ?? null;

        const handleSubmit = useCallback(() => {
            if (sourceMode === "image" && !directReference) return;
            onSubmit(composed, {
                projection,
                sourceMode,
                smartBase,
                referenceImages: selectedReferences,
                directImageUrl: sourceMode === "image" ? (directReference?.url ?? null) : null,
            });
        }, [composed, directReference, onSubmit, projection, selectedReferences, smartBase, sourceMode]);

        const toggleDraftReference = (id: string) => {
            setDraftSelectedIds((current) => {
                if (sourceMode === "image") {
                    return current.includes(id) ? [] : [id];
                }
                return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
            });
        };

        const openAssetPicker = () => {
            setDraftSelectedIds(selectedIds);
            setIsAssetPickerOpen(true);
        };

        const confirmAssetPicker = () => {
            setSelectedIds(draftSelectedIds);
            setIsAssetPickerOpen(false);
        };

        const projectionButtons = (
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setProjection("spherical")}
                    className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition ${projection === "spherical" ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]"}`}
                >
                    <Globe className="h-3 w-3" /> 720°球体
                </button>
                <button
                    type="button"
                    onClick={() => setProjection("cylindrical")}
                    className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition ${projection === "cylindrical" ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]"}`}
                >
                    <Compass className="h-3 w-3" /> 360°环绕
                </button>
            </div>
        );

        const modeButtons = (
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setSourceMode("ai")}
                    className={`flex h-10 items-center justify-center gap-1 rounded-md border px-2 text-xs transition ${sourceMode !== "image" ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]"}`}
                >
                    <Type className="h-3 w-3" /> AI生成全景图
                </button>
                <button
                    type="button"
                    onClick={() => setSourceMode("image")}
                    className={`flex h-10 items-center justify-center gap-1 rounded-md border px-2 text-xs transition ${sourceMode === "image" ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]"}`}
                >
                    <ImageIcon className="h-3 w-3" /> 图生全景图
                </button>
            </div>
        );

        const smartControl = (
            <div className="relative flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => setSmartBase((current) => !current)}
                    className={`inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-xs transition-colors ${
                        smartBase ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                >
                    {smartBase && <CheckCircle2 className="h-3 w-3" />}
                    智能比例合成
                </button>
                <button
                    type="button"
                    onClick={() => setShowSmartHelp((current) => !current)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
                >
                    <HelpCircle className="h-3.5 w-3.5" />
                </button>
                {showSmartHelp && (
                    <div className="absolute bottom-full right-0 z-30 mb-2 w-[340px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11px] leading-5 text-[var(--color-text-muted)] shadow-2xl">
                        AI生成全景图会优先提交目标比例；如果供应商没有 2:1 / 4:1，会选择最接近的宽比例生成，再裁切、羽化并归一化。
                    </div>
                )}
            </div>
        );

        const body = (
            <div className="grid min-h-[560px] grid-cols-[270px_minmax(0,1fr)_330px]">
                <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
                    <div className="border-b border-[var(--color-border)] px-3 py-2">
                        <div className="text-xs font-semibold text-[var(--color-text)]">{sourceMode === "image" ? "全景源图（单张）" : "全景素材"}</div>
                        <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                            {sourceMode === "image" ? (selectedReferences.length > 0 ? "已选 1 张源图" : "请选择 1 张源图") : `${selectedReferences.length} / ${allReferences.length} 张已加入`}
                        </div>
                    </div>
                    <div className="ui-scrollbar nowheel flex-1 overflow-y-auto p-2">
                        <div className="space-y-2">
                            {selectedReferences.map((image, index) => (
                                <div key={image.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-1.5">
                                    <div className="aspect-video overflow-hidden rounded bg-[var(--color-bg-subtle)]">
                                        <img src={image.url} alt={image.label} className="h-full w-full object-cover" draggable={false} />
                                    </div>
                                    <div className="mt-1 flex items-center gap-1">
                                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: image.color }} />
                                        <div className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text)]">
                                            {sourceMode === "image" ? "源图" : `图${index + 1}`} · {image.label}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedIds((current) => current.filter((id) => id !== image.id))}
                                            className="rounded px-1 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
                                        >
                                            ×
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(sourceMode !== "image" || selectedReferences.length === 0) && (
                                <button
                                    type="button"
                                    onClick={openAssetPicker}
                                    className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                    title={sourceMode === "image" ? "选择全景源图" : "从资产加入图片"}
                                >
                                    <Plus className="h-6 w-6" />
                                </button>
                            )}
                            {sourceMode === "image" && selectedReferences.length > 0 && (
                                <button
                                    type="button"
                                    onClick={openAssetPicker}
                                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                                    title="替换源图"
                                >
                                    替换源图
                                </button>
                            )}
                        </div>
                    </div>
                </aside>

                <main className="flex min-w-0 flex-col gap-4 p-6">
                    <div className="relative">
                        <textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder={sourceMode === "image" ? "可选备注：使用现成图片作为全景源，不会提交给 AI" : "输入全景场景描述；文字+图片+内置全景提示词会一起提交"}
                            className="nodrag nowheel h-40 w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-accent)]"
                        />
                    </div>
                    {sourceMode === "ai" ? (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                            AI生成全景图会把文字、导入图片和内置全景提示词一起提交，目标是先得到 2:1 全景底图，再进入全景查看器。
                        </div>
                    ) : (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                            图生全景图只使用第一张源图作为全景底图。图片接近 {projection === "spherical" ? "2:1" : "4:1"} 时直接进入全景查看器；不符合时在本地裁切、羽化并归一化，不会提交给 AI。
                        </div>
                    )}
                    {sourceMode !== "image" && (
                        <details className="text-[11px] text-[var(--color-text-muted)]">
                            <summary className="cursor-pointer hover:text-[var(--color-text)]">查看最终提示词</summary>
                            <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--color-bg-subtle)] p-2 text-[11px] text-[var(--color-text-muted)]">{composed}</pre>
                        </details>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
                        {sourceMode !== "image" ? (
                            <div className="text-[11px] leading-5 text-[var(--color-text-muted)]">使用当前配置生成全景图。</div>
                        ) : (
                            <div className="text-[11px] leading-5 text-[var(--color-text-muted)]">使用现成图片作为全景源，比例处理在本地完成。</div>
                        )}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={sourceMode === "image" && !directReference}
                                className="flex h-8 items-center gap-1 whitespace-nowrap rounded-md bg-[var(--color-accent)] px-3 text-xs text-white hover:bg-[var(--color-accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {sourceMode === "image" ? <ImageIcon className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                                {sourceMode === "image" ? "创建全景图" : "生成全景图"}
                            </button>
                        </div>
                    </div>
                </main>

                <aside className="flex flex-col gap-4 border-l border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
                    <section className="flex flex-col gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">生成方式</div>
                        {modeButtons}
                    </section>
                    <section className="flex flex-col gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">投影方式</div>
                        {projectionButtons}
                    </section>
                    {projection === "cylindrical" && (
                        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-5 text-amber-700 dark:text-amber-200/85">360° 环绕更适合横向街景/长廊；普通全景建议使用 720° 球体。</div>
                    )}
                    <section className="flex flex-col gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">比例兜底</div>
                        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                            <span>
                                {sourceMode === "image"
                                    ? `本地检查源图比例；符合 ${projection === "spherical" ? "2:1" : "4:1"} 时直接使用，不符合时本地裁切、羽化并归一化。`
                                    : `会优先请求 ${projection === "spherical" ? "2:1" : "4:1"} 全景比例；如果当前供应商不支持，会自动改用最接近的宽比例，并在生成后走裁切/归一化兜底。`}
                            </span>
                        </div>
                        {sourceMode !== "image" && (
                            <div className="flex flex-col gap-2 pt-1">
                                {smartControl}
                                <button
                                    type="button"
                                    onClick={() => onCopyPrompt?.(composed)}
                                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)]"
                                    title="复制完整提示词到剪贴板"
                                >
                                    <Copy className="h-3 w-3" /> 复制提示词
                                </button>
                            </div>
                        )}
                    </section>
                </aside>
            </div>
        );

        return (
            <>
                {body}
                {isAssetPickerOpen && (
                    <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/35 backdrop-blur-sm">
                        <div className="w-[560px] max-w-[calc(100%-32px)] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
                            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold text-[var(--color-text)]">{sourceMode === "image" ? "选择要转换的全景源图" : "选择全景参考图"}</div>
                                    <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{sourceMode === "image" ? "图生全景图只使用一张现成图片作为全景源，不会提交给 AI" : "AI生成全景图支持多选，可作为风格 / 主体 / 元素参考"}</div>
                                </div>
                                <button type="button" onClick={() => setIsAssetPickerOpen(false)} className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="border-b border-[var(--color-border)] px-4 py-2">
                                <label className="flex h-8 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2">
                                    <Search className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                                    <input
                                        value={assetQuery}
                                        onChange={(event) => setAssetQuery(event.target.value)}
                                        placeholder="搜索图片名称"
                                        className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]/70"
                                    />
                                </label>
                            </div>
                            <div className="ui-scrollbar max-h-[380px] overflow-y-auto p-4">
                                {filteredReferences.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-xs text-[var(--color-text-muted)]">没有匹配的图片资产</div>
                                ) : (
                                    <div className="grid grid-cols-4 gap-2">
                                        {filteredReferences.map((image) => {
                                            const selected = draftSelectedIds.includes(image.id);
                                            return (
                                                <button
                                                    key={image.id}
                                                    type="button"
                                                    onClick={() => toggleDraftReference(image.id)}
                                                    className={`relative overflow-hidden rounded-lg border bg-[var(--color-bg)] text-left transition-colors ${
                                                        selected ? "border-[var(--color-accent)]/80 ring-1 ring-[var(--color-accent)]/50" : "border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
                                                    }`}
                                                >
                                                    <div className="aspect-square bg-[var(--color-bg-subtle)]">
                                                        <img src={image.url} alt={image.label} className="h-full w-full object-cover" draggable={false} />
                                                    </div>
                                                    <div className="truncate px-1.5 py-1 text-[10px] text-[var(--color-text)]">{image.label}</div>
                                                    {selected && <span className="absolute right-1 top-1 rounded bg-[var(--color-accent)] px-1 py-0.5 text-[9px] text-white">已选</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => setIsAssetPickerOpen(false)}
                                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmAssetPicker}
                                    disabled={sourceMode === "image" && draftSelectedIds.length === 0}
                                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white hover:bg-[var(--color-accent)]/90 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    {sourceMode === "image" ? (draftSelectedIds.length > 0 ? "使用此图" : "请选择一张源图") : `加入 ${draftSelectedIds.length} 张`}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    },
);

PanoramaSetupForm.displayName = "PanoramaSetupForm";

export function CanvasPanoramaConfigModal({ open, onCancel, onConfirm, onCopyPrompt, previewImageUrl, initialProjection, initialSourceMode, initialSmartBase, nodes }: CanvasPanoramaConfigModalProps) {
    return (
        <AppModal title="全景图生成" open={open} centered footer={null} width={980} flush onCancel={onCancel}>
            <div className="flex flex-col">
                <div className="relative">
                    <PanoramaSetupForm
                        onSubmit={onConfirm}
                        onCopyPrompt={onCopyPrompt}
                        previewImageUrl={previewImageUrl}
                        initialProjection={initialProjection}
                        initialSourceMode={initialSourceMode}
                        initialSmartBase={initialSmartBase}
                        canvasNodes={nodes}
                    />
                </div>
            </div>
        </AppModal>
    );
}
