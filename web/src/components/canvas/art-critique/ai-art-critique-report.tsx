// AI 美术评审报告视图：进度、摘要、问题卡片与详情、修改方案、筛选与画面标注叠层。

import { artCritiqueCategoryLabel, type ArtCritiqueIssue, type ArtCritiqueNodeState, type ArtCritiqueOption, type ArtCritiquePipelineStage, artCritiqueSeverityLabel, artCritiqueStageLabel } from "@/lib/art-critique/contracts";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Copy, LoaderCircle, Target, ScanEye } from "lucide-react";
import { ART_CRITIQUE_CATEGORY_COLORS, ART_CRITIQUE_SEVERITY_COLORS, repairIssueTarget, targetBounds } from "@/lib/art-critique/annotation";
import { useCopyText } from "@/hooks/use-copy-text";
import { Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ArtCritiquePromptStatus, CanvasTheme } from "./ai-art-critique-modal";
import { progressFillStyle } from "@/lib/progress-fill";

export const ART_CRITIQUE_STAGE_PROGRESS: Record<ArtCritiquePipelineStage, number> = {
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

export function ArtCritiqueProgress({ stage, theme }: { stage: ArtCritiquePipelineStage; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const percent = ART_CRITIQUE_STAGE_PROGRESS[stage];
    const detail = stage === "reviewing" ? t("canvasA.artCritique.progressReviewing") : stage === "verifying" ? t("canvasA.artCritique.progressVerifying") : t("canvasA.artCritique.progressDefault");
    return (
        <section className="flex flex-col gap-2 rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.panel }} aria-label={t("canvasA.artCritique.progressLabel")}>
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
                    className="h-full rounded-full transition-transform duration-[250ms] ease-out motion-reduce:transition-none"
                    role="progressbar"
                    aria-label={t("canvasA.artCritique.progressBarLabel")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={t("canvasA.artCritique.progressValue", { stage: artCritiqueStageLabel(stage), percent })}
                    style={progressFillStyle(percent, { background: theme.accent.primary })}
                />
            </div>
            <div className="text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                {detail}
            </div>
        </section>
    );
}

export function ReportSummary({ report, theme, isDraft }: { report: NonNullable<ArtCritiqueNodeState["report"]>; theme: CanvasTheme; isDraft?: boolean }) {
    const { t } = useTranslation();
    const summary = report.summary || t("canvasA.artCritique.noSummary");
    const hasLongSummary = summary.length > 120;
    return (
        <section className="flex flex-col gap-2 border-b pb-4" style={{ borderColor: theme.node.edge }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                {isDraft ? (
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" style={{ color: "var(--workspace-accent)" }} aria-hidden="true" />
                ) : (
                    <CheckCircle2 className="size-4" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                )}
                <span>{isDraft ? t("canvasA.artCritique.overallDraft") : t("canvasA.artCritique.overall")}</span>
                {report.rubricVersion ? (
                    <span className="ml-auto text-[var(--fs-label)] font-normal" style={{ color: theme.node.muted }}>
                        {t("canvasA.artCritique.rubric", { version: report.rubricVersion })}
                    </span>
                ) : null}
            </div>
            <p className={`m-0 text-sm leading-6${hasLongSummary ? " line-clamp-3" : ""}`}>{summary}</p>
            {hasLongSummary ? (
                <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden" style={{ color: "var(--workspace-accent)" }}>
                        {t("canvasA.artCritique.viewFullSummary")}
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <p className="mt-2 mb-0 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {summary}
                    </p>
                </details>
            ) : null}
            {report.pipelineWarnings?.length ? (
                <details className="group rounded-[var(--r-md)] px-2 py-2 text-xs" style={{ background: "color-mix(in oklch, var(--status-warning) 8%, transparent)", color: "var(--status-warning)" }}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
                        {t("canvasA.artCritique.degraded")}
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
                        {t("canvasA.artCritique.strengths")}
                        <span className="inline-flex items-center gap-1 font-medium">
                            {t("canvasA.artCritique.itemCount", { count: report.strengths.length })}
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
                            {t("canvasA.artCritique.moreStrengths", { count: report.strengths.length - 3 })}
                        </div>
                    ) : null}
                </details>
            ) : null}
        </section>
    );
}

export function IssueCard({ issue, index, selected, theme, onClick, onHover }: { issue: ArtCritiqueIssue; index: number; selected: boolean; theme: CanvasTheme; onClick: () => void; onHover: (issueId: string | null) => void }) {
    const { t } = useTranslation();
    const color = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    return (
        <button
            type="button"
            className="group flex w-full items-start gap-3 border-b px-4 py-4 text-left outline-none transition last:border-b-0 hover:bg-black/[.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] dark:hover:bg-white/[.04]"
            style={{ borderColor: theme.node.edge, background: selected ? `color-mix(in oklch, ${color} 8%, ${theme.node.panel})` : "transparent", outlineColor: color }}
            onClick={onClick}
            onMouseEnter={() => onHover(issue.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(issue.id)}
            onBlur={() => onHover(null)}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] text-xs font-semibold" style={{ background: color, color: "#fff" }}>
                {index}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 text-sm font-semibold leading-5">{issue.title}</span>
                <span className="mt-2 flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span style={{ color }}>{artCritiqueSeverityLabel(issue.severity)}</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <>
                            <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                            <span>{t("canvasA.artCritique.needsReview")}</span>
                        </>
                    ) : null}
                    <span className="ml-auto shrink-0 tabular-nums">{Math.round(issue.confidence * 100)}%</span>
                </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 opacity-35 transition-opacity duration-150 group-hover:opacity-70" aria-hidden="true" />
        </button>
    );
}

export function IssueDetailView({
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
    const { t } = useTranslation();
    const targetSourceLabel = isDraft
        ? t("canvasA.artCritique.targetLocating")
        : issue.targetSource === "reference"
          ? t("canvasA.artCritique.targetReference")
          : issue.targetSource === "model"
            ? t("canvasA.artCritique.targetModel")
            : issue.target.type === "global"
              ? t("canvasA.artCritique.targetGlobal")
              : t("canvasA.artCritique.targetLocal");
    const severityColor = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    const copyText = useCopyText();
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
                    {t("canvasA.artCritique.issueList")}
                </Button>
                <span className="text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {t("canvasA.artCritique.issuePosition", { index: issueIndex + 1, total })}
                </span>
            </div>

            <section className="flex flex-col gap-3 border-b pb-5" style={{ borderColor: theme.node.edge }}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="size-2 rounded-full" style={{ background: severityColor }} aria-hidden="true" />
                    <span>{t("canvasA.artCritique.issueDetail")}</span>
                    <Tag bordered={false} className="ml-auto text-[var(--fs-label)]" style={{ color: severityColor }}>
                        {artCritiqueSeverityLabel(issue.severity)}
                    </Tag>
                </div>
                <h3 className="m-0 text-lg font-semibold leading-7">{issue.title}</h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span>{t("canvasA.artCritique.confidence", { percent: Math.round(issue.confidence * 100) })}</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklch, var(--status-warning) 12%, transparent)", color: "var(--status-warning)" }}>
                            {t("canvasA.artCritique.needsReview")}
                        </span>
                    ) : null}
                </div>
                <div className="rounded-[var(--r-md)] px-3 py-3" style={{ background: theme.node.panel }}>
                    <div className="mb-1 text-xs font-semibold" style={{ color: theme.node.muted }}>
                        {t("canvasA.artCritique.aiJudgement")}
                    </div>
                    <p className="m-0 text-sm leading-6">{issue.explanation}</p>
                </div>
                {issue.targetDescription ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        <span className="font-semibold">{t("canvasA.artCritique.targetLabel")}</span>
                        {issue.targetDescription}
                        <span className="ml-1 rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklch, var(--workspace-accent) 8%, transparent)" }}>
                            {targetSourceLabel}
                        </span>
                    </div>
                ) : null}
            </section>

            <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Target className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }} aria-hidden="true" />
                        <span>{t("canvasA.artCritique.improve")}</span>
                    </div>
                    {promptStatus === "ready" ? (
                        <Button
                            type="default"
                            size="small"
                            className="shrink-0"
                            icon={<Copy className="size-3.5" />}
                            aria-label={t("canvasA.artCritique.copyPromptLabel")}
                            onClick={() => copyText(issue.editPrompt || "", t("canvasA.artCritique.promptCopied"))}
                        >
                            {t("canvasA.artCritique.copyPrompt")}
                        </Button>
                    ) : (
                        <Button type="default" size="small" className="shrink-0" disabled icon={promptStatus === "pending" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Copy className="size-3.5" />}>
                            {promptStatus === "pending" ? t("canvasA.artCritique.promptGenerating") : t("canvasA.artCritique.promptMissing")}
                        </Button>
                    )}
                </div>
                {promptStatus === "pending" ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("canvasA.artCritique.promptPendingHint")}
                    </div>
                ) : null}
                {promptStatus === "unavailable" ? (
                    <div className="text-xs leading-5" style={{ color: "var(--status-warning)" }}>
                        {t("canvasA.artCritique.promptUnavailableHint")}
                    </div>
                ) : null}
                <div className="text-sm leading-6">
                    <span className="font-semibold">{t("canvasA.artCritique.goal")}</span>
                    {issue.suggestion.goal}
                </div>
                {issue.suggestion.actions.length ? (
                    <div>
                        <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                            {t("canvasA.artCritique.actions")}
                        </div>
                        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-6">
                            {issue.suggestion.actions.map((item, index) => (
                                <li key={item} className="flex items-start gap-2">
                                    <span
                                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[var(--fs-micro)] font-semibold"
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
                    <div className="rounded-[var(--r-md)] px-3 py-2" style={{ background: "color-mix(in oklch, var(--status-success) 6%, transparent)" }}>
                        <div className="mb-1 text-xs font-semibold" style={{ color: "var(--status-success)" }}>
                            {t("canvasA.artCritique.preserve")}
                        </div>
                        <ul className="m-0 list-disc space-y-1 pl-4 text-xs leading-5">
                            {issue.suggestion.preserve.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                <div className="rounded-[var(--r-md)] border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.edge, background: theme.node.panel }}>
                    <span className="font-semibold">{t("canvasA.artCritique.expected")}</span>
                    {issue.suggestion.expectedEffect}
                </div>
            </section>

            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: theme.node.edge }}>
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} disabled={issueIndex <= 0} onClick={onPrevious}>
                    {t("canvasA.artCritique.previous")}
                </Button>
                <Button type="text" size="small" icon={<ArrowRight className="size-4" />} disabled={issueIndex < 0 || issueIndex >= total - 1} onClick={onNext}>
                    {t("canvasA.artCritique.next")}
                </Button>
            </div>
        </div>
    );
}

export function OptionCard({ option, theme }: { option: ArtCritiqueOption; theme: CanvasTheme }) {
    const { t } = useTranslation();
    return (
        <article className="rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                <ScanEye className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[option.category] }} aria-hidden="true" />
                <span className="min-w-0 flex-1">{option.title}</span>
                <span className="shrink-0 text-[var(--fs-label)] font-normal" style={{ color: theme.node.muted }}>
                    {t("canvasA.artCritique.optionConfidence", { percent: Math.round(option.confidence * 100) })}
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

export function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="rounded-full border px-2 py-1 text-xs font-medium outline-none transition-[background-color,border-color,box-shadow,color] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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

export function CritiqueOverlay({
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
    const { t } = useTranslation();
    return (
        <svg className="pointer-events-none absolute inset-3 size-[calc(100%-1.5rem)]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("canvasA.artCritique.overlayLabel")}>
            <title>{t("canvasA.artCritique.overlayLabel")}</title>
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
                        aria-label={t("canvasA.artCritique.overlayItem", { number: issueNumber, title: renderIssue.title })}
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
                        <title>{t("canvasA.artCritique.overlayItem", { number: issueNumber, title: renderIssue.title })}</title>
                    </g>
                );
            })}
        </svg>
    );
}
