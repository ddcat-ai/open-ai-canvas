import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { ArrowRight, BookOpenText, Bot, CheckCircle2, CircleAlert, Clapperboard, Clock3, FolderKanban, Images, LayoutGrid, ListChecks, Plus, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { projectAttentionCount, projectContinueTarget, projectDetailStage, projectNextActions, projectSummaryCompletion } from "@/lib/project-workbench";
import { getProject, listProjects, type ProjectSummary } from "@/services/api/projects";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

const workflow = [
    { title: "整理故事", description: "导入小说、粘贴文本或创建章节" },
    { title: "确认设定", description: "整理角色、场景、画风和参考资料" },
    { title: "制作镜头", description: "生成分镜、图片和视频候选" },
    { title: "检查结果", description: "比较版本、处理失败并整理导出" },
];

export default function IndexPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const user = useUserStore((state) => state.user);
    const userHydrated = useUserStore((state) => state.hydrated);
    const domainProjectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled: Boolean(user) });
    const domainProjects = useMemo(
        () => [...(domainProjectsQuery.data?.projects || [])].sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt)),
        [domainProjectsQuery.data],
    );
    const activeProject = domainProjects.find(({ project }) => project.status !== "archived") || domainProjects[0];
    const activeProjectQuery = useQuery({
        queryKey: ["project", activeProject?.project.id],
        queryFn: () => getProject(activeProject!.project.id),
        enabled: Boolean(user && activeProject?.project.id),
    });
    const recentIndependentCanvases = useMemo(
        () => canvasProjects.filter((project) => !project.projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3),
        [canvasProjects],
    );

    const createIndependentCanvas = () => {
        if (!canvasHydrated) return;
        if (!user) {
            navigate(`/login?next=${encodeURIComponent("/canvas?mode=new")}`);
            return;
        }
        void createCanvasProjectWithRemoteSync(`自由画布 ${canvasProjects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            navigate(`/canvas/${id}`);
        });
    };

    const loadingUserWorkspace = !userHydrated || (Boolean(user) && domainProjectsQuery.isLoading);
    return (
        <main className="app-user-content app-workspace-canvas h-full overflow-y-auto text-foreground">
            <div className="app-home-workbench mx-auto w-full max-w-[1440px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
                {loadingUserWorkspace ? (
                    <WorkspaceLoadingState className="mt-3 max-w-[980px]" label="正在恢复工作台" detail="读取项目、章节和最近画布" rows={5} />
                ) : user && domainProjectsQuery.isError ? (
                    <WorkspaceErrorState title="项目工作台加载失败" description={domainProjectsQuery.error instanceof Error ? domainProjectsQuery.error.message : "暂时无法读取项目列表。"} onRetry={() => void domainProjectsQuery.refetch()} />
                ) : activeProject ? (
                    <ReturningWorkspace
                        summary={activeProject}
                        detail={activeProjectQuery.data}
                        detailLoading={activeProjectQuery.isLoading}
                        detailError={activeProjectQuery.isError}
                        recentProjects={domainProjects.slice(0, 5)}
                        recentIndependentCanvases={recentIndependentCanvases}
                        onCreateIndependentCanvas={createIndependentCanvas}
                    />
                ) : (
                    <FirstProjectWorkspace
                        authenticated={Boolean(user)}
                        canvasHydrated={canvasHydrated}
                        recentIndependentCanvases={recentIndependentCanvases}
                        onCreateIndependentCanvas={createIndependentCanvas}
                    />
                )}
            </div>
        </main>
    );
}

function ReturningWorkspace({ summary, detail, detailLoading, detailError, recentProjects, recentIndependentCanvases, onCreateIndependentCanvas }: {
    summary: ProjectSummary;
    detail?: Awaited<ReturnType<typeof getProject>>;
    detailLoading: boolean;
    detailError: boolean;
    recentProjects: ProjectSummary[];
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
}) {
    const stage = detail ? projectDetailStage(detail) : { label: "进行中", detail: "读取项目进度" };
    const continueTarget = detail ? projectContinueTarget(detail) : { href: `/projects/${summary.project.id}/overview`, title: summary.project.name, context: "打开项目概览", updatedAt: summary.project.updatedAt };
    const nextActions = detail ? projectNextActions(detail, 3) : [];
    const completion = projectSummaryCompletion(summary);
    const attentionCount = detail ? projectAttentionCount(detail) : 0;
    return (
        <>
            <header className="app-home-header flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <WorkspaceSignalIcon variant="home" />
                    <div className="min-w-0">
                        <h1 className="text-[var(--fs-title)] font-semibold leading-7">继续创作</h1>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">回到最近工作，或先处理阻塞制作的事项。</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<LayoutGrid className="size-3.5" />} onClick={onCreateIndependentCanvas}>打开画布</Button>
                    <Link className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25" to="/projects?create=1"><Plus className="size-3.5" />创建项目</Link>
                </div>
            </header>

            <section className="app-home-metrics grid grid-cols-2 gap-3 py-5 xl:grid-cols-4" aria-label="项目状态概览">
                <WorkspaceMetric icon={<BookOpenText />} label="剧情章节" value={summary.unitCount} detail={`${summary.completedUnitCount} 章已完成`} />
                <WorkspaceMetric icon={<LayoutGrid />} label="项目画布" value={summary.canvasCount} detail="已关联制作空间" />
                <WorkspaceMetric icon={<Images />} label="项目资产" value={summary.assetCount} detail="角色、场景与媒体" />
                <WorkspaceMetric icon={<CircleAlert />} label="需要处理" value={attentionCount} detail={attentionCount ? "建议优先处理" : "当前流程顺畅"} attention={attentionCount > 0} />
            </section>

            <section className="app-home-focus-panel grid overflow-hidden rounded-lg border border-border/80 lg:grid-cols-[minmax(260px,.8fr)_minmax(320px,1fr)_minmax(280px,.72fr)]">
                <div className="min-w-0 p-5 sm:p-6 lg:p-7">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
                        <span className="font-medium text-[var(--workspace-accent)]">{stage.label}</span>
                        <span aria-hidden>·</span>
                        <span>{stage.detail}</span>
                    </div>
                    <h2 className="mt-3 truncate text-2xl font-semibold sm:text-3xl">{summary.project.name}</h2>
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-foreground/52">
                        <span>{summary.completedUnitCount}/{summary.unitCount} 章已完成</span>
                        <span>{summary.canvasCount} 张项目画布</span>
                        <span>{summary.assetCount} 项资产</span>
                        <span>更新于 {formatRelativeTime(summary.project.updatedAt)}</span>
                    </div>
                    <div className="mt-4 h-1.5 w-full max-w-[620px] overflow-hidden rounded-full bg-foreground/[.08]" aria-label={`章节完成度 ${completion}%`}>
                        <div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width]" style={{ width: `${completion}%` }} />
                    </div>
                    <Link to={continueTarget.href} className="mt-6 inline-flex min-h-10 max-w-full items-center gap-3 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25">
                        <span className="min-w-0 truncate">{continueTarget.context} · {continueTarget.title}</span>
                        <ArrowRight className="size-4 shrink-0" />
                    </Link>
                </div>

                <SpatialChapterStack detail={detail} loading={detailLoading} projectId={summary.project.id} />

                <div className="border-t border-border/75 p-5 sm:p-6 lg:border-l lg:border-t-0 lg:p-7">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold">下一步</h2>
                        <Link to={`/projects/${summary.project.id}/overview`} className="text-xs text-foreground/48 hover:text-foreground">查看项目</Link>
                    </div>
                    {detailLoading ? <div className="mt-4 text-xs text-foreground/45">正在整理项目待办...</div> : null}
                    {detailError ? <div className="mt-4 text-xs leading-5 text-foreground/48">项目详情暂时无法读取。可先打开项目概览或自由画布继续工作。</div> : null}
                    {!detailLoading && nextActions.length ? (
                        <div className="mt-3 divide-y divide-border/70">
                            {nextActions.map((action) => <WorkbenchActionLink key={action.id} action={action} />)}
                        </div>
                    ) : null}
                </div>
            </section>

            <section className="grid gap-8 py-7 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-4">
                        <div><h2 className="text-base font-semibold">最近项目</h2><p className="mt-1 text-xs text-foreground/45">按最近更新时间排列</p></div>
                        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">查看全部<ArrowRight className="size-3.5" /></Link>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/80 bg-background/65">
                        {recentProjects.map((project, index) => <RecentProjectRow key={project.project.id} summary={project} divided={index > 0} />)}
                    </div>
                </div>

                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-4">
                        <div><h2 className="text-base font-semibold">最近自由画布</h2><p className="mt-1 text-xs text-foreground/45">不属于项目的自由创作空间</p></div>
                        <Link to="/canvas" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">管理画布<ArrowRight className="size-3.5" /></Link>
                    </div>
                    {recentIndependentCanvases.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                            {recentIndependentCanvases.slice(0, 2).map((project) => <CanvasProjectCard key={project.id} project={project} variant="recent" />)}
                        </div>
                    ) : (
                        <button type="button" className="flex min-h-32 w-full items-center justify-center gap-3 rounded-lg border border-dashed border-border text-sm text-foreground/55 hover:border-foreground/30 hover:text-foreground" onClick={onCreateIndependentCanvas}>
                            <LayoutGrid className="size-4" />打开第一张画布
                        </button>
                    )}
                </div>
            </section>
        </>
    );
}

function FirstProjectWorkspace({ authenticated, canvasHydrated, recentIndependentCanvases, onCreateIndependentCanvas }: {
    authenticated: boolean;
    canvasHydrated: boolean;
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
}) {
    const projectHref = authenticated ? "/projects?create=1" : `/login?next=${encodeURIComponent("/projects?create=1")}`;
    return (
        <>
            <section className="app-first-project-intro border-b border-border/80 pb-8 pt-3 sm:pb-10 sm:pt-6">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-foreground/48"><WorkspaceSignalIcon variant="home" size="sm" />影策</div>
                <h1 className="mt-5 max-w-[780px] text-3xl font-semibold leading-[1.08] sm:text-4xl lg:text-5xl">把一个故事推进到可交付的镜头</h1>
                <p className="mt-5 max-w-[680px] text-sm leading-7 text-foreground/58 sm:text-base">从章节、角色和参考图开始，逐步生成分镜、视频和可复用资产。需要自由探索时，也可以先打开一张自由画布。</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                    <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25" to={projectHref}><FolderKanban className="size-4" />创建项目</Link>
                    <Button size="large" disabled={!canvasHydrated} icon={<LayoutGrid className="size-4" />} onClick={onCreateIndependentCanvas}>打开画布</Button>
                </div>
            </section>

            <section className="border-b border-border/80 py-7">
                <div className="mb-5"><h2 className="text-lg font-semibold">从故事到结果</h2><p className="mt-1 text-xs leading-5 text-foreground/48">每一步都保留输入、版本和生成记录，可以随时返回调整。</p></div>
                <div className="app-workflow-rail grid border-t border-border/75 sm:grid-cols-2 xl:grid-cols-4">
                    {workflow.map((item, index) => (
                        <div key={item.title} className={`app-workflow-step min-w-0 border-b border-border/75 py-4 sm:px-4 xl:border-b-0 xl:border-r ${index % 2 === 0 ? "sm:pl-0" : "sm:border-l"} ${index === workflow.length - 1 ? "xl:border-r-0" : ""}`}>
                            <span className="text-[var(--fs-label)] font-semibold tabular-nums text-[var(--workspace-accent)]">0{index + 1}</span>
                            <h3 className="mt-2 text-sm font-semibold">{item.title}</h3>
                            <p className="mt-1 text-xs leading-5 text-foreground/48">{item.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid gap-8 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.6fr)]">
                <div>
                    <h2 className="text-base font-semibold">两种开始方式</h2>
                    <div className="mt-3 divide-y divide-border/75 border-y border-border/75">
                        <StartMode icon={<Clapperboard className="size-4" />} title="项目" description="适合短剧、故事板和多章节制作。集中管理章节、资产、画布与进度。" action="创建项目" href={projectHref} />
                        <StartMode icon={<Sparkles className="size-4" />} title="自由画布" description="适合快速试图、提示词实验和不需要章节流程的自由创作。" action="打开画布" onClick={onCreateIndependentCanvas} />
                    </div>
                </div>
                <div>
                    <h2 className="text-base font-semibold">创作过程中</h2>
                    <div className="mt-3 space-y-3 text-xs leading-5 text-foreground/52">
                        <FeatureLine icon={<Images className="size-4" />} text="图片、视频和音频结果可以继续生成变体或接入下一步。" />
                        <FeatureLine icon={<Bot className="size-4" />} text="Agent 读取你选择的章节、节点和参考资料，再执行画布操作。" />
                        <FeatureLine icon={<ListChecks className="size-4" />} text="任务、失败原因和用量记录会保留，便于恢复和重试。" />
                    </div>
                </div>
            </section>

            {recentIndependentCanvases.length ? (
                <section className="border-t border-border/80 pt-6">
                    <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">继续自由画布</h2><Link to="/canvas" className="text-xs text-foreground/50 hover:text-foreground">查看全部</Link></div>
                    <div className="grid max-w-[940px] gap-4 sm:grid-cols-2 lg:grid-cols-3">{recentIndependentCanvases.map((project) => <CanvasProjectCard key={project.id} project={project} variant="recent" />)}</div>
                </section>
            ) : null}
        </>
    );
}

function WorkspaceMetric({ icon, label, value, detail, attention = false }: { icon: ReactNode; label: string; value: number; detail: string; attention?: boolean }) {
    return (
        <article className="app-home-metric min-w-0 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
                <span className={attention ? "text-foreground/75" : "text-[var(--workspace-accent)]"}>{icon}</span>
                <span className={`size-1.5 rounded-full ${attention ? "bg-foreground/75" : "bg-[var(--workspace-accent)]"}`} />
            </div>
            <div className="mt-5 text-[var(--fs-label)] text-foreground/45">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 truncate text-[var(--fs-tiny)] text-foreground/38">{detail}</div>
        </article>
    );
}

function SpatialChapterStack({ detail, loading, projectId }: { detail?: Awaited<ReturnType<typeof getProject>>; loading: boolean; projectId: string }) {
    const units = detail?.units.slice().sort((left, right) => left.position - right.position).slice(0, 6) || [];
    const activeUnitId = units.find((unit) => unit.status !== "completed")?.id || units.at(-1)?.id;
    return (
        <div className="spatial-chapter-panel min-w-0 border-t border-border/75 p-5 sm:p-6 lg:border-l lg:border-t-0 lg:p-7">
            <div className="flex items-center justify-between gap-3">
                <div><div className="text-[var(--fs-tiny)] font-medium text-foreground/38">制作层级</div><h2 className="mt-1 text-sm font-semibold">章节轨道</h2></div>
                <span className="text-[var(--fs-tiny)] tabular-nums text-foreground/35">{units.length ? `${units.length} 章` : "待建立"}</span>
            </div>
            <div className="spatial-chapter-deck mt-4" aria-label="项目章节制作层级">
                {loading ? Array.from({ length: 4 }, (_, index) => <span key={index} className="spatial-chapter-card is-loading" style={{ "--deck-x": `${index * 12}px`, "--deck-y": `${index * 28}px`, "--deck-z": `${-index * 18}px`, zIndex: 8 - index } as CSSProperties} />) : null}
                {!loading && units.length ? units.map((unit, index) => (
                    <Link
                        key={unit.id}
                        to={`/projects/${projectId}/chapters/${unit.id}`}
                        className={`spatial-chapter-card ${unit.id === activeUnitId ? "is-active" : ""}`}
                        style={{ "--deck-x": `${index * 12}px`, "--deck-y": `${index * 28}px`, "--deck-z": `${-index * 18}px`, zIndex: 8 - index } as CSSProperties}
                    >
                        <span className="text-[var(--fs-micro)] font-semibold tabular-nums opacity-55">{String(unit.position + 1).padStart(2, "0")}</span>
                        <span className="mt-2 block truncate text-xs font-semibold">{unit.title}</span>
                        <span className="mt-1 block text-[var(--fs-micro)] opacity-50">{unit.status === "completed" ? "已完成" : unit.id === activeUnitId ? "当前制作" : "等待推进"}</span>
                    </Link>
                )) : null}
                {!loading && !units.length ? <div className="grid min-h-52 place-items-center text-center text-xs leading-5 text-foreground/42">创建剧情章节后<br />这里会形成制作层级</div> : null}
            </div>
        </div>
    );
}

function WorkbenchActionLink({ action }: { action: ReturnType<typeof projectNextActions>[number] }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return (
        <Link to={action.href} className="group grid grid-cols-[20px_minmax(0,1fr)_auto] gap-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20">
            <Icon className={`mt-0.5 size-4 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/35"}`} />
            <span className="min-w-0"><span className="block text-xs font-medium">{action.title}</span><span className="mt-1 line-clamp-2 block text-[var(--fs-label)] leading-4 text-foreground/45">{action.description}</span></span>
            <span className="self-center text-[var(--fs-label)] font-medium text-foreground/45 transition-colors group-hover:text-foreground">{action.actionLabel}</span>
        </Link>
    );
}

function RecentProjectRow({ summary, divided }: { summary: ProjectSummary; divided: boolean }) {
    const completion = projectSummaryCompletion(summary);
    return (
        <Link to={`/projects/${summary.project.id}/overview`} className={`group grid min-h-[68px] grid-cols-[minmax(0,1fr)_80px_20px] items-center gap-3 px-3 py-2.5 hover:bg-foreground/[.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 sm:grid-cols-[minmax(0,1fr)_100px_120px_20px] ${divided ? "border-t border-border/65" : ""}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{summary.project.name}</span><span className="mt-1 block truncate text-[var(--fs-label)] text-foreground/42">{summary.unitCount} 章 · {summary.canvasCount} 张项目画布 · {summary.assetCount} 项资产</span></span>
            <span className="hidden text-[var(--fs-label)] text-foreground/45 sm:block">更新于<br />{formatRelativeTime(summary.project.updatedAt)}</span>
            <span className="min-w-0"><span className="flex items-center justify-between text-[var(--fs-tiny)] text-foreground/42"><span>章节</span><span>{completion}%</span></span><span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/[.08]"><span className="block h-full rounded-full bg-foreground/65" style={{ width: `${completion}%` }} /></span></span>
            <ArrowRight className="size-4 text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/60" />
        </Link>
    );
}

function StartMode({ icon, title, description, action, href, onClick }: { icon: ReactNode; title: string; description: string; action: string; href?: string; onClick?: () => void }) {
    const content = <><span className="mt-0.5 text-foreground/45">{icon}</span><span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-foreground/48">{description}</span></span><span className="self-center text-xs font-medium text-foreground/50">{action} →</span></>;
    const className = "grid grid-cols-[20px_minmax(0,1fr)_auto] gap-3 py-4 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";
    return href ? <Link to={href} className={className}>{content}</Link> : <button type="button" className={className} onClick={onClick}>{content}</button>;
}

function FeatureLine({ icon, text }: { icon: ReactNode; text: string }) {
    return <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5"><span className="text-foreground/35">{icon}</span><p>{text}</p></div>;
}

function formatRelativeTime(value: string) {
    const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
    const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
    if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) return formatter.format(diffDays, "day");
    return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
