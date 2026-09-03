import { ArrowRight, CheckCircle2, CircleAlert, Image as ImageIcon, LoaderCircle, RefreshCw, ScanSearch } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { ART_CRITIQUE_PLUGIN_ID, artCritiqueSourceFingerprint, artCritiqueStageLabel, createDefaultArtCritiqueState, isArtCritiqueImageInput, type ArtCritiqueNodeState } from "@/lib/art-critique/contracts";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import { useCanvasNodeActions } from "../canvas-node-action-context";
import { useUpstreamNodes } from "../canvas-node-graph-context";

type ArtCritiqueNodeProps = {
    node: CanvasNodeData;
};

export function ArtCritiqueNodeContent({ node }: ArtCritiqueNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const installations = usePluginStore((state) => state.installations);
    const { openArtCritique } = useCanvasNodeActions();
    const imageInputs = useUpstreamNodes(node.id).filter(isArtCritiqueImageInput);
    const input = imageInputs[0];
    const state = node.metadata?.artCritique || createDefaultArtCritiqueState();
    const installation = installations.find((item) => item.manifest.id === ART_CRITIQUE_PLUGIN_ID);
    const enabled = installation?.enabled === true;
    const currentFingerprint = input ? artCritiqueSourceFingerprint(input) : "";
    const hasStaleReport = Boolean(state.report && currentFingerprint && state.report.sourceFingerprint !== currentFingerprint);
    const status = hasStaleReport ? "stale" : state.status;
    const preview = input?.metadata?.previewContent || input?.metadata?.content || "";
    const issueCount = state.report?.issues.length || 0;
    const optionCount = state.report?.options?.length || 0;
    const canOpen = Boolean(state.report) || (enabled && Boolean(input));

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden rounded-[inherit] p-3" style={{ background: theme.node.panel, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.toolbar.itemHover, color: theme.accent.primary }}>
                    <ScanSearch className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--fs-label)] font-semibold">AI 审美批改</div>
                    <div className="truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                        {enabled ? "视觉分析 · SVG 标注 · 不修改原图" : state.report ? "插件未启用 · 历史报告只读" : "插件未启用 · 请先到插件管理开启"}
                    </div>
                </div>
                <StatusBadge status={status} stage={state.analysisStage} />
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--r-md)] border" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
                {preview && input?.type === CanvasNodeType.Image ? (
                    <img src={preview} alt="" className="absolute inset-0 size-full object-contain" draggable={false} />
                ) : (
                    <div className="absolute inset-0 grid place-items-center">
                        <ImageIcon className="size-8 opacity-25" aria-hidden="true" />
                    </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-white">
                    <div className="min-w-0">
                        <div className="truncate text-[var(--fs-micro)] font-semibold">{input ? input.title || "输入图片" : "等待图片输入"}</div>
                        <div className="mt-0.5 text-[var(--fs-micro)] opacity-75">
                            {input
                                ? `${state.report ? (issueCount ? `${issueCount} 个重点问题` : optionCount ? `${optionCount} 个可选方向，无确定问题` : "本轮未发现重点问题") : "尚未生成报告"}${imageInputs.length > 1 ? ` · 已连接 ${imageInputs.length} 张，使用第一张` : ""}`
                                : "从图片节点拖入一条连线"}
                        </div>
                    </div>
                    {status === "completed" && issueCount ? <span className="shrink-0 rounded-full bg-black/45 px-2 py-1 text-[var(--fs-micro)] font-semibold">{issueCount} 项</span> : null}
                </div>
            </div>

            {status === "stale" ? (
                <div
                    className="flex min-h-9 items-center gap-2 rounded-[var(--r-md)] border px-2.5 py-2 text-[var(--fs-micro)]"
                    style={{ borderColor: "color-mix(in oklch, var(--status-warning) 50%, transparent)", background: "color-mix(in oklch, var(--status-warning) 9%, transparent)", color: "var(--status-warning)" }}
                >
                    <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">输入图片已变化，需要重新批改</span>
                </div>
            ) : null}
            {status === "failed" && state.errorMessage ? (
                <div
                    className="line-clamp-2 rounded-[var(--r-md)] border px-2.5 py-2 text-[var(--fs-micro)]"
                    style={{ borderColor: "color-mix(in oklch, var(--status-error) 50%, transparent)", background: "color-mix(in oklch, var(--status-error) 9%, transparent)", color: "var(--status-error)" }}
                >
                    {state.errorMessage}
                </div>
            ) : null}
            {state.report && status === "completed" ? (
                <div className="flex min-h-9 items-center gap-2 rounded-[var(--r-md)] border px-2.5 py-2 text-[var(--fs-micro)]" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
                    <CheckCircle2 className="size-3.5 shrink-0" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                    <span className="truncate">{state.report.summary || `已完成 ${issueCount} 项批改`}</span>
                </div>
            ) : null}

            <button
                type="button"
                data-canvas-no-zoom
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--r-md)] px-4 text-[var(--fs-label)] font-semibold outline-none transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: theme.accent.primary, color: theme.accent.onPrimary, outlineColor: theme.accent.primary }}
                disabled={!canOpen}
                onClick={(event) => {
                    event.stopPropagation();
                    openArtCritique?.(node);
                }}
            >
                {status === "running" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                {status === "running" ? "正在批改" : state.report ? (status === "stale" ? "重新批改" : "查看批改报告") : "开始 AI 批改"}
                {status !== "running" ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
            </button>
        </div>
    );
}

function StatusBadge({ status, stage }: { status: string; stage?: ArtCritiqueNodeState["analysisStage"] }) {
    if (status === "running")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: "var(--status-info)", background: "color-mix(in oklch, var(--status-info) 15%, transparent)" }}>
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                {artCritiqueStageLabel(stage)}
            </span>
        );
    if (status === "completed")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: "var(--status-success)", background: "color-mix(in oklch, var(--status-success) 15%, transparent)" }}>
                <CheckCircle2 className="size-3" aria-hidden="true" />
                已完成
            </span>
        );
    if (status === "stale")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: "var(--status-warning)", background: "color-mix(in oklch, var(--status-warning) 15%, transparent)" }}>
                <RefreshCw className="size-3" aria-hidden="true" />
                待更新
            </span>
        );
    if (status === "failed")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: "var(--status-error)", background: "color-mix(in oklch, var(--status-error) 15%, transparent)" }}>
                <CircleAlert className="size-3" aria-hidden="true" />
                失败
            </span>
        );
    return (
        <span className="inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: "var(--foreground-muted)", background: "color-mix(in oklch, var(--foreground-muted) 12%, transparent)" }}>
            未开始
        </span>
    );
}
