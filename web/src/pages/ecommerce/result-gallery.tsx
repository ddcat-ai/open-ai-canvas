import { Button, Input, Popconfirm, Popover, Select } from "antd";
import { ArrowDownToLine, Crop, Images, Languages, Layers3, Maximize2, Paintbrush2, RotateCcw, RotateCw, Scissors, Sparkles, Trash2, Type, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ModelPicker } from "@/components/model-picker";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resolveResourceVariantUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";
import { imageSizeLabel, imageTypes, labelOf } from "./catalog";
import { commerceGenerationRatio, commerceImageReferences } from "./workflow";
import type { EcommerceExportItem } from "./export";
import { writeCommerceImageTransfer } from "./image-transfer";
import { commerceCanvasAspect } from "./canvas-layout";
import { CommerceGeneratingArtwork, CommerceResultImage } from "./result-image";
import { commerceCopyHasDirections } from "./consumer-copy";

export function imageResultAsset(task?: GenerationTask) {
    return task?.outputs?.find((output) => output.materializedAssetId)?.materializedAssetId;
}

const pendingImageTools = [
    { label: "裁剪", icon: Crop },
    { label: "图层分离", icon: Layers3 },
    { label: "AI 抠图", icon: Scissors },
    { label: "局部重绘", icon: Paintbrush2 },
    { label: "智能延展", icon: Maximize2 },
    { label: "无损放大", icon: Maximize2 },
    { label: "图片翻译", icon: Languages },
    { label: "AI 超清", icon: Sparkles },
    { label: "编辑文字", icon: Type },
    { label: "爆款图片复刻", icon: Images },
] as const;

export function SingleImageEditor({
    config,
    draft,
    image,
    imageModels,
    onClose,
    onGenerate,
}: {
    config: AiConfig;
    draft: EcommerceDraft;
    image: EcommercePlanImage;
    imageModels: string[];
    onClose: () => void;
    onGenerate: (image: EcommercePlanImage) => Promise<void>;
}) {
    const [edited, setEdited] = useState<EcommercePlanImage>(() => ({
        ...image,
        copy: "",
        manualPrompt: true,
        prompt: image.manualPrompt
            ? image.prompt
            : [image.prompt, image.copy?.trim() && !commerceCopyHasDirections(image.copy) ? `成品文案与位置：\n${image.copy}\n文字完整放在画幅内，按本提示词指定位置排版，不遮挡商品。` : ""].filter(Boolean).join("\n\n"),
    }));
    const [request, setRequest] = useState("");
    const [cost, setCost] = useState<number>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const profile = modelCapabilityConfigFor(config, edited.imageModel).image;
    const refs = commerceImageReferences(draft, edited, 0, false);
    // Quote the size the image is generated at (自动 resolves to the platform recommendation).
    const quotedRatio = commerceGenerationRatio(config, draft, edited);
    useEffect(() => {
        const controller = new AbortController();
        setCost(undefined);
        setError("");
        const request = systemModelQuoteRequest(config, edited.imageModel, "image", {
            capability: "image",
            input: { textCount: 1, imageCount: refs.length, referenceImageCount: refs.length, videoCount: 0, audioCount: 0, characterCount: 0 },
            imageSize: quotedRatio,
            options: { size: quotedRatio, imageResolution: edited.resolution, count: 1 },
        });
        if (request)
            void quoteModel(request, controller.signal)
                .then((value) => {
                    if (!controller.signal.aborted) setCost(value.quote.amountMicrocredits / 1_000_000);
                })
                .catch((cause) => {
                    if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "报价失败");
                });
        else setError("当前模型无法使用这些参数，请重新选择");
        return () => controller.abort();
    }, [config, edited.imageModel, quotedRatio, edited.resolution, refs.length]);
    return (
        <section className="ecommerce-image-editor" aria-label="单张图片 AI 编辑">
            <header>
                <div>
                    <Sparkles size={17} />
                    <strong>重新编辑这张图片</strong>
                </div>
                <Button type="text" aria-label="关闭图片编辑" icon={<X size={17} />} onClick={onClose} disabled={busy} />
            </header>
            <p>写下想调整的画面、文字或布局，让这张作品更贴近你的想法。</p>
            <label className="ecommerce-field">
                <span>修改要求</span>
                <Input.TextArea aria-label="图片修改要求" placeholder="例如：标题分成两行，留白再多一些，保留商品原有颜色" autoSize={{ minRows: 4, maxRows: 8 }} value={request} onChange={(event) => setRequest(event.target.value)} />
            </label>
            <label className="ecommerce-field">
                <span>图片模型</span>
                <ModelPicker
                    config={config}
                    capability="image"
                    value={edited.imageModel}
                    modelFilter={(value) => imageModels.includes(value) && (modelCapabilityConfigFor(config, value).image?.references.maxImages || 0) >= refs.length}
                    requirements={{ input: { textCount: 1, imageCount: refs.length, referenceImageCount: refs.length, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                    fullWidth
                    showOptionPrices
                    onChange={(value) => {
                        const next = modelCapabilityConfigFor(config, value).image;
                        setEdited({ ...edited, imageModel: value, ratio: next?.size.default || "1:1", resolution: next?.resolution.supported ? next.resolution.default : next?.quality.default || "auto" });
                    }}
                />
            </label>
            <div className="ecommerce-image-editor-parameters">
                <label className="ecommerce-field">
                    <span>图片比例</span>
                    <Select aria-label="单图图片比例" value={edited.ratio} options={profile?.size.values.map((value) => ({ value, label: imageSizeLabel(value) }))} onChange={(ratio) => setEdited({ ...edited, ratio })} />
                </label>
                <label className="ecommerce-field">
                    <span>分辨率 / 画质</span>
                    <Select
                        aria-label="单图分辨率"
                        value={edited.resolution}
                        options={(profile?.resolution.supported ? profile.resolution.values : [profile?.quality.default || "auto"]).map((value) => ({ value, label: value.toUpperCase() }))}
                        onChange={(resolution) => setEdited({ ...edited, resolution })}
                    />
                </label>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <footer>
                <span>
                    1 张 · {cost == null ? "正在计算积分" : "预计 "}
                    <RollingCreditAmount value={cost ?? null} />
                    {cost == null ? null : " 积分"}
                </span>
                <Button
                    type="primary"
                    icon={<Sparkles size={15} />}
                    loading={busy}
                    disabled={cost == null || !request.trim()}
                    onClick={async () => {
                        if (lock.current) return;
                        lock.current = true;
                        setBusy(true);
                        setError("");
                        try {
                            await onGenerate({ ...edited, prompt: `${edited.prompt}\n\n用户本轮修改要求（优先于原方案）：${request.trim()}` });
                            onClose();
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : "重新生成失败");
                        } finally {
                            lock.current = false;
                            setBusy(false);
                        }
                    }}
                >
                    重新生成
                </Button>
            </footer>
        </section>
    );
}

type ResizeDirection = "top-left" | "top-center" | "top-right" | "middle-left" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
const resizeDirections: ResizeDirection[] = ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"];

export function EcommerceResultGallery({
    config,
    draft,
    plan,
    tasks,
    selected,
    focused,
    imageModels,
    qualityIssues,
    onSelect,
    onFocus,
    onDownload,
    onCanvas,
    onRemove,
    onRegenerate,
    onRetry,
    regenerationPreviews = {},
    regeneratingIds = new Set<string>(),
    generationPending = false,
}: {
    config: AiConfig;
    draft: EcommerceDraft;
    plan: EcommercePlan;
    tasks: Record<string, GenerationTask>;
    selected: Set<string>;
    imageModels: string[];
    qualityIssues?: Record<string, string[]>;
    regenerationPreviews?: Record<string, string>;
    regeneratingIds?: Set<string>;
    generationPending?: boolean;
    focused?: string;
    onSelect: (id: string) => void;
    onFocus: (id?: string) => void;
    onDownload: (item: EcommerceExportItem) => void;
    onCanvas: (ids: string[]) => void;
    onRemove: (image: EcommercePlanImage) => Promise<void>;
    onRegenerate: (image: EcommercePlanImage) => Promise<void>;
    onRetry: (image: EcommercePlanImage) => void;
}) {
    const [editing, setEditing] = useState<string>();
    const [rotations, setRotations] = useState<Record<string, number>>({});
    const [dimensions, setDimensions] = useState<Record<string, string>>({});
    const [frameSizes, setFrameSizes] = useState<Record<string, { width: number; height: number; left: number; top: number }>>({});
    const resizing = useRef<{ id: string; pointerId: number; direction: ResizeDirection; x: number; y: number; width: number; height: number; left: number; top: number; scale: number } | null>(null);
    const startResize = (event: ReactPointerEvent<HTMLSpanElement>, id: string, direction: ResizeDirection) => {
        const frame = event.currentTarget.closest<HTMLElement>(".ecommerce-result");
        if (!frame) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const world = frame.closest<HTMLElement>(".commerce-canvas-results");
        const scale = world && world.offsetWidth ? world.getBoundingClientRect().width / world.offsetWidth : 1;
        resizing.current = { id, pointerId: event.pointerId, direction, x: event.clientX, y: event.clientY, width: frame.offsetWidth, height: frame.offsetHeight, left: frameSizes[id]?.left || 0, top: frameSizes[id]?.top || 0, scale };
    };
    const moveResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
        const state = resizing.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const dx = (event.clientX - state.x) / state.scale;
        const dy = (event.clientY - state.y) / state.scale;
        const horizontal = state.direction.includes("left") ? -dx : state.direction.includes("right") ? dx : 0;
        const vertical = state.direction.includes("top") ? -dy : state.direction.includes("bottom") ? dy : 0;
        const width = Math.max(120, Math.min(1200, Math.round(state.width + horizontal)));
        const height = Math.max(120, Math.min(1600, Math.round(state.height + vertical)));
        setFrameSizes((current) => ({ ...current, [state.id]: { width, height, left: state.left + (state.direction.includes("left") ? state.width - width : 0), top: state.top + (state.direction.includes("top") ? state.height - height : 0) } }));
    };
    const endResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
        if (resizing.current?.pointerId === event.pointerId) resizing.current = null;
    };
    const keyResize = (event: ReactKeyboardEvent<HTMLSpanElement>, id: string) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        const frame = event.currentTarget.closest<HTMLElement>(".ecommerce-result");
        if (!frame) return;
        event.preventDefault();
        const current = frameSizes[id] || { width: frame.offsetWidth, height: frame.offsetHeight, left: 0, top: 0 };
        const step = event.shiftKey ? 20 : 5;
        setFrameSizes((sizes) => ({
            ...sizes,
            [id]: {
                ...current,
                width: Math.max(120, Math.min(1200, current.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))),
                height: Math.max(120, Math.min(1600, current.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0))),
            },
        }));
    };
    return (
        <>
            <div className="ecommerce-result-grid">
                {plan.images.map((image) => {
                    const index = plan.images.indexOf(image);
                    const task = image.taskId ? tasks[image.taskId] : undefined;
                    const assetId = imageResultAsset(task);
                    const working = regeneratingIds.has(image.id) || Boolean(image.taskId && (!task || !["succeeded", "failed", "cancelled"].includes(task.status))) || (!image.taskId && generationPending);
                    const output = (() => {
                        try {
                            return task?.status === "succeeded" ? parseBackendGenerationResult(task)?.images?.[0] : undefined;
                        } catch {
                            return undefined;
                        }
                    })();
                    const resourceId = resourceIdFromStorageKey(output?.storageKey);
                    const src = output?.storageKey ? resolveResourceVariantUrl(output.storageKey, "thumbnail") : output?.dataUrl || task?.previewUrl;
                    const displaySrc = src || (working ? regenerationPreviews[image.id] : undefined);
                    const frameSize = frameSizes[image.id];
                    return (
                        <article
                            key={image.id}
                            data-ecommerce-image-id={image.id}
                            data-node-id={image.id}
                            data-resized={Boolean(frameSize)}
                            style={frameSize ? { width: frameSize.width, height: frameSize.height, left: frameSize.left, top: frameSize.top } : undefined}
                            className={`ecommerce-result${selected.has(image.id) ? " is-selected" : ""}${focused === image.id ? " is-focused" : ""}${editing === image.id ? " is-editing" : ""}${working ? " is-generating" : ""}`}
                            aria-label={`第 ${index + 1} 张 · ${labelOf(imageTypes, image.imageType)}`}
                        >
                            <div className="ecommerce-result-media">
                                {displaySrc ? (
                                    <button
                                        type="button"
                                        className="ecommerce-result-open"
                                        aria-label={`选中第 ${index + 1} 张图片`}
                                        aria-pressed={focused === image.id}
                                        title="拖动可自由移动图片；按住 Alt 拖到商品参考区可继续创作"
                                        onClick={(event) => {
                                            if (event.shiftKey || event.ctrlKey || event.metaKey) onSelect(image.id);
                                            else onFocus(focused === image.id ? undefined : image.id);
                                        }}
                                    >
                                        <CommerceResultImage
                                            key={displaySrc}
                                            ratio={commerceCanvasAspect(image.ratio)}
                                            src={displaySrc}
                                            alt={`第${index + 1}张生成结果`}
                                            rotation={rotations[image.id] || 0}
                                            frameRatio={frameSize ? frameSize.width / frameSize.height : undefined}
                                            draggable={false}
                                            onPointerDown={(event) => {
                                                event.currentTarget.draggable = event.altKey && !working;
                                                if (event.altKey) event.stopPropagation();
                                            }}
                                            onLoad={(event) => {
                                                const { naturalWidth, naturalHeight } = event.currentTarget;
                                                if (naturalWidth && naturalHeight) setDimensions((current) => (current[image.id] === `${naturalWidth} × ${naturalHeight}` ? current : { ...current, [image.id]: `${naturalWidth} × ${naturalHeight}` }));
                                            }}
                                            onDragStart={(event) => writeCommerceImageTransfer(event.dataTransfer, { resourceId, name: `第 ${index + 1} 张生成结果`, url: displaySrc })}
                                        />
                                    </button>
                                ) : (
                                    <div className="ecommerce-result-placeholder commerce-branded-placeholder" style={{ aspectRatio: commerceCanvasAspect(image.ratio) }} role="status">
                                        <div className="commerce-placeholder-brand">
                                            <img src="/commerce/agent-mark.svg" alt="" />
                                            <span>电商 Agent</span>
                                        </div>
                                        {working ? <CommerceGeneratingArtwork queued={!image.taskId || task?.status === "queued"} label={`${String(index + 1).padStart(2, "0")} · ${labelOf(imageTypes, image.imageType)}`} /> : <Images size={27} />}
                                        {!working ? (
                                            <strong>{task?.status === "failed" && task.canRecoverMedia ? "作品已生成，保存未完成" : task?.status === "failed" ? "生成失败" : task?.status === "cancelled" ? "任务已取消" : "等待确认生成"}</strong>
                                        ) : null}
                                        {!working ? (
                                            <span>
                                                {String(index + 1).padStart(2, "0")} · {labelOf(imageTypes, image.imageType)}
                                            </span>
                                        ) : null}
                                        {task?.error ? <p>{task.error}</p> : null}
                                        {task && ["failed", "cancelled"].includes(task.status) ? (
                                            <Button size="small" onClick={() => onRetry(image)}>
                                                {task.canRecoverMedia ? "重新保存（不扣费）" : "重试这张图片"}
                                            </Button>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                            {src && !working && focused === image.id && selected.size <= 1 ? (
                                <>
                                    {resizeDirections.map((direction) => {
                                        const vertical = direction === "top-center" || direction === "bottom-center";
                                        return (
                                            <span
                                                key={direction}
                                                role="slider"
                                                aria-label={`拉伸第 ${index + 1} 张图片${direction}`}
                                                aria-valuemin={120}
                                                aria-valuemax={vertical ? 1600 : 1200}
                                                aria-valuenow={vertical ? frameSize?.height || Math.round(260 / commerceCanvasAspect(image.ratio)) : frameSize?.width || 260}
                                                tabIndex={0}
                                                className={`commerce-selection-handle ${direction}`}
                                                onPointerDown={(event) => startResize(event, image.id, direction)}
                                                onPointerMove={moveResize}
                                                onPointerUp={endResize}
                                                onLostPointerCapture={endResize}
                                                onKeyDown={(event) => keyResize(event, image.id)}
                                            />
                                        );
                                    })}
                                    {dimensions[image.id] ? <span className="commerce-selection-dimensions">{dimensions[image.id]}</span> : null}
                                    <button
                                        type="button"
                                        className="commerce-selection-rotate"
                                        title="顺时针旋转 90° 预览"
                                        aria-label="顺时针旋转图片预览"
                                        onClick={() => setRotations((current) => ({ ...current, [image.id]: ((current[image.id] || 0) + 90) % 360 }))}
                                    >
                                        <RotateCw size={15} />
                                    </button>
                                    <div className="commerce-selected-tools" role="group" aria-label="图片编辑功能" data-canvas-no-zoom>
                                        <div className="commerce-selected-tools-cost">
                                            图片编辑<small>功能即将开放</small>
                                        </div>
                                        {pendingImageTools.map(({ label, icon: Icon }) => (
                                            <button type="button" key={label} disabled title={`${label}功能将在 API 接入后开放`}>
                                                <Icon size={15} strokeWidth={1.8} />
                                                <span>{label}</span>
                                                <small>99 积分</small>
                                            </button>
                                        ))}
                                        <div className="commerce-selected-tools-divider" />
                                        <button type="button" disabled={!assetId} title={rotations[image.id] ? "下载原图；旋转仅用于预览" : "下载这张图片"} onClick={() => assetId && onDownload({ image, index, assetId })}>
                                            <ArrowDownToLine size={15} />
                                            <span>下载原图</span>
                                        </button>
                                        <button type="button" disabled={!assetId} onClick={() => assetId && onCanvas([assetId])}>
                                            <Images size={15} />
                                            <span>导入画布</span>
                                        </button>
                                        <Popover
                                            open={editing === image.id}
                                            onOpenChange={(open) => setEditing(open ? image.id : undefined)}
                                            trigger="click"
                                            placement="leftTop"
                                            destroyOnHidden
                                            content={
                                                <SingleImageEditor
                                                    key={`${image.id}:${image.taskId}`}
                                                    config={config}
                                                    draft={image.sourceDraft || draft}
                                                    image={image}
                                                    imageModels={imageModels}
                                                    onClose={() => setEditing(undefined)}
                                                    onGenerate={onRegenerate}
                                                />
                                            }
                                        >
                                            <button type="button" onClick={() => setEditing(image.id)}>
                                                <RotateCcw size={15} />
                                                <span>重新生成</span>
                                            </button>
                                        </Popover>
                                        <Popconfirm title="从结果区移除这张图片？" description="原图片仍保留在资产库与任务历史中。" onConfirm={() => onRemove(image)}>
                                            <button type="button">
                                                <Trash2 size={15} />
                                                <span>移除图片</span>
                                            </button>
                                        </Popconfirm>
                                    </div>
                                </>
                            ) : null}
                            {displaySrc && working ? (
                                <div className="ecommerce-result-regenerating" role="status">
                                    <img src="/commerce/agent-mark.svg" alt="" />
                                    <strong>电商 Agent 正在生成中</strong>
                                    <span>新图片完成后自动更新</span>
                                </div>
                            ) : null}
                            {assetId && qualityIssues?.[assetId]?.length ? (
                                <div className="ecommerce-quality-warning" role="status" title={qualityIssues[assetId].join("；")}>
                                    技术质检：{qualityIssues[assetId].join("；")}
                                </div>
                            ) : null}
                        </article>
                    );
                })}
            </div>
        </>
    );
}
