import { ART_CRITIQUE_STAGE_PROGRESS, CritiqueOverlay, ArtCritiqueProgress, IssueDetailView, ReportSummary, OptionCard, FilterChip, IssueCard } from "./ai-art-critique-report";
import { resolveImageUrl } from "@/services/image-storage";
import { repairIssueTarget, layoutArtCritiqueLabels, ART_CRITIQUE_CATEGORY_COLORS } from "@/lib/art-critique/annotation";
import { executeArtCritique } from "@/services/art-critique-execution";
import { AppModal } from "@/components/ui/product/app-modal";
import { X, Image as ImageIcon, FileText, CheckCircle2, LoaderCircle, RefreshCw, ScanEye } from "lucide-react";
import { IconButton } from "@/components/ui/base/buttons";
import { EmptyState } from "@/components/ui/product/empty-state";
import { CreativeQuoteCard } from "@/components/creation/creative-agent-cards";
import { Callout } from "@/components/ui/product/callout";
import { Button } from "antd";
import { canvasThemes } from "@/lib/canvas-theme";
import { useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
    ART_CRITIQUE_PLUGIN_ID,
    artCritiqueSourceFingerprint,
    createDefaultArtCritiqueState,
    isArtCritiqueImageInput,
    type ArtCritiqueCategory,
    type ArtCritiqueNodeState,
    type ArtCritiquePipelineStage, ART_CRITIQUE_SCHEMA_VERSION, type ArtCritiqueReport, artCritiqueStageLabel, artCritiqueCategoryLabel } from "@/lib/art-critique/contracts";
import { ApprovedToolExecution, type ApprovedToolExecutionState } from "@/services/approved-tool-execution";
import { getActiveUserScope } from "@/lib/user-scope";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
export { ART_CRITIQUE_STAGE_PROGRESS } from "./ai-art-critique-report";

type AiArtCritiqueModalProps = {
    startRequestId?: string;
    restartRequested?: boolean;
    onRunningChange?: (running: boolean) => void;
    node: CanvasNodeData | null;
    upstreamNodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateState: (nodeId: string, state: ArtCritiqueNodeState) => void;
};

const CATEGORIES: ArtCritiqueCategory[] = ["composition", "color", "lighting", "proportion", "other"];
export type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type AiArtCritiqueView = "overview" | "detail";
export type ArtCritiquePromptStatus = "ready" | "pending" | "unavailable";

export function AiArtCritiqueModal({ node, upstreamNodes, open, onClose, onUpdateState, startRequestId, restartRequested, onRunningChange }: AiArtCritiqueModalProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const effectiveConfig = useEffectiveConfig();
    const selectedCritiqueModel = effectiveConfig.textModel.trim();
    const configuredCritiqueModelLabel = selectedCritiqueModel ? modelOptionLabel(effectiveConfig, selectedCritiqueModel) : t("canvasA.artCritique.noModel");
    const enabled = usePluginStore((state) => state.pluginStates[ART_CRITIQUE_PLUGIN_ID]?.effectiveEnabled ?? (ART_CRITIQUE_PLUGIN_ID in state.runtimeStatuses ? state.runtimeStatuses[ART_CRITIQUE_PLUGIN_ID] === "enabled" : Boolean(state.installations.find((item) => item.manifest.id === ART_CRITIQUE_PLUGIN_ID)?.enabled)));
    const input = useMemo(() => { const images = upstreamNodes.filter(isArtCritiqueImageInput); return images.length === 1 ? images[0] : undefined; }, [upstreamNodes]);
    const state = node?.metadata?.artCritique || createDefaultArtCritiqueState();
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
    const approvalRef = useRef<ApprovedToolExecution | null>(null);
    const [payment, setPayment] = useState<ApprovedToolExecutionState>({ busy: false });
    const startedRequestRef = useRef<string | undefined>(undefined);
    const currentRunTargetRef = useRef("");
    currentRunTargetRef.current = `${getActiveUserScope()}:${node?.id || ""}:${currentFingerprint}`;

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
    useEffect(() => () => abortRef.current?.abort(), [node?.id, currentFingerprint]);
    useEffect(() => { if (!enabled) abortRef.current?.abort(); }, [enabled]);

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

    const runReview = async (resume = false) => {
        if (abortRef.current) return;
        if (!node || !input) {
            setLocalError(t("canvasA.artCritique.needOneImage"));
            return;
        }
        if (!enabled) {
            setLocalError(t("canvasA.artCritique.pluginDisabledError"));
            return;
        }
        if (resume && (!state.billingRunId || state.sourceFingerprint !== artCritiqueSourceFingerprint(input) || state.lastRunModel !== selectedCritiqueModel)) {
            setLocalError(t("canvasA.artCritique.resumeChanged"));
            return;
        }
        setView("overview");
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setDraftReportVisible(false);
        const sourceFingerprint = artCritiqueSourceFingerprint(input);
        const runId = resume && state.lastRunId ? state.lastRunId : `art-critique-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        let billingRunId = resume ? state.billingRunId : undefined;
        const controller = new AbortController();
        abortRef.current = controller;
        onRunningChange?.(true);
        const runTarget = currentRunTargetRef.current;
        const runScope = getActiveUserScope();
        const publishState = (next: ArtCritiqueNodeState) => {
            if (getActiveUserScope() === runScope && currentRunTargetRef.current === runTarget && abortRef.current === controller) onUpdateState(node.id, { ...next, billingRunId, lastRunModel: selectedCritiqueModel });
        };
        const baseState: ArtCritiqueNodeState = {
            ...state,
            schemaVersion: ART_CRITIQUE_SCHEMA_VERSION,
            status: "running",
            analysisStage: "preparing",
            sourceNodeId: input.id,
            sourceFingerprint,
            lastRunId: runId,
            stageTaskIds: resume ? state.stageTaskIds : {},
            errorCode: undefined,
            errorMessage: undefined,
            updatedAt: new Date().toISOString(),
        };
        publishState(baseState);
        setRunning(true);
        setActiveStage("preparing");
        setLocalError("");
        let latestStage: ArtCritiquePipelineStage = "preparing";
        let runningReport: ArtCritiqueReport | undefined = state.report;
        const stageTaskIds: Record<string, string> = resume ? { ...state.stageTaskIds } : {};
        setPayment({ busy: false });
        const approval = new ApprovedToolExecution({
            clientKey: `art-critique:${runId}`, runId: billingRunId,
            identity: { kind: "art-critique", nodeId: node.id, sourceFingerprint, model: selectedCritiqueModel }, signal: controller.signal,
            onRun: (id) => { billingRunId = id; publishState({ ...baseState, stageTaskIds: { ...stageTaskIds } }); },
            onState: (next) => { if (currentRunTargetRef.current === runTarget) setPayment(next); },
        });
        approvalRef.current = approval;
        try {
            const report = await executeArtCritique({
                    nodeId: node.id, runId, source: input, config: effectiveConfig,
                    signal: controller.signal,
                    submitStage: approval.execute,
                    onTaskCreated: (stage, taskId) => {
                        stageTaskIds[stage] = taskId;
                        publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, analysisStage: latestStage, updatedAt: new Date().toISOString() });
                    },
                    onStage: (analysisStage) => {
                        latestStage = analysisStage;
                        setActiveStage(analysisStage);
                        publishState({
                            ...baseState,
                            stageTaskIds: { ...stageTaskIds },
                            ...(runningReport ? { report: { ...runningReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) } } : {}),
                            analysisStage,
                            updatedAt: new Date().toISOString(),
                        });
                    },
                    onDraftReport: (draftReport) => {
                        if (controller.signal.aborted || abortRef.current !== controller) return;
                        runningReport = draftReport;
                        setDraftReportVisible(true);
                        publishState({
                            ...baseState,
                            stageTaskIds: { ...stageTaskIds },
                            status: "running",
                            analysisStage: latestStage,
                            report: { ...draftReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) },
                            updatedAt: new Date().toISOString(),
                        });
                    },
            });
            setDraftReportVisible(false);
            publishState({
                ...baseState,
                stageTaskIds: { ...stageTaskIds },
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
                publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, status: "failed", analysisStage: "failed", errorCode: "analysis_interrupted", errorMessage: t("canvasA.artCritique.interrupted"), updatedAt: new Date().toISOString() });
                return;
            }
            const errorMessage = error instanceof Error ? error.message : t("canvasA.artCritique.failedDefault");
            setActiveStage("failed");
            setDraftReportVisible(false);
            setLocalError(errorMessage);
            publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, status: "failed", analysisStage: "failed", errorCode: error instanceof Error ? error.message : "art_critique_failed", errorMessage, updatedAt: new Date().toISOString() });
        } finally {
            approval.dispose();
            if (approvalRef.current === approval) { approvalRef.current = null; setPayment({ busy: false }); }
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
            onRunningChange?.(false);
        }
    };

    const progressStage = activeStage || visibleState.analysisStage || "preparing";
    const displayedModelLabel = visibleState.report?.modelLabel || configuredCritiqueModelLabel;
    useEffect(() => {
        if (!open || !node || !startRequestId || running || startedRequestRef.current === startRequestId) return;
        startedRequestRef.current = startRequestId;
        void runReview(Boolean(!restartRequested && state.billingRunId && state.status !== "completed" && state.sourceFingerprint === currentFingerprint && state.lastRunModel === selectedCritiqueModel));
    }, [open, node?.id, startRequestId, running]);

    const modelStatusLabel = running ? t("canvasA.artCritique.modelInUse") : visibleState.report?.modelLabel ? t("canvasA.artCritique.modelReport") : selectedCritiqueModel ? t("canvasA.artCritique.modelPending") : t("canvasA.artCritique.modelNeedsConfig");
    const modelStatusColor = selectedCritiqueModel || visibleState.report?.modelLabel ? theme.node.muted : "var(--status-warning)";
    const modelInlineLabel = selectedCritiqueModel || visibleState.report?.modelLabel ? `${modelStatusLabel} · ${displayedModelLabel}` : t("canvasA.artCritique.modelHint");

    return (
        <AppModal
            open={open}
            title={null}
            closable={false}
            width="min(1240px, calc(100vw - 32px))"
            centered
            destroyOnClose={false}
            onCancel={close}
            footer={null}
            className="art-critique-modal"
            flush
        >
            <div className="flex h-[min(820px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] min-h-0 flex-col overflow-hidden rounded-[var(--r-lg)]" style={{ background: theme.canvas.background, color: theme.node.text }}>
                <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4" style={{ borderColor: theme.node.edge }}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                        <ScanEye className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <h2 className="truncate text-base font-semibold">{t("canvasA.artCritique.title")}</h2>
                            {visibleState.report ? (
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--status-success) 12%, transparent)", color: "var(--status-success)" }}>
                                    {visibleState.report.issues.length ? t("canvasA.artCritique.issueCount", { count: visibleState.report.issues.length }) : reportOptions.length ? t("canvasA.artCritique.optionCount", { count: reportOptions.length }) : t("canvasA.artCritique.noKeyIssues")}
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                            {t("canvasA.artCritique.subtitle", { title: input?.title || t("canvasA.artCritique.waitingInput") })}
                        </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {running
                                ? artCritiqueStageLabel(visibleState.analysisStage)
                                : visibleState.status === "completed" && !stale
                                  ? t("canvasA.artCritique.statusCompleted")
                                  : visibleState.status === "stale"
                                    ? t("canvasA.artCritique.statusStale")
                                    : visibleState.status === "failed"
                                      ? t("canvasA.artCritique.statusFailed")
                                      : t("canvasA.artCritique.statusIdle")}
                        </span>
                    </div>
                    <IconButton variant="ghost" size="sm" icon={X} onClick={close} aria-label={t("canvasA.artCritique.close")} />
                </header>

                <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,.85fr)]">
                    <section className="flex h-[min(48dvh,520px)] min-h-[300px] min-w-0 flex-col gap-3 border-b p-4 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.edge }}>
                        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--r-lg)] border p-2" style={{ borderColor: theme.node.edge, background: "rgba(0,0,0,.18)" }}>
                            {previewUrl ? (
                                <img src={previewUrl} alt={input?.title || t("canvasA.artCritique.inputImage")} className="max-h-full max-w-full rounded-[var(--r-md)] object-contain shadow-[var(--shadow-md)]" draggable={false} />
                            ) : (
                                <EmptyState size="compact" icon={ImageIcon} title={input ? t("canvasA.assetPreview.imageLoading") : t("canvasA.artCritique.noInput")} />
                            )}
                            {overlayIssues.length && previewUrl ? <CritiqueOverlay issues={overlayIssues} issueNumberById={issueNumberById} selectedIssueId={overlayIssues[0]?.id || null} labelPlacements={labelPlacements} onSelect={openIssue} /> : null}
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{input?.title || t("canvasA.artCritique.waitingInput")}</div>
                                <div className="mt-1 truncate text-xs" style={{ color: theme.node.muted }}>
                                    {draftReportVisible && visibleState.status === "running"
                                        ? t("canvasA.artCritique.draftHint")
                                        : view === "detail" && detailIssue
                                          ? t("canvasA.artCritique.detailHint")
                                          : input
                                            ? t("canvasA.artCritique.hoverHint")
                                            : t("canvasA.artCritique.connectHint")}
                                </div>
                            </div>
                            {visibleState.report?.issues.length ? (
                                <span className="shrink-0 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--workspace-accent) 12%, transparent)", color: "var(--workspace-accent)" }}>
                                    {view === "detail" && detailIssue && detailIndex >= 0 ? t("canvasA.artCritique.issuePosition", { index: detailIndex + 1, total: repairedIssues.length }) : t("canvasA.artCritique.issueCount", { count: visibleState.report.issues.length })}
                                </span>
                            ) : null}
                        </div>
                    </section>

                    <aside className="min-h-0 flex-1 overflow-y-auto" data-canvas-wheel-scroll>
                        <div className="flex min-h-full flex-col gap-4 p-4">
                            {payment.quote ? <CreativeQuoteCard quote={payment.quote} busy={payment.busy} onApprove={() => void approvalRef.current?.approve(payment.quote!.items.map((item) => item.id))} onRefresh={() => void approvalRef.current?.refresh()} /> : null}
                            {payment.error ? <Callout tone="warning" title={t("canvasA.artCritique.paymentIncomplete")}>{payment.error}</Callout> : null}
                            {running || visibleState.status === "running" ? <ArtCritiqueProgress stage={progressStage} theme={theme} /> : null}
                            {draftReportVisible && visibleState.status === "running" && visibleState.report ? (
                                <Callout tone="info" title={t("canvasA.artCritique.draftTitle")}>
                                    {t("canvasA.artCritique.draftBody")}
                                </Callout>
                            ) : null}
                            {!enabled && !visibleState.report ? (
                                <Callout tone="warning" title={t("canvasA.artCritique.pluginDisabledTitle")}>
                                    {t("canvasA.artCritique.pluginDisabledBody")}
                                </Callout>
                            ) : null}
                            {visibleState.status === "stale" ? (
                                <Callout tone="warning" title={t("canvasA.artCritique.staleTitle")}>
                                    {t("canvasA.artCritique.staleBody")}
                                </Callout>
                            ) : null}
                            {localError || visibleState.errorMessage ? (
                                <Callout tone="error" title={t("canvasA.artCritique.failedTitle")}>
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
                                        <EmptyState className="my-auto" size="compact" icon={FileText} title={t("canvasA.artCritique.noReport")} />
                                    )}

                                    {visibleState.report && !visibleState.report.issues.length ? (
                                        <div
                                            className="flex items-start gap-3 rounded-[var(--r-lg)] border px-3 py-3 text-sm"
                                            style={{ borderColor: "color-mix(in oklch, var(--status-success) 35%, transparent)", background: "color-mix(in oklch, var(--status-success) 8%, transparent)" }}
                                        >
                                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                                            <div>
                                                <div className="font-semibold">{t("canvasA.artCritique.noPriorityIssues")}</div>
                                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                                    {reportOptions.length ? t("canvasA.artCritique.optionsNotErrors", { count: reportOptions.length }) : t("canvasA.artCritique.noIssuesExplain")}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {reportOptions.length ? (
                                        <section className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="m-0 text-sm font-semibold">{t("canvasA.artCritique.options")}</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                    {t("canvasA.artCritique.optionsNote")}
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
                                                <h3 className="m-0 text-sm font-semibold">{t("canvasA.artCritique.keyIssues")}</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                    {t("canvasA.artCritique.visibleCount", { visible: visibleIssues.length, total: visibleState.report.issues.length })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 overflow-x-auto pb-1" role="group" aria-label={t("canvasA.artCritique.filterLabel")}>
                                                <FilterChip label={t("canvasA.toolPicker.all")} active={filter === "all"} onClick={() => setFilter("all")} />
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
                                                    {t("canvasA.artCritique.filterEmpty")}
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
                                            {t("canvasA.artCritique.cancel")}
                                        </Button>
                                    ) : null}
                                    {!running && state.billingRunId && state.status !== "completed" && !stale && state.lastRunModel === selectedCritiqueModel ? <Button size="small" disabled={!input || !enabled} onClick={() => void runReview(true)}>{t("canvasA.artCritique.resume")}</Button> : null}
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="shrink-0"
                                        icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                                        loading={running}
                                        disabled={running || !input || !enabled || !selectedCritiqueModel}
                                        onClick={() => void runReview()}
                                    >
                                        {visibleState.report ? t("canvasA.artCritique.rerun") : t("canvasA.artCritique.start")}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </AppModal>
    );
}
