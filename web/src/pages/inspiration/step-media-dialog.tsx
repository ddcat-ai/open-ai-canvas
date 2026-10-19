import { Button } from "antd";
import { FileText, Sparkles } from "lucide-react";
import { useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { resolveLibTVMakeSame } from "@/lib/libtv-gallery";
import { cn } from "@/lib/utils";
import type { LibTVWorkStep } from "@/types/libtv-gallery";

import { describeLibTVStepMedia, StepMediaPreview } from "./step-media-preview";

const STEP_TYPE_LABEL: Record<LibTVWorkStep["type"], string> = { image: "图像生成", video: "视频生成", audio: "音频生成", text: "文本" };

export function LibTVStepMediaDialog({
    step,
    steps,
    index,
    onClose,
    onMakeSame,
}: {
    step: LibTVWorkStep;
    steps: LibTVWorkStep[];
    index: number;
    onClose: () => void;
    onMakeSame: () => void;
}) {
    const hasMedia = describeLibTVStepMedia(step).kind !== "none";
    const [detailsExpanded, setDetailsExpanded] = useState(true);
    const title = `步骤 ${index + 1} · ${step.title?.trim() || "步骤详情"}`;

    return (
        <AppModal
            flush
            open
            title={<span className="block truncate px-4 py-3 pr-12" title={title}>{title}</span>}
            footer={null}
            centered
            width="min(1040px, calc(100vw - 32px))"
            onCancel={onClose}
            className="libtv-step-media-dialog"
            styles={{ mask: { backdropFilter: "none", WebkitBackdropFilter: "none" } }}
        >
            <div className="max-h-[calc(100dvh-112px)] overflow-y-auto overscroll-contain p-4">
                <div className="flex min-w-0 flex-col gap-4 md:flex-row">
                    {hasMedia && (
                        <div className="min-w-0 flex-1">
                            <StepMediaPreview
                                step={step}
                                alt={title}
                                full
                                className={detailsExpanded ? "h-[min(32dvh,260px)] md:h-[min(68dvh,640px)]" : undefined}
                            />
                        </div>
                    )}
                    {detailsExpanded && (
                        <section
                            id="libtv-step-details"
                            aria-label="步骤详情"
                            tabIndex={0}
                            className={cn("min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-border p-4", hasMedia ? "max-h-[min(32dvh,260px)] md:max-h-[min(68dvh,640px)] md:w-[320px] md:shrink-0" : "max-h-[min(60dvh,640px)] w-full")}
                        >
                            <LibTVStepDetails step={step} steps={steps} onMakeSame={onMakeSame} />
                        </section>
                    )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-foreground/50">{step.aspectRatio || ""}</span>
                    {hasMedia && (
                        <Button icon={<FileText className="size-4" />} aria-expanded={detailsExpanded} aria-controls="libtv-step-details" onClick={() => setDetailsExpanded((expanded) => !expanded)}>
                            {detailsExpanded ? "收起步骤" : "查看步骤"}
                        </Button>
                    )}
                </div>
            </div>
        </AppModal>
    );
}

export function LibTVStepDetails({ step, steps, onMakeSame }: { step: LibTVWorkStep; steps: LibTVWorkStep[]; onMakeSame: () => void }) {
    const makeSame = resolveLibTVMakeSame(step);
    const referenceIds = [...new Set(step.referenceNodeIds)];
    const references = referenceIds.map((id) => steps.find((item) => item.id === id)).filter((item): item is LibTVWorkStep => Boolean(item));
    const unavailableCount = referenceIds.length - references.length;
    const parameters = [
        ["类型", STEP_TYPE_LABEL[step.type]],
        ["模型", step.model],
        ["比例", step.aspectRatio],
        ["分辨率", step.resolution],
        ["时长", step.durationSeconds > 0 ? `${step.durationSeconds} 秒` : ""],
    ].filter(([, value]) => Boolean(value));

    return (
        <div className="space-y-4 text-sm">
            <h2 className="text-sm font-semibold">步骤详情</h2>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                {parameters.map(([label, value]) => (
                    <div key={label} className="contents">
                        <dt className="text-xs text-foreground/45">{label}</dt>
                        <dd className="m-0 break-words text-xs text-foreground/75">{value}</dd>
                    </div>
                ))}
            </dl>
            <div>
                <h3 className="mb-2 text-xs font-medium">提示词</h3>
                {step.prompt.trim() ? (
                    <p className="m-0 whitespace-pre-wrap break-words leading-6 text-foreground/70">{step.prompt}</p>
                ) : <p className="m-0 text-xs text-foreground/45">此步骤未公开提示词。</p>}
            </div>
            {step.text.trim() && step.text.trim() !== step.prompt.trim() && (
                <div>
                    <h3 className="mb-2 text-xs font-medium">文本</h3>
                    <p className="m-0 whitespace-pre-wrap break-words leading-6 text-foreground/70">{step.text}</p>
                </div>
            )}
            <div>
                <h3 className="mb-2 text-xs font-medium">{referenceIds.length > 0 ? `引用 · ${referenceIds.length}` : "引用"}</h3>
                {referenceIds.length > 0 ? (
                    <ul className="m-0 list-disc space-y-1 pl-4 text-xs text-foreground/60">
                        {references.map((reference) => <li key={reference.id} className="break-words">{reference.title?.trim() || STEP_TYPE_LABEL[reference.type]}</li>)}
                        {unavailableCount > 0 && <li>{unavailableCount} 个引用未公开详情</li>}
                    </ul>
                ) : <p className="m-0 text-xs text-foreground/45">未公开关联引用。</p>}
            </div>
            {!makeSame.ok && makeSame.reason === "has-references" && <p className="m-0 text-xs leading-5 text-foreground/50">含引用，请用「复制到画布」保留完整关系。</p>}
            {makeSame.ok && <Button type="primary" size="small" icon={<Sparkles className="size-3.5" />} onClick={onMakeSame}>做同款</Button>}
        </div>
    );
}
