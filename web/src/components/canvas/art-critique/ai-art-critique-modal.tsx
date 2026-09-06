import { Button, Modal, Tag } from "antd";
import { EmptyState } from "@/components/ui/product/empty-state";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles, Target, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    ART_CRITIQUE_SCHEMA_VERSION,
    ART_CRITIQUE_PLUGIN_ID,
    artCritiqueCategoryLabel,
    artCritiqueSeverityLabel,
    artCritiqueStageLabel,
    artCritiqueSourceFingerprint,
    createDefaultArtCritiqueState,
    isArtCritiqueImageInput,
    type ArtCritiqueCategory,
    type ArtCritiqueIssue,
    type ArtCritiqueNodeState,
    type ArtCritiqueOption,
    type ArtCritiquePipelineStage,
    type ArtCritiqueReport,
} from "@/lib/art-critique/contracts";
import { ART_CRITIQUE_CATEGORY_COLORS, ART_CRITIQUE_SEVERITY_COLORS, layoutArtCritiqueLabels, repairIssueTarget, targetBounds } from "@/lib/art-critique/annotation";
import { runArtCritiquePipeline } from "@/lib/art-critique/pipeline";
import { useCopyText } from "@/hooks/use-copy-text";
import { imageToDataUrl, resolveImageUrl } from "@/services/image-storage";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import { IconButton } from "@/components/ui/base/buttons";
import { Callout } from "@/components/ui/product/callout";

type AiArtCritiqueModalProps = {
    node: CanvasNodeData | null;
    upstreamNodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateState: (nodeId: string, state: ArtCritiqueNodeState) => void;
};

const CATEGORIES: ArtCritiqueCategory[] = ["composition", "color", "lighting", "proportion", "other"];
const ART_CRITIQUE_STAGE_PROGRESS: Record<ArtCritiquePipelineStage, number> = {
    preparing: 8,
    scene: 22,
    reviewing: 52,
    aggregating: 66,
    grounding: 78,
    verifying: 90,
    annotating: 97,
    completed: 100,
    failed: 100,
};
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type AiArtCritiqueView = "overview" | "detail";
type ArtCritiquePromptStatus = "ready" | "pending" | "unavailable";

export function AiArtCritiqueModal({ node, upstreamNodes, open, onClose, onUpdateState }: AiArtCritiqueModalProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const selectedCritiqueModel = effectiveConfig.textModel.trim();
    const configuredCritiqueModelLabel = selectedCritiqueModel ? modelOptionLabel(effectiveConfig, selectedCritiqueModel) : "未配置文本/视觉理解模型";
    const installations = usePluginStore((state) => state.installations);
    const input = useMemo(() => upstreamNodes.find(isArtCritiqueImageInput), [upstreamNodes]);
    const state = node?.metadata?.artCritique || createDefaultArtCritiqueState();
    const installation = installations.find((item) => item.manifest.id === ART_CRITIQUE_PLUGIN_ID);
    const enabled = installation?.enabled === true;
    const currentFingerprint = input ? artCritiqueSourceFingerprint(input) : "";
    const stale = Boolean(state.report && currentFingerprint && state.report.sourceFingerprint !== currentFingerprint);
    const visibleState: ArtCritiqueNodeState = stale && state.status !== "running" ? { ...state, status: "stale" } : state;
    const [previewUrl, setPreviewUrl] = useState("");
    const [running, setRunning] = useState(false);
    const [activeStage, setActiveStage] = useState<ArtCritiquePipelineStage>();
    const [localError, setLocalError] = useState("");
    const [filter, setFilter] = useState<ArtCritiqueCategory | "all">("all");
    const [view, setView] = useState<AiArtCritiqueView>("overview");
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
    const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null);
    const [draftReportVisible, setDraftReportVisible] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const preparedImageRef = useRef<{ fingerprint: string; dataUrl: string } | null>(null);

    useEffect(() => {
        if (!open || !input) {
            setPreviewUrl("");
            return;
        }
        let cancelled = false;
        const source = input.metadata?.content || input.metadata?.previewContent || "";
        void resolveImageUrl(input.metadata?.storageKey, source, { cacheMiss: true })
            .then((url) => {
                if (!cancelled) setPreviewUrl(url);
            })
            .catch(() => {
                if (!cancelled) setPreviewUrl(source);
            });
        return () => {
            cancelled = true;
        };
    }, [input, open]);

    useEffect(() => {
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setView("overview");
        setFilter("all");
        setActiveStage(undefined);
        setLocalError("");
        setDraftReportVisible(false);
    }, [node?.id, currentFingerprint, open]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const issues = visibleState.report?.issues || [];
    const reportOptions = visibleState.report?.options || [];
    const repairedIssues = useMemo(() => issues.map(repairIssueTarget), [issues]);
    const visibleIssues = useMemo(() => (filter === "all" ? repairedIssues : repairedIssues.filter((issue) => issue.category === filter)), [filter, repairedIssues]);
    const detailIssue = repairedIssues.find((issue) => issue.id === selectedIssueId) || null;
    const detailIndex = detailIssue ? repairedIssues.findIndex((issue) => issue.id === detailIssue.id) : -1;
    const hoveredIssue = repairedIssues.find((issue) => issue.id === hoveredIssueId) || null;
    const overlayIssues = useMemo(() => {
        if (visibleState.status === "running") return [];
        const issue = view === "detail" ? detailIssue : hoveredIssue;
        return issue ? [issue] : [];
    }, [detailIssue, hoveredIssue, view, visibleState.status]);
    const labelPlacements = useMemo(() => layoutArtCritiqueLabels(overlayIssues), [overlayIssues]);
    const issueNumberById = useMemo(() => new Map(repairedIssues.map((issue, index) => [issue.id, index + 1])), [repairedIssues]);

    const close = () => {
        abortRef.current?.abort();
        onClose();
    };

    const openIssue = (issueId: string) => {
        setSelectedIssueId(issueId);
        setHoveredIssueId(null);
        setView("detail");
    };

    const backToOverview = () => {
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setView("overview");
    };

    const runReview = async () => {
        if (!node || !input) {
            setLocalError("请先连接一张已有图片");
            return;
        }
        if (!enabled) {
            setLocalError("插件尚未启用，请先到插件管理中开启 AI 审美批改");
            return;
        }
        setView("overview");
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setDraftReportVisible(false);
        const sourceFingerprint = artCritiqueSourceFingerprint(input);
        const runId = `art-critique-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const controller = new AbortController();
        abortRef.current = controller;
        const baseState: ArtCritiqueNodeState = {
            ...state,
            schemaVersion: ART_CRITIQUE_SCHEMA_VERSION,
            status: "running",
            analysisStage: "preparing",
            sourceNodeId: input.id,
            sourceFingerprint,
            lastRunId: runId,
            errorCode: undefined,
            errorMessage: undefined,
            updatedAt: new Date().toISOString(),
        };
        onUpdateState(node.id, baseState);
        setRunning(true);
        setActiveStage("preparing");
        setLocalError("");
        let latestStage: ArtCritiquePipelineStage = "preparing";
        let runningReport: ArtCritiqueReport | undefined = state.report;
        try {
            const source = input.metadata?.content || input.metadata?.previewContent || "";
            const cachedImage = preparedImageRef.current;
            const dataUrl =
                cachedImage?.fingerprint === sourceFingerprint
                    ? cachedImage.dataUrl
                    : await imageToDataUrl({
                          dataUrl: source.startsWith("data:") ? source : undefined,
                          url: source.startsWith("data:") ? undefined : source,
                          storageKey: input.metadata?.storageKey,
                          name: input.title,
                          mimeType: input.metadata?.mimeType,
                      });
            if (!dataUrl) throw new Error("无法读取输入图片");
            if (!controller.signal.aborted) preparedImageRef.current = { fingerprint: sourceFingerprint, dataUrl };
            const report = await runArtCritiquePipeline(
                effectiveConfig,
                { dataUrl, title: input.title, sourceFingerprint },
                {
                    signal: controller.signal,
                    onStage: (analysisStage) => {
                        latestStage = analysisStage;
                        setActiveStage(analysisStage);
                        onUpdateState(node.id, {
                            ...baseState,
                            ...(runningReport ? { report: { ...runningReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) } } : {}),
                            analysisStage,
                            updatedAt: new Date().toISOString(),
                        });
                    },
                    onDraftReport: (draftReport) => {
                        if (controller.signal.aborted || abortRef.current !== controller) return;
                        runningReport = draftReport;
                        setDraftReportVisible(true);
                        onUpdateState(node.id, {
                            ...baseState,
                            status: "running",
                            analysisStage: latestStage,
                            report: { ...draftReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) },
                            updatedAt: new Date().toISOString(),
                        });
                    },
                },
            );
            setDraftReportVisible(false);
            onUpdateState(node.id, {
                ...baseState,
                status: "completed",
                analysisStage: "completed",
                report: { ...report, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) },
                updatedAt: new Date().toISOString(),
            });
            setActiveStage("completed");
        } catch (error) {
            if (controller.signal.aborted) {
                setActiveStage(undefined);
                setDraftReportVisible(false);
                onUpdateState(node.id, { ...baseState, status: "idle", analysisStage: undefined, errorCode: undefined, errorMessage: undefined, updatedAt: new Date().toISOString() });
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "AI 批改失败，请稍后重试";
            setActiveStage("failed");
            setDraftReportVisible(false);
            setLocalError(errorMessage);
            onUpdateState(node.id, { ...baseState, status: "failed", analysisStage: "failed", errorCode: error instanceof Error ? error.message : "art_critique_failed", errorMessage, updatedAt: new Date().toISOString() });
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
        }
    };

    const progressStage = activeStage || visibleState.analysisStage || "preparing";
    const displayedModelLabel = visibleState.report?.modelLabel || configuredCritiqueModelLabel;
    const modelStatusLabel = running ? "正在使用" : visibleState.report?.modelLabel ? "报告使用" : selectedCritiqueModel ? "待使用" : "需要配置";
    const modelStatusColor = selectedCritiqueModel || visibleState.report?.modelLabel ? theme.node.muted : "var(--status-warning)";
    const modelInlineLabel = selectedCritiqueModel || visibleState.report?.modelLabel ? `${modelStatusLabel} · ${displayedModelLabel}` : "请到设置中选择支持图片理解的文本模型";

    return (
        <Modal
            open={open}
            title={null}
            closable={false}
            width="min(1240px, calc(100vw - 32px))"
            centered
            destroyOnClose={false}
            onCancel={close}
            footer={null}
            className="art-critique-modal"
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}
        >
            <div className="flex h-[min(820px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] min-h-0 flex-col overflow-hidden rounded-[var(--r-lg)]" style={{ background: theme.canvas.background, color: theme.node.text }}>
                <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: theme.node.edge }}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                        <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <h2 className="truncate text-base font-semibold">AI 审美批改</h2>
                            {visibleState.report ? (
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--status-success) 12%, transparent)", color: "var(--status-success)" }}>
                                    {visibleState.report.issues.length ? `${visibleState.report.issues.length} 个问题` : reportOptions.length ? `${reportOptions.length} 个可选方向` : "本轮未发现重点问题"}
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                            {input?.title || "等待图片输入"} · 输入图片，输出批改报告，不修改原图
                        </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {running
                                ? artCritiqueStageLabel(visibleState.analysisStage)
                                : visibleState.status === "completed" && !stale
                                  ? "分析完成"
                                  : visibleState.status === "stale"
                                    ? "需要更新"
                                    : visibleState.status === "failed"
                                      ? "分析失败"
                                      : "尚未分析"}
                        </span>
                    </div>
                    <IconButton variant="ghost" size="sm" icon={X} onClick={close} aria-label="关闭批改报告" />
                </header>

                <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,.85fr)]">
                    <section className="flex h-[min(48dvh,520px)] min-h-[300px] min-w-0 flex-col gap-3 border-b p-4 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.edge }}>
                        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--r-lg)] border p-2" style={{ borderColor: theme.node.edge, background: "rgba(0,0,0,.18)" }}>
                            {previewUrl ? (
                                <img src={previewUrl} alt={input?.title || "输入图片"} className="max-h-full max-w-full rounded-[var(--r-md)] object-contain shadow-[var(--shadow-md)]" draggable={false} />
                            ) : (
                                <EmptyState size="compact" icon={ImageIcon} title={input ? "正在加载图片" : "还没有图片输入"} />
                            )}
                            {overlayIssues.length && previewUrl ? <CritiqueOverlay issues={overlayIssues} issueNumberById={issueNumberById} selectedIssueId={overlayIssues[0]?.id || null} labelPlacements={labelPlacements} onSelect={openIssue} /> : null}
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{input?.title || "等待图片输入"}</div>
                                <div className="mt-1 truncate text-xs" style={{ color: theme.node.muted }}>
                                    {draftReportVisible && visibleState.status === "running"
                                        ? "报告初稿已出，矩形标注将在定位复核完成后显示"
                                        : view === "detail" && detailIssue
                                          ? "当前只显示此问题的定位框"
                                          : input
                                            ? "悬停查看问题位置，点击问题进入详情"
                                            : "请从图片节点连接一条输入"}
                                </div>
                            </div>
                            {visibleState.report?.issues.length ? (
                                <span className="shrink-0 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--workspace-accent) 12%, transparent)", color: "var(--workspace-accent)" }}>
                                    {view === "detail" && detailIssue && detailIndex >= 0 ? `问题 ${detailIndex + 1} / ${repairedIssues.length}` : `${visibleState.report.issues.length} 个问题`}
                                </span>
                            ) : null}
                        </div>
                    </section>

                    <aside className="min-h-0 flex-1 overflow-y-auto" data-canvas-wheel-scroll>
                        <div className="flex min-h-full flex-col gap-4 p-4">
                            {running || visibleState.status === "running" ? <ArtCritiqueProgress stage={progressStage} theme={theme} /> : null}
                            {draftReportVisible && visibleState.status === "running" && visibleState.report ? (
                                <Callout tone="info" title="报告初稿已生成">
                                    问题和建议已先展示，正在精确定位并复核矩形标注。
                                </Callout>
                            ) : null}
                            {!enabled && !visibleState.report ? (
                                <Callout tone="warning" title="插件尚未启用">
                                    请先到插件管理中开启 AI 审美批改，再运行分析。
                                </Callout>
                            ) : null}
                            {visibleState.status === "stale" ? (
                                <Callout tone="warning" title="输入图片已经变化">
                                    当前报告针对旧图片生成，请重新批改。
                                </Callout>
                            ) : null}
                            {localError || visibleState.errorMessage ? (
                                <Callout tone="error" title="批改失败">
                                    {localError || visibleState.errorMessage}
                                </Callout>
                            ) : null}

                            {view === "detail" && detailIssue ? (
                                <IssueDetailView
                                    issue={detailIssue}
                                    issueIndex={detailIndex}
                                    total={repairedIssues.length}
                                    isDraft={draftReportVisible && visibleState.status === "running"}
                                    promptStatus={draftReportVisible && visibleState.status === "running" ? "pending" : detailIssue.editPrompt?.trim() ? "ready" : "unavailable"}
                                    theme={theme}
                                    onBack={backToOverview}
                                    onPrevious={() => detailIndex > 0 && setSelectedIssueId(repairedIssues[detailIndex - 1].id)}
                                    onNext={() => detailIndex >= 0 && detailIndex < repairedIssues.length - 1 && setSelectedIssueId(repairedIssues[detailIndex + 1].id)}
                                />
                            ) : (
                                <>
                                    {visibleState.report ? (
                                        <ReportSummary report={visibleState.report} theme={theme} isDraft={draftReportVisible && visibleState.status === "running"} />
                                    ) : (
                                        <EmptyState className="my-auto" size="compact" icon={FileText} title="还没有批改报告" />
                                    )}

                                    {visibleState.report && !visibleState.report.issues.length ? (
                                        <div
                                            className="flex items-start gap-3 rounded-[var(--r-lg)] border px-3 py-3 text-sm"
                                            style={{ borderColor: "color-mix(in oklch, var(--status-success) 35%, transparent)", background: "color-mix(in oklch, var(--status-success) 8%, transparent)" }}
                                        >
                                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                                            <div>
                                                <div className="font-semibold">本轮未发现需要优先修改的问题</div>
                                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                                    {reportOptions.length ? `有 ${reportOptions.length} 个可选方向，但它们不是确定性错误。` : "这表示当前检查没有找到证据充分、确实影响画面表达的重点问题。"}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {reportOptions.length ? (
                                        <section className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="m-0 text-sm font-semibold">可选方向</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                    不代表画面有错
                                                </span>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                {reportOptions.map((option) => (
                                                    <OptionCard key={option.id} option={option} theme={theme} />
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}

                                    {visibleState.report?.issues.length ? (
                                        <section className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="m-0 text-sm font-semibold">重点问题</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                    {visibleIssues.length} / {visibleState.report.issues.length} 项
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 overflow-x-auto pb-1" role="group" aria-label="问题分类筛选">
                                                <FilterChip label="全部" active={filter === "all"} onClick={() => setFilter("all")} />
                                                {CATEGORIES.map((category) => (
                                                    <FilterChip key={category} label={artCritiqueCategoryLabel(category)} active={filter === category} color={ART_CRITIQUE_CATEGORY_COLORS[category]} onClick={() => setFilter(category)} />
                                                ))}
                                            </div>
                                            {visibleIssues.length ? (
                                                <div className="overflow-hidden rounded-[var(--r-lg)] border" style={{ borderColor: theme.node.edge, background: theme.node.panel }}>
                                                    {visibleIssues.map((issue, index) => (
                                                        <IssueCard key={issue.id} issue={issue} index={issueNumberById.get(issue.id) || index + 1} selected={false} theme={theme} onClick={() => openIssue(issue.id)} onHover={setHoveredIssueId} />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="rounded-[var(--r-lg)] border border-dashed px-3 py-6 text-center text-xs" style={{ borderColor: theme.node.edge, color: theme.node.muted }}>
                                                    当前分类没有问题
                                                </div>
                                            )}
                                        </section>
                                    ) : null}
                                </>
                            )}

                            <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.node.edge, background: theme.canvas.background }}>
                                <div className="min-w-0 flex-1 basis-full truncate text-[var(--fs-micro)] sm:basis-auto" title={modelInlineLabel} style={{ color: modelStatusColor }}>
                                    {modelInlineLabel}
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                    {running ? (
                                        <Button type="text" size="small" onClick={() => abortRef.current?.abort()}>
                                            取消分析
                                        </Button>
                                    ) : null}
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="shrink-0"
                                        icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                                        loading={running}
                                        disabled={running || !input || !enabled || !selectedCritiqueModel}
                                        onClick={() => void runReview()}
                                    >
                                        {visibleState.report ? "重新批改" : "开始批改"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </Modal>
    );
}

function ArtCritiqueProgress({ stage, theme }: { stage: ArtCritiquePipelineStage; theme: CanvasTheme }) {
    const percent = ART_CRITIQUE_STAGE_PROGRESS[stage];
    const detail = stage === "reviewing" ? "场景路由与多个 Reviewer 正在并行检查画面" : stage === "verifying" ? "正在并行复核问题并生成 AI 修改提示词" : "正在按阶段生成批改报告";
    return (
        <section className="flex flex-col gap-2 rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.panel }} aria-label="AI 审美批改进度">
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    <span className="truncate">{artCritiqueStageLabel(stage)}</span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: theme.node.muted }}>
                    {percent}%
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklch, var(--workspace-accent) 14%, transparent)" }}>
                <div
                    className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                    role="progressbar"
                    aria-label="AI 审美批改阶段进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={`${artCritiqueStageLabel(stage)}，约 ${percent}%`}
                    style={{ width: `${percent}%`, background: theme.accent.primary }}
                />
            </div>
            <div className="text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                {detail}
            </div>
        </section>
    );
}

function ReportSummary({ report, theme, isDraft }: { report: NonNullable<ArtCritiqueNodeState["report"]>; theme: CanvasTheme; isDraft?: boolean }) {
    const summary = report.summary || "这张图暂时没有整体总结。";
    const hasLongSummary = summary.length > 120;
    return (
        <section className="flex flex-col gap-2 border-b pb-4" style={{ borderColor: theme.node.edge }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                {isDraft ? (
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" style={{ color: "var(--workspace-accent)" }} aria-hidden="true" />
                ) : (
                    <CheckCircle2 className="size-4" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                )}
                <span>{isDraft ? "整体判断（初稿）" : "整体判断"}</span>
                {report.rubricVersion ? (
                    <span className="ml-auto text-[11px] font-normal" style={{ color: theme.node.muted }}>
                        标准 {report.rubricVersion}
                    </span>
                ) : null}
            </div>
            <p className={`m-0 text-sm leading-6${hasLongSummary ? " line-clamp-3" : ""}`}>{summary}</p>
            {hasLongSummary ? (
                <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden" style={{ color: "var(--workspace-accent)" }}>
                        查看完整判断
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <p className="mt-2 mb-0 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {summary}
                    </p>
                </details>
            ) : null}
            {report.pipelineWarnings?.length ? (
                <details className="group rounded-[var(--r-md)] px-2.5 py-2 text-xs" style={{ background: "color-mix(in oklch, var(--status-warning) 8%, transparent)", color: "var(--status-warning)" }}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
                        本次分析有部分步骤降级
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 leading-5">
                        {report.pipelineWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </details>
            ) : null}
            {report.strengths.length ? (
                <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold outline-none focus-visible:underline [&::-webkit-details-marker]:hidden" style={{ color: theme.node.muted }}>
                        画面已有的优点
                        <span className="inline-flex items-center gap-1 font-medium">
                            {report.strengths.length} 项
                            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                        </span>
                    </summary>
                    <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 text-xs leading-5">
                        {report.strengths.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                    {report.strengths.length > 3 ? (
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                            还有 {report.strengths.length - 3} 项优点
                        </div>
                    ) : null}
                </details>
            ) : null}
        </section>
    );
}

function IssueCard({ issue, index, selected, theme, onClick, onHover }: { issue: ArtCritiqueIssue; index: number; selected: boolean; theme: CanvasTheme; onClick: () => void; onHover: (issueId: string | null) => void }) {
    const color = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    return (
        <button
            type="button"
            className="group flex w-full items-start gap-3 border-b px-3.5 py-3.5 text-left outline-none transition last:border-b-0 hover:bg-black/[.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] dark:hover:bg-white/[.04]"
            style={{ borderColor: theme.node.edge, background: selected ? `color-mix(in oklch, ${color} 8%, ${theme.node.panel})` : "transparent", outlineColor: color }}
            onClick={onClick}
            onMouseEnter={() => onHover(issue.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(issue.id)}
            onBlur={() => onHover(null)}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] text-xs font-bold" style={{ background: color, color: "#fff" }}>
                {index}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 text-sm font-semibold leading-5">{issue.title}</span>
                <span className="mt-1.5 flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span style={{ color }}>{artCritiqueSeverityLabel(issue.severity)}</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <>
                            <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                            <span>待复核</span>
                        </>
                    ) : null}
                    <span className="ml-auto shrink-0 tabular-nums">{Math.round(issue.confidence * 100)}%</span>
                </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 opacity-35 transition-transform group-hover:translate-x-0.5 group-hover:opacity-70" aria-hidden="true" />
        </button>
    );
}

function IssueDetailView({
    issue,
    issueIndex,
    total,
    isDraft,
    promptStatus,
    theme,
    onBack,
    onPrevious,
    onNext,
}: {
    issue: ArtCritiqueIssue;
    issueIndex: number;
    total: number;
    isDraft?: boolean;
    promptStatus: ArtCritiquePromptStatus;
    theme: CanvasTheme;
    onBack: () => void;
    onPrevious: () => void;
    onNext: () => void;
}) {
    const targetSourceLabel = isDraft ? "定位中" : issue.targetSource === "reference" ? "参考区域" : issue.targetSource === "model" ? "模型定位" : issue.target.type === "global" ? "全局范围" : "局部区域";
    const severityColor = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    const copyText = useCopyText();
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
                    问题列表
                </Button>
                <span className="text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    问题 {issueIndex + 1} / {total}
                </span>
            </div>

            <section className="flex flex-col gap-3 border-b pb-5" style={{ borderColor: theme.node.edge }}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="size-2 rounded-full" style={{ background: severityColor }} aria-hidden="true" />
                    <span>具体问题</span>
                    <Tag bordered={false} className="ml-auto text-[11px]" style={{ color: severityColor }}>
                        {artCritiqueSeverityLabel(issue.severity)}
                    </Tag>
                </div>
                <h3 className="m-0 text-lg font-semibold leading-7">{issue.title}</h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span>{Math.round(issue.confidence * 100)}% 把握</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "color-mix(in oklch, var(--status-warning) 12%, transparent)", color: "var(--status-warning)" }}>
                            待复核
                        </span>
                    ) : null}
                </div>
                <div className="rounded-[var(--r-md)] px-3 py-3" style={{ background: theme.node.panel }}>
                    <div className="mb-1 text-xs font-semibold" style={{ color: theme.node.muted }}>
                        AI 判断
                    </div>
                    <p className="m-0 text-sm leading-6">{issue.explanation}</p>
                </div>
                {issue.targetDescription ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        <span className="font-semibold">定位参考：</span>
                        {issue.targetDescription}
                        <span className="ml-1 rounded-full px-1.5 py-0.5" style={{ background: "color-mix(in oklch, var(--workspace-accent) 8%, transparent)" }}>
                            {targetSourceLabel}
                        </span>
                    </div>
                ) : null}
            </section>

            <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Target className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }} aria-hidden="true" />
                        <span>改进</span>
                    </div>
                    {promptStatus === "ready" ? (
                        <Button type="default" size="small" className="shrink-0" icon={<Copy className="size-3.5" />} aria-label="复制 AI 生成的修改提示词" onClick={() => copyText(issue.editPrompt || "", "AI 修改提示词已复制")}>
                            复制提示词
                        </Button>
                    ) : (
                        <Button type="default" size="small" className="shrink-0" disabled icon={promptStatus === "pending" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Copy className="size-3.5" />}>
                            {promptStatus === "pending" ? "AI 生成中" : "提示词未生成"}
                        </Button>
                    )}
                </div>
                {promptStatus === "pending" ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        定位完成后，AI 会结合问题区域生成可直接用于局部编辑的提示词。
                    </div>
                ) : null}
                {promptStatus === "unavailable" ? (
                    <div className="text-xs leading-5" style={{ color: "var(--status-warning)" }}>
                        AI 修改提示词未生成，请重新批改后重试。
                    </div>
                ) : null}
                <div className="text-sm leading-6">
                    <span className="font-semibold">目标：</span>
                    {issue.suggestion.goal}
                </div>
                {issue.suggestion.actions.length ? (
                    <div>
                        <div className="mb-1.5 text-xs font-semibold" style={{ color: theme.node.muted }}>
                            建议动作
                        </div>
                        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-6">
                            {issue.suggestion.actions.map((item, index) => (
                                <li key={item} className="flex items-start gap-2">
                                    <span
                                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[var(--fs-micro)] font-bold"
                                        style={{ background: "color-mix(in oklch, var(--workspace-accent) 10%, transparent)", color: "var(--workspace-accent)" }}
                                    >
                                        {index + 1}
                                    </span>
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                ) : null}
                {issue.suggestion.preserve.length ? (
                    <div className="rounded-[var(--r-md)] px-3 py-2.5" style={{ background: "color-mix(in oklch, var(--status-success) 6%, transparent)" }}>
                        <div className="mb-1 text-xs font-semibold" style={{ color: "var(--status-success)" }}>
                            需要保留
                        </div>
                        <ul className="m-0 list-disc space-y-1 pl-4 text-xs leading-5">
                            {issue.suggestion.preserve.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                <div className="rounded-[var(--r-md)] border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.edge, background: theme.node.panel }}>
                    <span className="font-semibold">预期效果：</span>
                    {issue.suggestion.expectedEffect}
                </div>
            </section>

            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: theme.node.edge }}>
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} disabled={issueIndex <= 0} onClick={onPrevious}>
                    上一项
                </Button>
                <Button type="text" size="small" icon={<ArrowRight className="size-4" />} disabled={issueIndex < 0 || issueIndex >= total - 1} onClick={onNext}>
                    下一项
                </Button>
            </div>
        </div>
    );
}

function OptionCard({ option, theme }: { option: ArtCritiqueOption; theme: CanvasTheme }) {
    return (
        <article className="rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[option.category] }} aria-hidden="true" />
                <span className="min-w-0 flex-1">{option.title}</span>
                <span className="shrink-0 text-[11px] font-normal" style={{ color: theme.node.muted }}>
                    {Math.round(option.confidence * 100)}% 参考把握
                </span>
            </div>
            <p className="mt-2 mb-0 text-xs leading-5" style={{ color: theme.node.muted }}>
                {option.explanation}
            </p>
            {option.suggestion.actions.length ? (
                <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 text-xs leading-5">
                    {option.suggestion.actions.slice(0, 3).map((action) => (
                        <li key={action}>{action}</li>
                    ))}
                </ul>
            ) : null}
        </article>
    );
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-[background-color,border-color,box-shadow,color] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
                borderColor: active ? color || "var(--workspace-accent)" : "var(--border-subtle)",
                background: active ? `color-mix(in oklch, ${color || "var(--workspace-accent)"} 12%, transparent)` : "transparent",
                color: active ? color || "var(--workspace-accent)" : "var(--foreground-muted)",
                outlineColor: color || "var(--workspace-accent)",
            }}
            aria-pressed={active}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function CritiqueOverlay({
    issues,
    issueNumberById,
    selectedIssueId,
    labelPlacements,
    onSelect,
}: {
    issues: ArtCritiqueIssue[];
    issueNumberById: ReadonlyMap<string, number>;
    selectedIssueId: string | null;
    labelPlacements: Array<{ x: number; y: number }>;
    onSelect: (id: string) => void;
}) {
    return (
        <svg className="pointer-events-none absolute inset-3 size-[calc(100%-1.5rem)]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="AI 批改标注">
            <title>AI 批改标注</title>
            {issues.map((issue, index) => {
                const renderIssue = repairIssueTarget(issue);
                const issueNumber = issueNumberById.get(renderIssue.id) || index + 1;
                const color = ART_CRITIQUE_SEVERITY_COLORS[renderIssue.severity];
                const selected = renderIssue.id === selectedIssueId;
                const dimmed = Boolean(selectedIssueId) && !selected;
                const approximate = renderIssue.target.type !== "box";
                const uncertain = renderIssue.targetSource === "reference" || renderIssue.verification?.verdict === "uncertain";
                const label = labelPlacements[index] || { x: 0.04, y: 0.06 };
                const bounds = targetBounds(renderIssue.target);
                const labelX = label.x * 100;
                const labelY = label.y * 100;
                return (
                    <g
                        key={renderIssue.id}
                        className="pointer-events-auto cursor-pointer outline-none"
                        opacity={dimmed ? 0.28 : 1}
                        role="button"
                        tabIndex={0}
                        aria-label={`${issueNumber}：${renderIssue.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onSelect(renderIssue.id)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelect(renderIssue.id);
                            }
                        }}
                    >
                        <rect
                            x={bounds.x * 100}
                            y={bounds.y * 100}
                            width={bounds.width * 100}
                            height={bounds.height * 100}
                            rx="1.4"
                            fill={color}
                            fillOpacity={selected ? ".08" : ".015"}
                            stroke={color}
                            strokeWidth={selected ? 0.95 : 0.42}
                            strokeDasharray={renderIssue.target.type === "global" || approximate || uncertain ? "2.2 1.6" : undefined}
                            vectorEffect="non-scaling-stroke"
                        />
                        <rect
                            x={labelX - 3.2}
                            y={labelY - 2.55}
                            width="6.4"
                            height="5.1"
                            rx="1.7"
                            fill={color}
                            fillOpacity={selected ? ".96" : ".7"}
                            stroke="#fff"
                            strokeOpacity={selected ? ".9" : ".62"}
                            strokeWidth=".55"
                            vectorEffect="non-scaling-stroke"
                        />
                        <text x={labelX} y={labelY + 1.05} textAnchor="middle" fill="#fff" fontSize="3.05" fontWeight="700">
                            {issueNumber}
                        </text>
                        <title>{`${issueNumber}：${renderIssue.title}`}</title>
                    </g>
                );
            })}
        </svg>
    );
}
