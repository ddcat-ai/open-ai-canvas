import { useState, type ReactNode } from "react";
import { Button, Checkbox, Typography } from "antd";
import { ArrowDownToLine, Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { GenerationTask } from "@/services/api/task-center";
import type { EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resolveResourceVariantUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { EcommerceExportItem } from "./export";
import { imageTypes, labelOf } from "./catalog";
import { commerceCanvasAspect } from "./canvas-layout";
import { CommerceGeneratingArtwork, CommerceResultImage } from "./result-image";
import { SingleImageEditor, imageResultAsset } from "./result-gallery";
import "./output-gallery.css";

type OutputImage = { image: EcommercePlanImage; index: number; task?: GenerationTask; src?: string; assetId?: string; resourceId?: string };

type OutputFilter = "all" | "active" | "done" | "failed";
const filters: Array<[OutputFilter, string]> = [
    ["all", "全部"],
    ["active", "进行中"],
    ["done", "已完成"],
    ["failed", "失败"],
];

export function EcommerceOutputGallery({
    config,
    draft,
    plan,
    tasks,
    imageModels,
    qualityIssues,
    selected,
    onSelect,
    onDownload,
    onRemove,
    onRegenerate,
    onRetry,
    generationPending,
    regeneratingIds = new Set<string>(),
    regenerationPreviews = {},
    stage,
    stageActive = false,
    nextStep,
    exportCount = 0,
    exportDisabled = false,
    onExport,
    preparedDownload,
}: {
    config: AiConfig;
    draft: EcommerceDraft;
    plan: EcommercePlan | null;
    tasks: Record<string, GenerationTask>;
    imageModels: string[];
    qualityIssues?: Record<string, string[]>;
    selected: Set<string>;
    onSelect: (id: string) => void;
    onDownload: (item: EcommerceExportItem) => void;
    onRemove: (image: EcommercePlanImage) => Promise<void>;
    onRegenerate: (image: EcommercePlanImage) => Promise<void>;
    onRetry: (image: EcommercePlanImage) => void;
    generationPending: boolean;
    regeneratingIds?: Set<string>;
    regenerationPreviews?: Record<string, string>;
    /** 本轮流程：已发送的需求、视觉方向、方案审阅与进度，显示在作品之上。 */
    stage?: ReactNode;
    stageActive?: boolean;
    /** 空态里告诉用户下一步做什么。 */
    nextStep?: string;
    exportCount?: number;
    exportDisabled?: boolean;
    onExport?: () => void;
    preparedDownload?: { url: string; fileName: string };
}) {
    const [preview, setPreview] = useState<OutputImage | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [filter, setFilter] = useState<OutputFilter>("all");
    const images = [...(plan?.previousImages || []), ...(plan?.images || [])];
    const stateOf = (image: EcommercePlanImage, pending: boolean): OutputFilter => {
        const task = image.taskId ? tasks[image.taskId] : undefined;
        if (task?.status === "succeeded" || (!task && image.deliveryStatus === "delivered")) return "done";
        if (task && ["failed", "cancelled"].includes(task.status)) return "failed";
        return regenerationPending(image, tasks, pending, regeneratingIds) ? "active" : "all";
    };
    const counts = { active: 0, done: 0, failed: 0 };
    for (const image of plan?.images || []) {
        const state = stateOf(image, generationPending);
        if (state !== "all") counts[state] += 1;
    }
    for (const image of plan?.previousImages || []) {
        const state = stateOf(image, false);
        if (state !== "all") counts[state] += 1;
    }
    const visible = (image: EcommercePlanImage, pending: boolean) => filter === "all" || stateOf(image, pending) === filter;
    const card = (image: EcommercePlanImage, index: number, pending: boolean) => (
        <OutputCard
            key={image.id}
            image={image}
            index={index}
            task={image.taskId ? tasks[image.taskId] : undefined}
            selected={selected.has(image.id)}
            working={regenerationPending(image, tasks, pending, regeneratingIds)}
            src={outputSource(image, tasks) || (pending ? regenerationPreviews[image.id] : undefined)}
            assetId={image.taskId ? imageResultAsset(tasks[image.taskId]) : undefined}
            resourceId={resourceFor(image, tasks)}
            issues={qualityIssues?.[image.taskId ? imageResultAsset(tasks[image.taskId]) || "" : ""]}
            onSelect={() => onSelect(image.id)}
            onPreview={(value) => setPreview(value)}
            onDownload={onDownload}
            onRetry={() => onRetry(image)}
            onEdit={() => setEditing(image.id)}
            onRemove={() => void onRemove(image)}
        />
    );
    const current = (plan?.images || []).map((image, index) => ({ image, index })).filter(({ image }) => visible(image, generationPending));
    const previous = (plan?.previousImages || []).map((image, index) => ({ image, index })).filter(({ image }) => visible(image, false));

    return (
        <section className="commerce-output-gallery" aria-label="商品作品">
            <header className="commerce-output-gallery-header">
                <div className="commerce-output-title">
                    <h2>方案与作品</h2>
                    <span>
                        {counts.done} 张完成{counts.active ? ` · ${counts.active} 张进行中` : ""}
                        {counts.failed ? ` · ${counts.failed} 张失败` : ""}
                    </span>
                </div>
                <div className="commerce-output-tools">
                    {images.length ? (
                        <div className="commerce-output-filters" role="group" aria-label="按状态筛选作品">
                            {filters.map(([value, label]) => (
                                <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                                    {label}
                                    {value !== "all" && counts[value] ? <span>{counts[value]}</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {preparedDownload ? (
                        <Button size="small" href={preparedDownload.url} download={preparedDownload.fileName}>
                            下载已打包文件
                        </Button>
                    ) : null}
                    {onExport ? (
                        <Button size="small" icon={<ArrowDownToLine size={14} />} disabled={!exportCount || exportDisabled} onClick={onExport} aria-label={`导出图片，共 ${exportCount} 张`}>
                            {selected.size ? `导出已选 ${exportCount}` : exportCount > 1 ? `导出全部 ${exportCount}` : "导出"}
                        </Button>
                    ) : null}
                </div>
            </header>
            <div className="commerce-output-scroll" data-canvas-wheel-scroll>
                {stageActive ? <div className="ecs-stage">{stage}</div> : null}
                {!images.length ? (
                    stageActive ? null : (
                        <div className="commerce-output-empty" role="status">
                            <span className="commerce-output-empty-mark" aria-hidden="true">
                                <ImageIcon size={22} strokeWidth={1.6} />
                            </span>
                            <strong>这一轮的方案和作品会出现在这里</strong>
                            <span>{nextStep || "在右侧选好场景、添加商品图，再描述想要的画面。"}</span>
                        </div>
                    )
                ) : (
                    <div className="commerce-output-batches">
                        {current.length ? (
                            <section className="commerce-output-batch" aria-label="当前创作批次">
                                <header>
                                    <strong>{plan!.images.length > 1 ? "本轮作品" : "本次创作"}</strong>
                                    <span>{plan!.images.length} 张</span>
                                </header>
                                <div className="commerce-output-grid">{current.map(({ image, index }) => card(image, index, generationPending))}</div>
                            </section>
                        ) : null}
                        {previous.length ? (
                            <section className="commerce-output-batch" aria-label="之前的商品作品">
                                <header>
                                    <strong>之前的作品</strong>
                                    <span>{plan!.previousImages!.length} 张</span>
                                </header>
                                <div className="commerce-output-grid">{previous.map(({ image, index }) => card(image, index, false))}</div>
                            </section>
                        ) : null}
                        {!current.length && !previous.length ? <p className="commerce-output-filter-empty">没有{filters.find(([value]) => value === filter)?.[1]}的作品。</p> : null}
                    </div>
                )}
            </div>
            {preview ? (
                <AppModal open onCancel={() => setPreview(null)} footer={null} width="min(1120px, calc(100vw - 32px))" title={`${String(preview.index + 1).padStart(2, "0")} · ${labelOf(imageTypes, preview.image.imageType)}`}>
                    <div className="commerce-output-preview">
                        <CommerceResultImage ratio={commerceCanvasAspect(preview.image.ratio)} src={preview.src || ""} alt={`第 ${preview.index + 1} 张商品图片预览`} />
                        <section>
                            {preview.image.copy ? <p>{preview.image.copy}</p> : null}
                            <Typography.Text type="secondary">{preview.image.prompt}</Typography.Text>
                            <dl>
                                <div>
                                    <dt>用途</dt>
                                    <dd>{labelOf(imageTypes, preview.image.imageType)}</dd>
                                </div>
                                <div>
                                    <dt>模型</dt>
                                    <dd>{preview.image.imageModel}</dd>
                                </div>
                                <div>
                                    <dt>尺寸</dt>
                                    <dd>
                                        {preview.image.ratio} · {preview.image.resolution}
                                    </dd>
                                </div>
                            </dl>
                            {preview.assetId ? (
                                <Button type="primary" icon={<ArrowDownToLine size={14} />} onClick={() => onDownload({ image: preview.image, index: preview.index, assetId: preview.assetId!, resourceId: preview.resourceId })}>
                                    下载原图
                                </Button>
                            ) : null}
                        </section>
                    </div>
                </AppModal>
            ) : null}
            {editing
                ? (() => {
                      const image = images.find((item) => item.id === editing);
                      if (!image) return null;
                      return (
                          <AppModal open onCancel={() => setEditing(null)} footer={null} width="min(600px, calc(100vw - 32px))" title={`修改第 ${images.indexOf(image) + 1} 张`}>
                              <SingleImageEditor config={config} draft={image.sourceDraft || draft} image={image} imageModels={imageModels} onClose={() => setEditing(null)} onGenerate={onRegenerate} />
                          </AppModal>
                      );
                  })()
                : null}
        </section>
    );
}

function OutputCard({
    image,
    index,
    task,
    selected,
    working,
    src,
    assetId,
    resourceId,
    issues,
    onSelect,
    onPreview,
    onDownload,
    onRetry,
    onEdit,
    onRemove,
}: {
    image: EcommercePlanImage;
    index: number;
    task?: GenerationTask;
    selected: boolean;
    working: boolean;
    src?: string;
    assetId?: string;
    resourceId?: string;
    issues?: string[];
    onSelect: () => void;
    onPreview: (image: OutputImage) => void;
    onDownload: (item: EcommerceExportItem) => void;
    onRetry: () => void;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const failed = Boolean(task && ["failed", "cancelled"].includes(task.status));
    const status =
        task?.status === "succeeded"
            ? "已完成"
            : task?.status === "failed"
              ? "生成失败"
              : task?.status === "cancelled"
                ? "已取消"
                : working
                  ? task?.status === "queued"
                      ? "排队中"
                      : task?.stage || "生成中"
                  : image.deliveryStatus === "delivered"
                    ? "已完成"
                    : "待生成";
    const title = `${String(index + 1).padStart(2, "0")} · ${labelOf(imageTypes, image.imageType)}`;
    return (
        <article className={`commerce-output-card${selected ? " is-selected" : ""}`} data-ecommerce-image-id={image.id} data-status={failed ? "failed" : working ? "working" : status === "已完成" ? "done" : "idle"}>
            <div className="commerce-output-card-frame">
                <button type="button" className="commerce-output-card-media" disabled={!src} onClick={() => src && onPreview({ image, index, src, assetId, resourceId })} aria-label={`预览第 ${index + 1} 张图片`}>
                    {src ? (
                        <CommerceResultImage ratio={commerceCanvasAspect(image.ratio)} src={src} alt={`${labelOf(imageTypes, image.imageType)}生成结果`} loading="lazy" />
                    ) : working ? (
                        <CommerceGeneratingArtwork queued={!image.taskId || task?.status === "queued"} label={String(index + 1).padStart(2, "0")} />
                    ) : (
                        <span className="commerce-output-empty-card">{task?.error || "等待生成"}</span>
                    )}
                </button>
                <span className="commerce-output-card-check">
                    <Checkbox checked={selected} onChange={onSelect} aria-label={`选择第 ${index + 1} 张图片`} />
                </span>
            </div>
            <div className="commerce-output-card-meta">
                <span className="commerce-output-card-title" title={image.goal || image.theme || title}>
                    <strong>{title}</strong>
                    {image.goal || image.theme ? <small>{image.goal || image.theme}</small> : null}
                </span>
                <span className="commerce-output-status">{status}</span>
            </div>
            {image.copy ? <p className="commerce-output-card-copy">{image.copy}</p> : null}
            {issues?.length ? <p className="commerce-output-issue">需要检查：{issues.join("；")}</p> : null}
            <footer>
                {failed ? (
                    <Button size="small" onClick={onRetry}>
                        {task!.canRecoverMedia ? "重新保存" : "重试"}
                    </Button>
                ) : null}
                <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={onEdit}>
                    修改这张
                </Button>
                {assetId && resourceId ? <Button size="small" type="text" icon={<ArrowDownToLine size={14} />} aria-label={`下载第 ${index + 1} 张`} onClick={() => onDownload({ image, index, assetId, resourceId })} /> : null}
                <Button size="small" type="text" icon={<Trash2 size={14} />} aria-label={`从本轮移除第 ${index + 1} 张`} onClick={onRemove} />
            </footer>
        </article>
    );
}

function outputSource(image: EcommercePlanImage, tasks: Record<string, GenerationTask>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    try {
        const output = task?.status === "succeeded" ? parseBackendGenerationResult(task)?.images?.[0] : undefined;
        if (output?.storageKey) return resolveResourceVariantUrl(output.storageKey, "thumbnail");
        if (output?.dataUrl || task?.previewUrl) return output?.dataUrl || task?.previewUrl;
        if (image.resourceId) return resolveResourceVariantUrl(image.resourceId, "thumbnail");
    } catch {
        if (task?.previewUrl) return task.previewUrl;
    }
    return undefined;
}

function resourceFor(image: EcommercePlanImage, tasks: Record<string, GenerationTask>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    try {
        return resourceIdFromStorageKey(task && parseBackendGenerationResult(task)?.images?.[0]?.storageKey) || image.resourceId;
    } catch {
        return image.resourceId;
    }
}

function regenerationPending(image: EcommercePlanImage, tasks: Record<string, GenerationTask>, generationPending: boolean, regeneratingIds: Set<string>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    return regeneratingIds.has(image.id) || Boolean(image.taskId && (!task || ["queued", "running"].includes(task.status))) || (!image.taskId && generationPending);
}
