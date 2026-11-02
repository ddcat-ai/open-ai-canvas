import { Button, Popover } from "antd";
import { Check, Images, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resolveResourceVariantUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { EcommerceCreativeDirection, EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";
import { imageTypes, labelOf } from "./catalog";
import { SingleImageEditor } from "./result-gallery";
import { commerceCopyHasDirections } from "./consumer-copy";
import { commerceCanvasImages } from "./continuation";
import { writeCommerceImageTransfer } from "./image-transfer";

function imageSource(task?: GenerationTask) {
    if (!task || task.status !== "succeeded") return undefined;
    try {
        const result = parseBackendGenerationResult(task)?.images?.[0];
        if (result?.storageKey) return resolveResourceVariantUrl(result.storageKey, "thumbnail");
        if (result?.dataUrl) return result.dataUrl;
    } catch {
        /* Persisted previews may be unavailable for older tasks. */
    }
    return task.previewUrl;
}

export function EcommerceAgentFeed({
    direction,
    plan,
    tasks,
    config,
    draft,
    imageModels,
    imageCost,
    onRegenerate,
    onRetry,
    onFocus,
}: {
    direction: EcommerceCreativeDirection | null;
    plan: EcommercePlan | null;
    tasks: Record<string, GenerationTask>;
    config: AiConfig;
    draft: EcommerceDraft;
    imageModels: string[];
    imageCost: number | null;
    onRegenerate: (image: EcommercePlanImage) => Promise<void>;
    onRetry: (image: EcommercePlanImage) => void;
    onFocus: (id: string) => void;
}) {
    const [editing, setEditing] = useState<string>();
    const [expanded, setExpanded] = useState<string>();
    const complete = plan?.images.filter((image) => image.taskId && imageSource(tasks[image.taskId])).length || 0;
    const total = commerceCanvasImages(plan).length;
    const submitted = plan?.images.some((image) => image.taskId);
    const active = submitted && plan?.images.some((image) => image.taskId && (!tasks[image.taskId] || !["succeeded", "failed", "cancelled"].includes(tasks[image.taskId].status)));
    return (
        <div className="commerce-agent-feed">
            {direction ? (
                <div className="commerce-direction-choice">
                    <small>已选择创意方向</small>
                    <strong>{direction.name}</strong>
                    <span>{direction.summary.split(" 知识约束：{")[0]}</span>
                </div>
            ) : null}
            {plan && active ? (
                <section className="commerce-generation-message" role="status" aria-label="图片生成进度">
                    <header>
                        <span className="commerce-generation-glyph">
                            <Sparkles size={17} />
                        </span>
                        <strong>AI 生成中</strong>
                        <span>
                            {complete} / {total}
                        </span>
                    </header>
                    <div className="commerce-generation-visual">
                        <span className="commerce-yoru-glow" />
                        <img src="/yoru/yoru-body.png" alt="小夜正在创作" />
                        <span className="commerce-generation-particles" aria-hidden="true" />
                    </div>
                    <div className="commerce-generation-track" aria-label={`已完成 ${complete} 张，共 ${total} 张`}>
                        <span style={{ width: `${total ? (complete / total) * 100 : 0}%` }} />
                    </div>
                    <p>
                        <LoaderCircle size={14} className="commerce-planning-spin" />
                        小夜正在创作，完成的图片会依次出现在这里和画布上
                    </p>
                </section>
            ) : null}
            {commerceCanvasImages(plan).map((image, index) => {
                const task = image.taskId ? tasks[image.taskId] : undefined;
                const src = imageSource(task);
                let resourceId = image.resourceId;
                try {
                    resourceId ||= task ? resourceIdFromStorageKey(parseBackendGenerationResult(task)?.images?.[0]?.storageKey) : undefined;
                } catch {
                    /* Legacy previews still provide their URL. */
                }
                if (!src && task && ["failed", "cancelled"].includes(task.status))
                    return (
                        <section className="commerce-generated-card" key={image.id} role="alert">
                            <header>
                                <span className="commerce-generation-glyph">
                                    <Images size={16} />
                                </span>
                                <strong>第 {index + 1} 张未完成</strong>
                            </header>
                            <p>{task.error || "任务未能完成，可重试这张图片。"}</p>
                            <Button size="small" onClick={() => onRetry(image)}>
                                {task.canRecoverMedia ? "重新保存（不扣费）" : "重试这张图片"}
                            </Button>
                        </section>
                    );
                if (!src) return null;
                return (
                    <section className="commerce-generated-card" key={`${image.id}:${image.taskId}`} aria-label={`第 ${index + 1} 张生成结果`}>
                        <header>
                            <span className="commerce-generation-glyph">
                                <Check size={16} />
                            </span>
                            <strong>生成图片</strong>
                            <small>
                                {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
                            </small>
                        </header>
                        <p>
                            {labelOf(imageTypes, image.imageType)}
                            <span> · {image.ratio}</span>
                        </p>
                        <button type="button" className="commerce-generated-preview" onClick={() => onFocus(image.id)} aria-label={`在画布中选择第 ${index + 1} 张图片`}>
                            <img src={src} alt={`第 ${index + 1} 张商品图片`} draggable onDragStart={(event) => writeCommerceImageTransfer(event.dataTransfer, { resourceId, name: `第 ${index + 1} 张生成结果`, url: src })} />
                        </button>
                        <footer>
                            <Popover
                                open={editing === image.id}
                                onOpenChange={(open) => setEditing(open ? image.id : undefined)}
                                trigger="click"
                                placement="rightTop"
                                destroyOnHidden
                                content={<SingleImageEditor key={`${image.id}:${image.taskId}`} config={config} draft={image.sourceDraft || draft} image={image} imageModels={imageModels} onClose={() => setEditing(undefined)} onGenerate={onRegenerate} />}
                            >
                                <Button size="small" icon={<RotateCcw size={14} />} onClick={() => setEditing(image.id)}>
                                    重新生成{imageCost == null ? "" : `（约 ${imageCost.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} 积分）`}
                                </Button>
                            </Popover>
                            <Button size="small" icon={<Images size={14} />} onClick={() => setExpanded((id) => (id === image.id ? undefined : image.id))} aria-expanded={expanded === image.id}>
                                查看文案
                            </Button>
                        </footer>
                        {expanded === image.id ? (
                            <div className="commerce-generated-plan">
                                <strong>性能 / 体验策划</strong>
                                <p>{image.performanceAngle || "围绕可见结构与实际使用动作组织体验表达；具体性能参数待核验"}</p>
                                <strong>信息组件</strong>
                                <p>{image.informationComponent || "按本页内容安排标题、细节放大窗或场景注释，保持移动端可读"}</p>
                                <strong>画面文案</strong>
                                <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{!image.copy || commerceCopyHasDirections(image.copy) ? "在重新生成中描述你希望呈现的文字。" : image.copy}</p>
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}
