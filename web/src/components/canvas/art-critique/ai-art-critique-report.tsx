// AI 美术评审报告视图：进度、摘要、问题卡片与详情、修改方案、筛选与画面标注叠层。

import { artCritiqueCategoryLabel, type ArtCritiqueIssue, type ArtCritiqueNodeState, type ArtCritiqueOption, type ArtCritiquePipelineStage, artCritiqueSeverityLabel, artCritiqueStageLabel } from "@/lib/art-critique/contracts";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Copy, LoaderCircle, Sparkles, Target } from "lucide-react";
import { ART_CRITIQUE_CATEGORY_COLORS, ART_CRITIQUE_SEVERITY_COLORS, repairIssueTarget, targetBounds } from "@/lib/art-critique/annotation";
import { useCopyText } from "@/hooks/use-copy-text";
import { Button, Tag } from "antd";
import type { ArtCritiquePromptStatus, CanvasTheme } from "./ai-art-critique-modal";

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

export function ReportSummary({ report, theme, isDraft }: { report: NonNullable<ArtCritiqueNodeState["report"]>; theme: CanvasTheme; isDraft?: boolean }) {
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

export function IssueCard({ issue, index, selected, theme, onClick, onHover }: { issue: ArtCritiqueIssue; index: number; selected: boolean; theme: CanvasTheme; onClick: () => void; onHover: (issueId: string | null) => void }) {
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

export function OptionCard({ option, theme }: { option: ArtCritiqueOption; theme: CanvasTheme }) {
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

export function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
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
