import { ArrowRight, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { projectAttentionCount, projectContinueTarget, projectDetailStage, projectNextActions, projectUnitStages, type ProjectStageCell, type ProjectWorkbenchAction } from "@/lib/project-workbench";

import { formatTime, type ProjectDetailViewProps } from "./shared";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export default function ProjectOverviewView({ detail }: ProjectDetailViewProps) {
    const { t } = useTranslation("project");
    const { project, units, canvases, shots } = detail;
    const completedUnits = units.filter((unit) => unit.status === "completed").length;
    const attentionCount = projectAttentionCount(detail);
    const completion = units.length ? Math.round((completedUnits / units.length) * 100) : 0;
    const stage = projectDetailStage(detail);
    const actions = projectNextActions(detail, 3);
    const primaryAction = actions[0];
    const secondaryActions = actions.slice(1);
    const continueTarget = projectContinueTarget(detail);
    const unitStages = projectUnitStages(detail);

    return (
        <div className="space-y-8">
            <section className="project-overview-focus">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_308px]">
                    <div className="project-overview-primary">
                        <div className="project-overview-eyebrow">
                            <span>{t("project:current-task")}</span>
                            <span className="project-overview-eyebrow-divider" aria-hidden>
                                /
                            </span>
                            <span className="project-overview-eyebrow-stage">{stage.label}</span>
                            {attentionCount ? (
                                <span className="project-overview-eyebrow-badge">
                                    {attentionCount} {t("project:items-pending")}
                                </span>
                            ) : null}
                        </div>
                        <h2 className="project-overview-title">{primaryAction.title}</h2>
                        <p className="project-overview-description">{primaryAction.description}</p>
                        <div className="project-overview-cta">
                            {/* 主按钮走 --btn-solid-* 配对色：原先是 bg-[--workspace-accent] + text-white，
                                而暗色下该 accent 是 #f5f5f5，等于白底白字。 */}
                            <Link to={primaryAction.href} className="project-overview-cta-primary">
                                <span className="truncate">{primaryAction.actionLabel}</span>
                                <ArrowRight className="size-4 shrink-0" />
                            </Link>
                            {continueTarget.href !== primaryAction.href ? (
                                <Link to={continueTarget.href} className="project-overview-cta-secondary">
                                    {t("project:resume-recent-work")}
                                    <ArrowRight className="size-3.5" />
                                </Link>
                            ) : null}
                        </div>
                    </div>

                    <aside className="project-overview-status" aria-label={t("project:project-progress")}>
                        <div className="project-overview-progress">
                            <div className="project-overview-progress-head">
                                <span className="project-overview-status-label">{t("project:chapter-progress-3")}</span>
                                <span className="project-overview-progress-percent">{completion}%</span>
                            </div>
                            <div className="project-overview-progress-count">
                                {completedUnits}
                                <span>/ {units.length}</span>
                            </div>
                            <div className="project-overview-progress-track" aria-label={t("project:param-of-chapters-done", { completion: completion })}>
                                <div style={{ width: `${completion}%` }} />
                            </div>
                        </div>
                        <dl className="project-overview-facts">
                            <ProjectFact label={t("project:current-stage")} value={stage.label} />
                            <ProjectFact label={t("project:storyboards")} value={t("project:param", { length: shots.length })} />
                            <ProjectFact label={t("project:project-canvases")} value={t("project:param-2", { length: canvases.length })} />
                            <ProjectFact label={t("project:needs-attention")} value={t("project:param-3", { attentionCount: attentionCount })} attention={attentionCount > 0} />
                        </dl>
                        {secondaryActions.length ? (
                            <div className="project-overview-next">
                                <span className="project-overview-status-label">{t("project:later")}</span>
                                <div className="mt-2 space-y-0.5">
                                    {secondaryActions.map((action) => (
                                        <SecondaryAction key={action.id} action={action} />
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </section>

            <section>
                <div className="project-pipeline-head">
                    <div className="min-w-0">
                        <h2 className="project-pipeline-title">{t("project:chapter-progress-3")}</h2>
                        <p className="project-pipeline-hint">{t("project:from-content-confirmation-to-project-canvases-each-chapter-shows-its-tru")}</p>
                    </div>
                    <Link to={`/projects/${project.id}/chapters`} className="project-pipeline-more">
                        {t("project:view-all-chapters")}
                        <ArrowRight className="size-3.5" />
                    </Link>
                </div>

                {unitStages.length ? (
                    <div className="project-pipeline-surface">
                        {unitStages.map((item) => (
                            <Link key={item.unit.id} to={`/projects/${project.id}/chapters/${item.unit.id}`} className="project-pipeline-row group">
                                <span className="project-pipeline-chapter">
                                    <span className="project-pipeline-index">{String(item.unit.position + 1).padStart(2, "0")}</span>
                                    <span className="min-w-0">
                                        <span className="project-pipeline-chapter-title">{item.unit.title}</span>
                                        <span className="project-pipeline-chapter-time">
                                            {t("project:updated-2")} {formatTime(item.unit.updatedAt)}
                                        </span>
                                    </span>
                                </span>
                                <StagePipeline content={item.content} assets={item.assets} storyboard={item.storyboard} canvas={item.canvas} />
                                <ArrowRight className="project-pipeline-arrow size-4" />
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="project-pipeline-surface p-2">
                        <WorkspaceState icon="projects" compact title={t("project:no-story-chapters-yet")} description={t("project:after-adding-chapters-production-progress-for-content-assets-storyboards")} />
                    </div>
                )}
            </section>
        </div>
    );
}

function ProjectFact({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
    return (
        <div className="min-w-0">
            <dt>{label}</dt>
            <dd className={attention ? "is-attention" : ""}>{value}</dd>
        </div>
    );
}

function SecondaryAction({ action }: { action: ProjectWorkbenchAction }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return (
        <Link to={action.href} className="project-overview-next-item group">
            <Icon className={`size-3.5 shrink-0 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/30"}`} />
            <span className="min-w-0 flex-1 truncate">{action.title}</span>
            <ArrowRight className="size-3 shrink-0 text-foreground/25 transition group-hover:text-foreground/55" />
        </Link>
    );
}

function StagePipeline({ content, assets, storyboard, canvas }: { content: ProjectStageCell; assets: ProjectStageCell; storyboard: ProjectStageCell; canvas: ProjectStageCell }) {
    const { t } = useTranslation("project");
    const stages = [
        { label: t("project:content"), cell: content },
        { label: t("project:assets"), cell: assets },
        { label: t("project:storyboards-2"), cell: storyboard },
        { label: t("project:canvas-2"), cell: canvas },
    ];
    return (
        <span className="project-pipeline-stages">
            {stages.map(({ label, cell }) => (
                <StageStep key={label} label={label} cell={cell} />
            ))}
        </span>
    );
}

function StageStep({ label, cell }: { label: string; cell: ProjectStageCell }) {
    return (
        <span className={`project-pipeline-stage is-${cell.state}`}>
            <span className="project-pipeline-stage-label">{label}</span>
            <span className="project-pipeline-stage-track" />
            <span className="project-pipeline-stage-value">{cell.label}</span>
        </span>
    );
}
