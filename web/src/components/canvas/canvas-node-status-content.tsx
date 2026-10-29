// 画布节点的运行状态内容：生成中（阶段、耗时、三段进度）、失败（重新获取 / 重新保存 / 重新生成）与未知节点兜底。

import { type GenerationTask } from "@/services/api/task-center";
import {
    generationPhaseHint,
    generationPhaseLabel,
    generationPhaseStep,
    generationTaskPhase,
    generationTaskSavingState,
    generationTaskShowsProgress,
    isGenerationTaskSubmissionUncertain,
    type GenerationMediaKind,
    type GenerationPhase,
} from "@/lib/generation-task-display";
import { AlertCircle, AlertTriangle, AudioLines, CloudOff, FileText, Film, Image as ImageIcon, RefreshCw, RotateCcw, ShieldAlert, Type, type LucideIcon } from "lucide-react";
import { type CSSProperties, type MouseEvent } from "react";
import { useTaskElapsed } from "@/hooks/use-task-elapsed";
import { canvasNodeCanResyncTask } from "@/lib/canvas/canvas-task-state";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { GenerationPhaseSteps } from "@/components/ai/generation-phase-steps";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContentProps } from "./canvas-node-content";

function canvasNodeGenerationKind(type: CanvasNodeData["type"]): GenerationMediaKind {
    if (type === CanvasNodeType.Video) return "video";
    if (type === CanvasNodeType.Audio) return "audio";
    if (type === CanvasNodeType.Image) return "image";
    return "text";
}

const generationKindIcon: Record<GenerationMediaKind, LucideIcon> = { image: ImageIcon, video: Film, audio: AudioLines, text: Type };

// 画布主题是随画布明暗切换的 JS 对象，这里转成局部 CSS 变量；样式统一写在 globals.css 的 .canvas-gen-*。
function canvasGenerationStateStyle(theme: CanvasTheme): CSSProperties {
    return {
        "--canvas-gen-ink": theme.node.text,
        "--canvas-gen-muted": theme.node.muted,
        "--canvas-gen-track": theme.node.stroke,
        "--canvas-gen-surface": theme.node.fill,
        "--canvas-gen-primary": theme.accent.primary,
        "--canvas-gen-on-primary": theme.accent.onPrimary,
        "--canvas-gen-danger": theme.accent.danger,
    } as CSSProperties;
}

function stopCanvasPointer(event: MouseEvent) {
    event.stopPropagation();
}

function TaskDetailButton({ node, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "onOpenTaskDetails">) {
    const taskId = node.metadata?.taskId;
    if (!taskId || !onOpenTaskDetails) return null;
    return (
        <button
            type="button"
            className="canvas-gen-detail"
            title={`任务 ${taskId}`}
            onMouseDown={stopCanvasPointer}
            onPointerDown={stopCanvasPointer}
            onClick={(event) => {
                event.stopPropagation();
                onOpenTaskDetails(node);
            }}
        >
            <FileText aria-hidden="true" />
            查看详情
        </button>
    );
}

export function LoadingContent({ node, theme, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "theme" | "onOpenTaskDetails">) {
    const metadata = node.metadata;
    const taskId = metadata?.taskId;
    const displayTask = {
        status: (metadata?.taskStatus || "running") as GenerationTask["status"],
        stage: metadata?.taskStage,
        mediaStage: metadata?.taskMediaStage,
        progress: metadata?.taskProgress,
    };
    const workflow = metadata?.imageLayerWorkflow;
    // 还没拿到任务 ID 时一律视为“提交中”，不展示前端占位用的阶段字符串。
    const phase: GenerationPhase = taskId ? generationTaskPhase(displayTask) : "submitting";
    const kind = canvasNodeGenerationKind(node.type);
    const Icon = generationKindIcon[kind];
    const uncertain = phase === "uncertain";
    const title = workflow ? (workflow.stage === "planning" ? "正在规划拆层" : `正在拆层 · 共 ${workflow.total} 张`) : metadata?.experimentalLayerPlan?.progress || generationPhaseLabel(phase, kind, metadata?.taskStage);
    const progress = taskId && generationTaskShowsProgress(displayTask) && typeof metadata?.taskProgress === "number" ? Math.max(0, Math.min(100, Math.round(metadata.taskProgress))) : null;
    const startedAt = workflow?.startedAt || metadata?.taskCreatedAt;
    const elapsed = useTaskElapsed(startedAt, taskTerminalStatus(metadata?.taskStatus) ? metadata?.taskCompletedAt : undefined);
    // 恢复监听没能确认状态时会在生成中节点上留下诊断（例如“最近任务中未找到对应记录”），以前完全不可见。
    const diagnostic = metadata?.errorDetails ? generationErrorMessage(metadata.errorDetails) : "";
    const hint = workflow ? "" : generationPhaseHint(phase, kind, metadata?.taskStage);
    const meta = uncertain ? "" : [progress !== null ? `${progress}%` : "", startedAt ? `已用时 ${elapsed}` : ""].filter(Boolean).join(" · ");
    return (
        <div className="canvas-gen-state" data-phase={phase} data-saving={phase === "saving" ? generationTaskSavingState(metadata?.taskStage) : undefined} style={canvasGenerationStateStyle(theme)}>
            <span className="canvas-gen-indicator" aria-hidden="true">
                {uncertain ? (
                    <AlertTriangle />
                ) : (
                    <>
                        <span className="canvas-gen-ring animate-spin" />
                        <Icon />
                    </>
                )}
            </span>
            <span className="canvas-gen-copy">
                {/* 只有阶段标题进入读屏播报；每秒变化的耗时不放进 live region。 */}
                <span className="canvas-gen-title" role="status">
                    {title}
                </span>
                {meta ? <span className="canvas-gen-meta">{meta}</span> : null}
                {diagnostic ? (
                    <span className="canvas-gen-diagnostic" title={diagnostic}>
                        {diagnostic}
                    </span>
                ) : hint ? (
                    <span className="canvas-gen-hint">{hint}</span>
                ) : null}
            </span>
            {!uncertain && !workflow ? <GenerationPhaseSteps className="canvas-gen-steps" step={generationPhaseStep(phase)} progress={progress} /> : null}
            <TaskDetailButton node={node} onOpenTaskDetails={onOpenTaskDetails} />
        </div>
    );
}

function taskTerminalStatus(status?: string) {
    return status === "succeeded" || status === "failed" || status === "cancelled";
}

type CanvasFailureKind = "uncertain" | "moderation" | "recover-media" | "resync" | "failed";
type CanvasFailureView = { kind: CanvasFailureKind; tone: "error" | "warning"; icon: LucideIcon; title: string; description: string; detail?: string };

/**
 * 失败态按“用户下一步该做什么”分类，而不是只回显错误原文：
 * 后端未确认失败的只需重新获取，作品已生成但保存失败的只需重新保存，只有真正失败才建议重新生成。
 */
function canvasFailureView(node: CanvasNodeData): CanvasFailureView {
    const metadata = node.metadata;
    const reason = generationErrorMessage(metadata?.errorDetails);
    if (isGenerationTaskSubmissionUncertain({ status: (metadata?.taskStatus || "failed") as GenerationTask["status"], stage: metadata?.taskStage })) {
        return { kind: "uncertain", tone: "warning", icon: AlertTriangle, title: "提交结果待确认", description: "为避免重复扣费，未自动重试，可在详情里核对", detail: reason };
    }
    if (metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(metadata?.errorDetails)) {
        return { kind: "moderation", tone: "error", icon: ShieldAlert, title: "未通过内容审核", description: reason };
    }
    if (metadata?.taskCanRecoverMedia) return { kind: "recover-media", tone: "warning", icon: AlertTriangle, title: "作品保存未完成", description: "作品已生成，重新保存不会重新生成", detail: reason };
    if (canvasNodeCanResyncTask(metadata)) {
        return metadata?.resourceReloadAvailable
            ? { kind: "resync", tone: "warning", icon: CloudOff, title: "作品载入失败", description: "作品已生成，重新获取不会重新生成", detail: reason }
            : { kind: "resync", tone: "warning", icon: CloudOff, title: "状态同步中断", description: "任务仍在后台进行，重新获取不会重新生成", detail: reason };
    }
    return { kind: "failed", tone: "error", icon: AlertCircle, title: metadata?.isBatchRoot ? "部分图片未生成" : "生成失败", description: reason };
}

export function ErrorContent({ node, theme, onRetry, onReloadResource, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "theme" | "onRetry" | "onReloadResource" | "onOpenTaskDetails">) {
    const view = canvasFailureView(node);
    const Icon = view.icon;
    const runAction = (action?: (node: CanvasNodeData) => void) => (event: MouseEvent) => {
        event.stopPropagation();
        action?.(node);
    };
    const actionProps = { type: "button" as const, onMouseDown: stopCanvasPointer, onPointerDown: stopCanvasPointer };
    return (
        <div className="canvas-gen-state is-failure" data-tone={view.tone} style={canvasGenerationStateStyle(theme)}>
            <span className="canvas-gen-indicator" aria-hidden="true">
                <Icon />
            </span>
            <span className="canvas-gen-copy">
                <span className="canvas-gen-title">{view.title}</span>
                <span className="canvas-gen-reason" title={view.detail}>
                    {view.description}
                </span>
            </span>
            {view.kind === "uncertain" || view.kind === "moderation" ? null : (
                <span className="canvas-gen-actions">
                    {view.kind === "recover-media" ? (
                        <button {...actionProps} className="canvas-gen-action is-primary" onClick={runAction(onRetry)}>
                            <RefreshCw aria-hidden="true" />
                            重新保存
                        </button>
                    ) : view.kind === "resync" ? (
                        <>
                            <button {...actionProps} className="canvas-gen-action is-primary" onClick={runAction(onReloadResource)}>
                                <RefreshCw aria-hidden="true" />
                                重新获取
                            </button>
                            <button {...actionProps} className="canvas-gen-action" onClick={runAction(onRetry)}>
                                <RotateCcw aria-hidden="true" />
                                重新生成
                            </button>
                        </>
                    ) : (
                        <button {...actionProps} className="canvas-gen-action is-primary" onClick={runAction(onRetry)}>
                            <RotateCcw aria-hidden="true" />
                            {node.metadata?.isBatchRoot ? "重新生成失败项" : "重新生成"}
                        </button>
                    )}
                </span>
            )}
            <TaskDetailButton node={node} onOpenTaskDetails={onOpenTaskDetails} />
        </div>
    );
}

export function UnknownNodeContent({ theme }: Pick<CanvasNodeContentProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}
