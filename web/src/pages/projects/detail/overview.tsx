import { ArrowRight, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { projectAttentionCount, projectContinueTarget, projectDetailStage, projectNextActions, projectUnitStages, type ProjectStageCell, type ProjectWorkbenchAction } from "@/lib/project-workbench";

import { formatTime, type ProjectDetailViewProps } from "./shared";

export default function ProjectOverviewView({ detail }: ProjectDetailViewProps) {
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
        <div className="space-y-7">
            <section className="project-overview-focus overflow-hidden rounded-lg border border-border/75 bg-background/80 shadow-sm">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="min-w-0 p-5 sm:p-6 lg:p-7">
                        <div className="flex flex-wrap items-center gap-2 text-[var(--fs-label)]">
                            <span className="font-medium text-[var(--workspace-accent)]">当前任务</span>
                            <span className="text-foreground/20" aria-hidden>/</span>
                            <span className="text-foreground/45">{stage.label}</span>
                            {attentionCount ? <span className="rounded bg-foreground/[.07] px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/70">{attentionCount} 项待处理</span> : null}
                        </div>
                        <h2 className="mt-3 max-w-[680px] text-2xl font-semibold leading-8 text-balance">{primaryAction.title}</h2>
                        <p className="mt-2 max-w-[680px] text-sm leading-6 text-foreground/52 text-pretty">{primaryAction.description}</p>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <Link to={primaryAction.href} className="inline-flex h-10 max-w-full items-center gap-2 rounded-md bg-[var(--workspace-accent)] px-4 text-sm font-medium text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="truncate">{primaryAction.actionLabel}</span><ArrowRight className="size-4 shrink-0" />
                            </Link>
                            {continueTarget.href !== primaryAction.href ? <Link to={continueTarget.href} className="inline-flex h-10 items-center gap-2 px-1 text-xs font-medium text-foreground/48 hover:text-foreground">继续最近工作<ArrowRight className="size-3.5" /></Link> : null}
                        </div>
                    </div>

                    <aside className="project-overview-status border-t border-border/70 bg-foreground/[.018] p-5 lg:border-l lg:border-t-0 lg:p-6" aria-label="项目进度">
                        <div className="flex items-end justify-between gap-3">
                            <div><div className="text-[var(--fs-tiny)] font-medium text-foreground/38">章节进度</div><div className="mt-1 text-lg font-semibold tabular-nums">{completedUnits}<span className="mx-1 text-sm font-normal text-foreground/28">/</span>{units.length}</div></div>
                            <span className="text-xs font-medium tabular-nums text-foreground/42">{completion}%</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[.08]" aria-label={`章节完成度 ${completion}%`}><div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width]" style={{ width: `${completion}%` }} /></div>
                        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
                            <ProjectFact label="当前阶段" value={stage.label} />
                            <ProjectFact label="分镜镜头" value={`${shots.length} 个`} />
                            <ProjectFact label="项目画布" value={`${canvases.length} 张`} />
                            <ProjectFact label="需要处理" value={`${attentionCount} 项`} attention={attentionCount > 0} />
                        </dl>
                        {secondaryActions.length ? (
                            <div className="mt-5 border-t border-border/65 pt-4">
                                <div className="text-[var(--fs-tiny)] font-medium text-foreground/38">随后处理</div>
                                <div className="mt-2 space-y-1">{secondaryActions.map((action) => <SecondaryAction key={action.id} action={action} />)}</div>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </section>

            <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="text-[var(--fs-tiny)] font-medium text-foreground/38">制作流水线</div>
                        <h2 className="mt-1 text-lg font-semibold">章节进度</h2>
                        <p className="mt-1 text-xs leading-5 text-foreground/46">从内容确认到项目画布，每章只显示当前真实状态。</p>
                    </div>
                    <Link to={`/projects/${project.id}/chapters`} className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-foreground/48 hover:text-foreground">查看全部章节<ArrowRight className="size-3.5" /></Link>
                </div>

                {unitStages.length ? (
                    <div className="project-pipeline-surface mt-4 overflow-hidden rounded-lg border border-border/75 bg-background/70">
                        <div className="divide-y divide-border/65">
                            {unitStages.map((item) => (
                                <Link key={item.unit.id} to={`/projects/${project.id}/chapters/${item.unit.id}`} className="group grid gap-4 p-4 transition-colors hover:bg-foreground/[.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 sm:p-5 lg:grid-cols-[minmax(220px,.75fr)_minmax(480px,1.35fr)_24px] lg:items-center">
                                    <span className="flex min-w-0 items-center gap-3">
                                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.055] text-[var(--fs-tiny)] font-semibold tabular-nums text-foreground/45">{String(item.unit.position + 1).padStart(2, "0")}</span>
                                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.unit.title}</span><span className="mt-1 block text-[var(--fs-tiny)] text-foreground/36">更新于 {formatTime(item.unit.updatedAt)}</span></span>
                                    </span>
                                    <StagePipeline content={item.content} assets={item.assets} storyboard={item.storyboard} canvas={item.canvas} />
                                    <ArrowRight className="hidden size-4 text-foreground/22 transition group-hover:translate-x-0.5 group-hover:text-foreground/55 lg:block" />
                                </Link>
                            ))}
                        </div>
                    </div>
                ) : <div className="mt-4 overflow-hidden rounded-lg border border-border/75 bg-background/70 p-2"><WorkspaceState icon="projects" compact title="还没有剧情章节" description="添加章节后，这里会显示内容、资产、分镜和画布的制作进度。" /></div>}
            </section>
        </div>
    );
}

function ProjectFact({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
    return <div className="min-w-0"><dt className="text-[var(--fs-tiny)] text-foreground/36">{label}</dt><dd className={`mt-1 truncate font-medium ${attention ? "text-foreground/85" : "text-foreground/72"}`}>{value}</dd></div>;
}

function SecondaryAction({ action }: { action: ProjectWorkbenchAction }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return <Link to={action.href} className="group flex min-w-0 items-center gap-2 rounded px-1 py-1.5 text-[var(--fs-label)] text-foreground/52 hover:bg-foreground/[.04] hover:text-foreground"><Icon className={`size-3.5 shrink-0 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/30"}`} /><span className="min-w-0 flex-1 truncate">{action.title}</span><ArrowRight className="size-3 shrink-0 text-foreground/25 transition group-hover:text-foreground/55" /></Link>;
}

function StagePipeline({ content, assets, storyboard, canvas }: { content: ProjectStageCell; assets: ProjectStageCell; storyboard: ProjectStageCell; canvas: ProjectStageCell }) {
    const stages = [{ label: "内容", cell: content }, { label: "资产", cell: assets }, { label: "分镜", cell: storyboard }, { label: "画布", cell: canvas }];
    return (
        <span className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
            {stages.map(({ label, cell }) => <StageStep key={label} label={label} cell={cell} />)}
        </span>
    );
}

function StageStep({ label, cell }: { label: string; cell: ProjectStageCell }) {
    const bar = cell.state === "completed" ? "bg-foreground/65" : cell.state === "attention" ? "bg-foreground/40" : cell.state === "active" ? "bg-[var(--workspace-accent)]" : "bg-foreground/10";
    return (
        <span className="min-w-0">
            <span className="block text-[var(--fs-tiny)] font-medium text-foreground/34">{label}</span>
            <span className={`mt-2 block h-1 rounded-full ${bar}`} />
            <span className="mt-1.5 block truncate text-[var(--fs-tiny)] text-foreground/48">{cell.label}</span>
        </span>
    );
}
