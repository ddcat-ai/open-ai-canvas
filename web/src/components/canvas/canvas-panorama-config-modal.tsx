import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Switch } from "antd";
import { Check, Compass, Copy, Globe, Image as ImageIcon, Info, Plus, Search, Sparkles, X } from "lucide-react";

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
        onCancel,
        onCopyPrompt,
        previewImageUrl,
        initialProjection = "spherical",
        initialSourceMode,
        initialSmartBase = true,
        canvasNodes,
    }: {
        onSubmit: (composedPrompt: string, config: PanoramaGenerateConfig) => void;
        onCancel: () => void;
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
        const [assetQuery, setAssetQuery] = useState("");
        const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
        const [selectedIds, setSelectedIds] = useState<string[]>([]);
        const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);
        const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
        const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

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
        const outputRatio = projection === "spherical" ? "2:1" : "4:1";
        const canSubmit = sourceMode === "ai" || Boolean(directReference);

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

        useEffect(() => {
            const onKeyDown = (event: KeyboardEvent) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    handleSubmit();
                }
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
        }, [handleSubmit]);

        const markImageLoaded = useCallback((id: string) => {
            setLoadedImages((current) => (current[id] ? current : { ...current, [id]: true }));
        }, []);

        const markImageFailed = useCallback((id: string) => {
            setFailedImages((current) => (current[id] ? current : { ...current, [id]: true }));
        }, []);

        const trackImageReady = useCallback(
            (id: string) => (element: HTMLImageElement | null) => {
                if (element?.complete && element.naturalWidth > 0) markImageLoaded(id);
            },
            [markImageLoaded],
        );

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

        const renderImageSurface = (image: PanoramaReferenceImage, surfaceClass: string) => {
            const loaded = loadedImages[image.id];
            const failed = failedImages[image.id];
            return (
                <div className={`relative overflow-hidden bg-foreground/5 ${surfaceClass}`}>
                    <img
                        src={image.url}
                        alt={image.label}
                        draggable={false}
                        ref={trackImageReady(image.id)}
                        onLoad={() => markImageLoaded(image.id)}
                        onError={() => markImageFailed(image.id)}
                        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded && !failed ? "opacity-100" : "opacity-0"}`}
                    />
                    {!failed && !loaded && <div className="absolute inset-0 animate-pulse bg-foreground/5" />}
                    {failed && (
                        <div className="absolute inset-0 grid place-items-center">
                            <span className="px-2 text-center text-[11px] leading-4 text-foreground/40">加载失败</span>
                        </div>
                    )}
                </div>
            );
        };

        const thumbSizeClass = sourceMode === "image" ? "w-[140px]" : "w-[100px]";

        const selectedThumb = (image: PanoramaReferenceImage, index: number) => (
            <div key={image.id} className={`group relative shrink-0 ${thumbSizeClass}`}>
                {renderImageSurface(image, "aspect-[4/3] rounded-[var(--r-md)]")}
                <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                    <span className="size-1 rounded-full" style={{ backgroundColor: image.color }} />
                    {sourceMode === "image" ? "源图" : `${index + 1}`}
                </span>
                <button
                    type="button"
                    onClick={() => setSelectedIds((current) => current.filter((id) => id !== image.id))}
                    aria-label={`移除${image.label}`}
                    className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                    <X className="size-3" />
                </button>
            </div>
        );

        const addTile = (
            <button
                type="button"
                onClick={openAssetPicker}
                className={`flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-[var(--r-md)] bg-foreground/5 text-[10px] font-medium text-foreground/45 transition-colors hover:bg-foreground/10 hover:text-foreground/65 ${thumbSizeClass} aspect-[4/3]`}
            >
                <Plus className="size-4" strokeWidth={1.8} />
                <span>添加</span>
            </button>
        );

        return (
            <>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
                    <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] bg-foreground/5 text-foreground/70">
                            <Globe className="size-3.5" strokeWidth={1.8} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-[13px] font-semibold leading-tight">全景图生成</h2>
                            <p className="text-[10px] text-foreground/45">AI 补全环境或直接转换</p>
                        </div>
                    </header>

                    <main className="ui-scrollbar nowheel min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-3">
                        <div className="space-y-3">
                            {/* 生成方式 */}
                            <div>
                                <div className="mb-1.5 text-[11px] font-semibold text-foreground">生成方式</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        aria-pressed={sourceMode === "ai"}
                                        onClick={() => setSourceMode("ai")}
                                        className={`flex items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2 text-left transition-all ${
                                            sourceMode === "ai"
                                                ? "bg-accent text-white"
                                                : "bg-foreground/5 text-foreground hover:bg-foreground/10"
                                        }`}
                                    >
                                        <Sparkles className="size-4 shrink-0" />
                                        <div className="min-w-0">
                                            <div className="text-[11px] font-semibold">AI 生成</div>
                                            <div className="text-[9px] leading-tight opacity-75">补全环境</div>
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={sourceMode === "image"}
                                        onClick={() => setSourceMode("image")}
                                        className={`flex items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2 text-left transition-all ${
                                            sourceMode === "image"
                                                ? "bg-accent text-white"
                                                : "bg-foreground/5 text-foreground hover:bg-foreground/10"
                                        }`}
                                    >
                                        <ImageIcon className="size-4 shrink-0" />
                                        <div className="min-w-0">
                                            <div className="text-[11px] font-semibold">图片直出</div>
                                            <div className="text-[9px] leading-tight opacity-75">直接转换</div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* 参考图 / 源图 */}
                            <div>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-semibold text-foreground">{sourceMode === "image" ? "全景源图" : "参考图"}</div>
                                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={openAssetPicker} className="!h-6 !px-2 !text-[10px]">
                                        {sourceMode === "image" && selectedReferences.length > 0 ? "替换" : "添加"}
                                    </Button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedReferences.map((image, index) => selectedThumb(image, index))}
                                    {sourceMode !== "image" && addTile}
                                    {sourceMode === "image" && selectedReferences.length === 0 && addTile}
                                </div>
                            </div>

                            {/* 场景描述 */}
                            {sourceMode === "ai" && (
                                <div>
                                    <div className="mb-1.5 text-[11px] font-semibold text-foreground">场景描述</div>
                                    <Input.TextArea
                                        value={prompt}
                                        onChange={(event) => setPrompt(event.target.value)}
                                        placeholder="例如：黄昏的海边木屋，能看到天空、地面和四周环境"
                                        autoSize={{ minRows: 2, maxRows: 4 }}
                                    />
                                </div>
                            )}

                            {/* 全景类型 */}
                            <div>
                                <div className="mb-1.5 text-[11px] font-semibold text-foreground">全景类型</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(
                                        [
                                            { value: "spherical" as const, icon: Globe, title: "球形全景", desc: "720° 沉浸式", ratio: "2:1" },
                                            { value: "cylindrical" as const, icon: Compass, title: "环绕全景", desc: "360° 街景", ratio: "4:1" },
                                        ] as const
                                    ).map((option) => {
                                        const selected = projection === option.value;
                                        const Icon = option.icon;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => setProjection(option.value)}
                                                className={`flex items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2 text-left transition-all ${
                                                    selected
                                                        ? "bg-accent text-white"
                                                        : "bg-foreground/5 text-foreground hover:bg-foreground/10"
                                                }`}
                                            >
                                                <Icon className="size-4 shrink-0" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[11px] font-semibold">{option.title}</span>
                                                        <span className={`rounded-sm px-1 py-px text-[9px] font-medium ${selected ? "bg-white/20" : "bg-foreground/8 text-foreground/55"}`}>{option.ratio}</span>
                                                    </div>
                                                    <div className={`text-[9px] leading-tight ${selected ? "opacity-80" : "text-foreground/50"}`}>{option.desc}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 高级选项 */}
                            <div>
                                <div className="mb-1.5 text-[11px] font-semibold text-foreground">高级选项</div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-3 rounded-[var(--r-md)] bg-foreground/5 px-2.5 py-1.5">
                                        <div className="min-w-0">
                                            <div className="text-[11px] font-semibold text-foreground">智能比例</div>
                                            <div className="text-[9px] leading-tight text-foreground/50">模型不支持时自动裁切</div>
                                        </div>
                                        <Switch size="small" checked={smartBase} onChange={setSmartBase} />
                                    </div>
                                    {sourceMode === "ai" && (
                                        <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => onCopyPrompt?.(composed)} className="!h-6 !px-2 !text-[10px]">
                                            复制完整提示词
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </main>

                    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-2.5">
                        <span className={`truncate text-[10px] ${canSubmit ? "text-foreground/45" : "text-amber-500"}`}>
                            {sourceMode === "image" ? (directReference ? "已选源图" : "请选择源图") : selectedReferences.length > 0 ? `${selectedReferences.length} 张参考图` : "无参考图"}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button size="small" onClick={onCancel}>
                                取消
                            </Button>
                            <Button size="small" type="primary" icon={sourceMode === "image" ? <ImageIcon className="size-3.5" /> : <Sparkles className="size-3.5" />} disabled={!canSubmit} onClick={handleSubmit}>
                                {sourceMode === "image" ? "创建全景图" : "生成全景图"}
                            </Button>
                        </div>
                    </footer>
                </div>

                {/* 选图面板 */}
                {isAssetPickerOpen && (
                    <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                        <div className="flex max-h-full w-[500px] max-w-full flex-col overflow-hidden rounded-[var(--r-lg)] border border-border bg-background shadow-2xl">
                            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-foreground">{sourceMode === "image" ? "选择源图" : "选择参考图"}</div>
                                    <div className="mt-0.5 text-[11px] text-foreground/45">
                                        {sourceMode === "image" ? "只选一张作为全景源" : `已选 ${draftSelectedIds.length} 张`}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsAssetPickerOpen(false)}
                                    aria-label="关闭"
                                    className="grid size-6 shrink-0 place-items-center rounded-[var(--r-md)] text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground"
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="border-b border-border px-5 py-2">
                                <Input size="small" allowClear value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="搜索图片名称" prefix={<Search className="size-3.5 text-foreground/35" />} />
                            </div>
                            <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                                {filteredReferences.length === 0 ? (
                                    <div className="rounded-[var(--r-md)] bg-foreground/5 px-4 py-8 text-center text-[11px] text-foreground/45">没有匹配的图片</div>
                                ) : (
                                    <div className="grid grid-cols-5 gap-2">
                                        {filteredReferences.map((image) => {
                                            const selected = draftSelectedIds.includes(image.id);
                                            const failed = failedImages[image.id];
                                            const loaded = loadedImages[image.id];
                                            return (
                                                <button
                                                    key={image.id}
                                                    type="button"
                                                    onClick={() => toggleDraftReference(image.id)}
                                                    aria-pressed={selected}
                                                    className={`group relative overflow-hidden rounded-[var(--r-md)] transition-shadow ${selected ? "ring-2 ring-accent" : ""}`}
                                                >
                                                    {renderImageSurface(image, "aspect-square w-full")}
                                                    {selected && (
                                                        <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-accent text-white">
                                                            <Check className="size-2.5" />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                                <Button size="small" onClick={() => setIsAssetPickerOpen(false)}>
                                    取消
                                </Button>
                                <Button size="small" type="primary" disabled={sourceMode === "image" && draftSelectedIds.length === 0} onClick={confirmAssetPicker}>
                                    {sourceMode === "image" ? "使用此图" : `加入 ${draftSelectedIds.length}`}
                                </Button>
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
        <AppModal open={open} centered footer={null} width={680} flush onCancel={onCancel}>
            <div className="flex min-h-0 flex-col overflow-hidden" style={{ maxHeight: "min(640px, calc(100vh - 100px))" }}>
                <div className="relative flex min-h-0 flex-1">
                    <PanoramaSetupForm
                        onSubmit={onConfirm}
                        onCancel={onCancel}
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
