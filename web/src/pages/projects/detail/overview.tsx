import { ArrowRight, BookOpenText, CheckCircle2, CircleAlert, Clapperboard, Clock3, Film, PackageCheck, PlaySquare, UsersRound } from "lucide-react";
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
    const firstUnitId = units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    const workflowHref = (targetStage: string) => firstUnitId ? `/projects/${project.id}/workflow/${firstUnitId}/${targetStage}` : `/projects/${project.id}/chapters`;
    const readyArtifacts = detail.shotArtifacts.filter((artifact) => artifact.status === "ready");
    const readyStoryboardCount = new Set(readyArtifacts.filter((artifact) => artifact.type === "storyboard").map((artifact) => artifact.shotId)).size;
    const readyPrevizCount = new Set(readyArtifacts.filter((artifact) => artifact.type === "action_board").map((artifact) => artifact.shotId)).size;
    const readyVideoCount = new Set(readyArtifacts.filter((artifact) => artifact.type === "video").map((artifact) => artifact.shotId)).size;
    const productionSteps = [
        { id: "story", icon: BookOpenText, label: "剧情章节", description: "导入或编写正文，确认每章叙事目标", metric: `${units.length} 章 · ${formatCompactCount(units.reduce((total, unit) => total + (unit.wordCount || 0), 0))} 字`, href: `/projects/${project.id}/chapters`, complete: units.length > 0 },
        { id: "assets", icon: UsersRound, label: "角色与资产", description: "确认角色、场景、道具和项目画风", metric: `${detail.assets.length} 项资产`, href: `/projects/${project.id}/assets`, complete: detail.assets.length > 0 },
        { id: "storyboard", icon: Clapperboard, label: "分镜脚本与画面", description: "拆分镜头并确认构图、对白和时长", metric: `${shots.length} 镜 · ${readyStoryboardCount} 张图`, href: workflowHref("storyboard"), complete: shots.length > 0 },
        { id: "previz", icon: PlaySquare, label: "动作预演", description: "检查表演节拍、运镜和连续性", metric: `${readyPrevizCount}/${shots.length || 0} 镜`, href: workflowHref("previz"), complete: shots.length > 0 && readyPrevizCount === shots.length },
        { id: "video", icon: Film, label: "镜头视频", description: "逐镜生成、筛选版本并锁定成片", metric: `${readyVideoCount}/${shots.length || 0} 镜`, href: workflowHref("video"), complete: shots.length > 0 && readyVideoCount === shots.length },
        { id: "delivery", icon: PackageCheck, label: "交付与打包", description: "检查缺失镜头并整理最终产物", metric: readyVideoCount && readyVideoCount === shots.length ? "可以交付" : `还差 ${Math.max(0, shots.length - readyVideoCount)} 镜`, href: workflowHref("delivery"), complete: shots.length > 0 && readyVideoCount === shots.length },
    ];
    const gaps = [
        units.length === 0 ? "还没有剧情章节" : units.some((unit) => !unit.wordCount) ? `${units.filter((unit) => !unit.wordCount).length} 章还没有正文` : "章节正文已就绪",
        detail.assetCandidates.some((candidate) => candidate.status === "pending_confirmation") ? `${detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length} 项资产等待确认` : detail.assets.length ? "项目资产已建立" : "还没有角色与资产",
        shots.length ? readyVideoCount === shots.length ? "所有镜头视频已生成" : `${shots.length - readyVideoCount} 个镜头尚未生成视频` : "还没有分镜镜头",
    ];

    return (
        <div className="space-y-8">
            <section className="project-overview-focus">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_308px]">
                    <div className="project-overview-primary">
                        <div className="project-overview-eyebrow">
                            <span>当前任务</span>
                            <span className="project-overview-eyebrow-divider" aria-hidden>/</span>
                            <span className="project-overview-eyebrow-stage">{stage.label}</span>
                            {attentionCount ? <span className="project-overview-eyebrow-badge">{attentionCount} 项待处理</span> : null}
                        </div>
                        <h2 className="project-overview-title">{primaryAction.title}</h2>
                        <p className="project-overview-description">{primaryAction.description}</p>
                        <div className="project-overview-cta">
                            {/* 主按钮走 --btn-solid-* 配对色：原先是 bg-[--workspace-accent] + text-white，
                                而暗色下该 accent 是 #f5f5f5，等于白底白字。 */}
                            <Link to={primaryAction.href} className="project-overview-cta-primary">
                                <span className="truncate">{primaryAction.actionLabel}</span><ArrowRight className="size-4 shrink-0" />
                            </Link>
                            {continueTarget.href !== primaryAction.href ? <Link to={continueTarget.href} className="project-overview-cta-secondary">继续最近工作<ArrowRight className="size-3.5" /></Link> : null}
                        </div>
                    </div>

                    <aside className="project-overview-status" aria-label="项目进度">
                        <div className="project-overview-progress">
                            <div className="project-overview-progress-head">
                                <span className="project-overview-status-label">章节进度</span>
                                <span className="project-overview-progress-percent">{completion}%</span>
                            </div>
                            <div className="project-overview-progress-count">{completedUnits}<span>/ {units.length}</span></div>
                            <div className="project-overview-progress-track" aria-label={`章节完成度 ${completion}%`}><div style={{ width: `${completion}%` }} /></div>
                        </div>
                        <dl className="project-overview-facts">
                            <ProjectFact label="当前阶段" value={stage.label} />
                            <ProjectFact label="分镜镜头" value={`${shots.length} 个`} />
                            <ProjectFact label="项目画布" value={`${canvases.length} 张`} />
                            <ProjectFact label="需要处理" value={`${attentionCount} 项`} attention={attentionCount > 0} />
                        </dl>
                        {secondaryActions.length ? (
                            <div className="project-overview-next">
                                <span className="project-overview-status-label">随后处理</span>
                                <div className="mt-2 space-y-0.5">{secondaryActions.map((action) => <SecondaryAction key={action.id} action={action} />)}</div>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </section>

            <section className="project-standard-flow">
                <div className="project-standard-flow-head"><div><span>标准制作流程</span><h2>从章节到可交付镜头</h2><p>先确认故事与资产，再逐镜完成画面、动作和视频。每个步骤都可直接进入对应工作区。</p></div><Link to={primaryAction.href}>继续当前任务<ArrowRight /></Link></div>
                <div className="project-standard-flow-track">
                    {productionSteps.map((step, index) => { const Icon = step.icon; return <Link key={step.id} to={step.href} className={step.complete ? "is-complete" : ""}><span className="project-standard-flow-index">{step.complete ? <CheckCircle2 /> : index + 1}</span><span className="project-standard-flow-icon"><Icon /></span><strong>{step.label}</strong><p>{step.description}</p><em>{step.metric}</em><ArrowRight className="project-standard-flow-arrow" /></Link>; })}
                </div>
                <div className="project-standard-flow-footer"><div><strong>当前制作检查</strong>{gaps.map((gap, index) => <span key={gap}><i className={index === 2 && readyVideoCount !== shots.length ? "is-attention" : ""} />{gap}</span>)}</div><div><strong>快速入口</strong><Link to={`/projects/${project.id}/chapters`}>整理章节</Link><Link to={`/projects/${project.id}/assets`}>确认资产</Link><Link to={workflowHref("video")}>继续镜头制作</Link></div></div>
            </section>

            <section>
                <div className="project-pipeline-head">
                    <div className="min-w-0">
                        <h2 className="project-pipeline-title">章节进度</h2>
                        <p className="project-pipeline-hint">从内容确认到项目画布，每章只显示当前真实状态。</p>
                    </div>
                    <Link to={`/projects/${project.id}/chapters`} className="project-pipeline-more">查看全部章节<ArrowRight className="size-3.5" /></Link>
                </div>

                {unitStages.length ? (
                    <div className="project-pipeline-surface">
                        {unitStages.map((item) => (
                            <Link key={item.unit.id} to={`/projects/${project.id}/chapters/${item.unit.id}`} className="project-pipeline-row group">
                                <span className="project-pipeline-chapter">
                                    <span className="project-pipeline-index">{String(item.unit.position + 1).padStart(2, "0")}</span>
                                    <span className="min-w-0"><span className="project-pipeline-chapter-title">{item.unit.title}</span><span className="project-pipeline-chapter-time">更新于 {formatTime(item.unit.updatedAt)}</span></span>
                                </span>
                                <StagePipeline content={item.content} assets={item.assets} storyboard={item.storyboard} canvas={item.canvas} />
                                <ArrowRight className="project-pipeline-arrow size-4" />
                            </Link>
                        ))}
                    </div>
                ) : <div className="project-pipeline-surface p-2"><WorkspaceState icon="projects" compact title="还没有剧情章节" description="添加章节后，这里会显示内容、资产、分镜和画布的制作进度。" /></div>}
            </section>
        </div>
    );
}

function formatCompactCount(value: number) {
    return value >= 10_000 ? `${Math.round(value / 1_000) / 10} 万` : value.toLocaleString("zh-CN");
}

function ProjectFact({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
    return <div className="min-w-0"><dt>{label}</dt><dd className={attention ? "is-attention" : ""}>{value}</dd></div>;
}

function SecondaryAction({ action }: { action: ProjectWorkbenchAction }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return <Link to={action.href} className="project-overview-next-item group"><Icon className={`size-3.5 shrink-0 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/30"}`} /><span className="min-w-0 flex-1 truncate">{action.title}</span><ArrowRight className="size-3 shrink-0 text-foreground/25 transition group-hover:text-foreground/55" /></Link>;
}

function StagePipeline({ content, assets, storyboard, canvas }: { content: ProjectStageCell; assets: ProjectStageCell; storyboard: ProjectStageCell; canvas: ProjectStageCell }) {
    const stages = [{ label: "内容", cell: content }, { label: "资产", cell: assets }, { label: "分镜", cell: storyboard }, { label: "画布", cell: canvas }];
    return (
        <span className="project-pipeline-stages">
            {stages.map(({ label, cell }) => <StageStep key={label} label={label} cell={cell} />)}
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
