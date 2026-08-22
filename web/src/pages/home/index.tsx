import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { ArrowRight, Bot, Clapperboard, FolderKanban, Images, LayoutGrid, ListChecks, Plus, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { projectDetailStage, projectSummaryCompletion } from "@/lib/project-workbench";
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
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const domainProjectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => listProjects(), enabled: Boolean(user && shortDramaEnabled) });
    const domainProjects = useMemo(
        () => [...(domainProjectsQuery.data?.projects || [])].sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt)),
        [domainProjectsQuery.data],
    );
    const activeProject = domainProjects.find(({ project }) => project.status !== "archived") || domainProjects[0];
    const activeProjectQuery = useQuery({
        queryKey: ["project", activeProject?.project.id],
        queryFn: () => getProject(activeProject!.project.id),
        enabled: Boolean(user && shortDramaEnabled && activeProject?.project.id),
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

    const loadingUserWorkspace = !userHydrated || (Boolean(user && shortDramaEnabled) && domainProjectsQuery.isLoading);
    return (
        <main className="app-user-content app-workspace-canvas app-workspace-scroll h-full overflow-y-auto text-foreground">
            <div className="app-home-workbench w-full px-4 pb-12 pt-5 sm:px-6 lg:px-8">
                {loadingUserWorkspace ? (
                    <WorkspaceLoadingState className="mt-3" label="正在恢复工作台" detail="读取项目、章节和最近画布" rows={5} />
                ) : user && shortDramaEnabled && domainProjectsQuery.isError ? (
                    <WorkspaceErrorState title="项目工作台加载失败" description={domainProjectsQuery.error instanceof Error ? domainProjectsQuery.error.message : "暂时无法读取项目列表。"} onRetry={() => void domainProjectsQuery.refetch()} />
                ) : shortDramaEnabled && activeProject ? (
                    <ReturningWorkspace
                        summary={activeProject}
                        detail={activeProjectQuery.data}
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
                        shortDramaEnabled={shortDramaEnabled}
                    />
                )}
            </div>
        </main>
    );
}

function ReturningWorkspace({ summary, detail, recentProjects, recentIndependentCanvases, onCreateIndependentCanvas }: {
    summary: ProjectSummary;
    detail?: Awaited<ReturnType<typeof getProject>>;
    recentProjects: ProjectSummary[];
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
}) {
    const stage = detail ? projectDetailStage(detail) : { label: "进行中", detail: "读取项目进度" };
    const completion = projectSummaryCompletion(summary);
    return (
        <>
            <div className="studio-band">
                <header className="app-page-header flex min-h-14 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
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
            </div>

            <section className="app-home-quick-create grid gap-3 py-6 sm:grid-cols-3" aria-label="快捷创建">
                <QuickCreateCard icon={<FolderKanban className="size-5" />} title="创建短剧项目" description="从空白、小说或文本开始建立章节流程。" action="创建" href="/projects?create=1" />
                <QuickCreateCard icon={<LayoutGrid className="size-5" />} title="打开自由画布" description="适合快速试图、提示词实验和自由创作。" action="打开" onClick={onCreateIndependentCanvas} />
                <QuickCreateCard icon={<Images className="size-5" />} title="进入素材库" description="整理角色、场景、画风和媒体资产。" action="进入" href="/assets" />
            </section>

            <section className="grid gap-8 py-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-4">
                        <div><h2 className="text-base font-semibold">最近项目</h2><p className="mt-1 text-xs text-foreground/45">按最近更新时间排列</p></div>
                        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">查看全部<ArrowRight className="size-3.5" /></Link>
                    </div>
                    <div className="app-home-timeline overflow-hidden rounded-lg border border-border/80 bg-background/65">
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

            <section className="app-home-template-rail border-t border-border/80 py-7" aria-label="工作流入口">
                <div className="mb-4 flex items-end justify-between gap-4">
                    <div><h2 className="text-base font-semibold">从工作流开始</h2><p className="mt-1 text-xs leading-5 text-foreground/48">整理故事 → 确认设定 → 制作镜头 → 检查结果。</p></div>
                    <span className="hidden text-[var(--fs-label)] text-foreground/38 sm:block">{stage.label} · {completion}%</span>
                </div>
                <div className="app-workflow-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {workflow.map((item, index) => (
                        <div key={item.title} className="app-workflow-card relative min-w-0 p-4">
                            <div className="flex items-center justify-between">
                                <span className="grid size-6 place-items-center rounded-md bg-foreground/[.06] text-[var(--fs-label)] font-semibold tabular-nums text-[var(--workspace-accent)]">0{index + 1}</span>
                                {index < workflow.length - 1 ? <ArrowRight className="size-3.5 text-foreground/25" aria-hidden="true" /> : null}
                            </div>
                            <h3 className="mt-2 text-sm font-semibold">{item.title}</h3>
                            <p className="mt-1 text-xs leading-5 text-foreground/48">{item.description}</p>
                        </div>
                    ))}
                </div>
            </section>
        </>
    );
}

function FirstProjectWorkspace({ authenticated, canvasHydrated, recentIndependentCanvases, onCreateIndependentCanvas, shortDramaEnabled }: {
    authenticated: boolean;
    canvasHydrated: boolean;
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
    shortDramaEnabled: boolean;
}) {
    const projectHref = authenticated ? "/projects?create=1" : `/login?next=${encodeURIComponent("/projects?create=1")}`;
    return (
        <>
            <section className="app-first-project-intro border-b border-border/80 pb-8 pt-3 sm:pb-10 sm:pt-6">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-foreground/48"><WorkspaceSignalIcon variant="home" size="sm" />影策</div>
                <h1 className="mt-5 max-w-[780px] text-3xl font-semibold leading-[1.08] sm:text-4xl lg:text-5xl">把一个故事推进到可交付的镜头</h1>
                <p className="mt-5 max-w-[680px] text-sm leading-7 text-foreground/58 sm:text-base">从章节、角色和参考图开始，逐步生成分镜、视频和可复用资产。需要自由探索时，也可以先打开一张自由画布。</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                    {shortDramaEnabled ? <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25" to={projectHref}><FolderKanban className="size-4" />创建项目</Link> : null}
                    <Button size="large" disabled={!canvasHydrated} icon={<LayoutGrid className="size-4" />} onClick={onCreateIndependentCanvas}>打开画布</Button>
                </div>
            </section>

            <section className="border-b border-border/80 py-7">
                <div className="mb-5"><h2 className="text-lg font-semibold">从故事到结果</h2><p className="mt-1 text-xs leading-5 text-foreground/48">每一步都保留输入、版本和生成记录，可以随时返回调整。</p></div>
                <div className="app-workflow-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {workflow.map((item, index) => (
                        <div key={item.title} className="app-workflow-card relative min-w-0 p-4">
                            <div className="flex items-center justify-between">
                                <span className="grid size-6 place-items-center rounded-md bg-foreground/[.06] text-[var(--fs-label)] font-semibold tabular-nums text-[var(--workspace-accent)]">0{index + 1}</span>
                                {index < workflow.length - 1 ? <ArrowRight className="size-3.5 text-foreground/25" aria-hidden="true" /> : null}
                            </div>
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
                        {shortDramaEnabled ? <StartMode icon={<Clapperboard className="size-4" />} title="项目" description="适合短剧、故事板和多章节制作。集中管理章节、资产、画布与进度。" action="创建项目" href={projectHref} /> : null}
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recentIndependentCanvases.map((project) => <CanvasProjectCard key={project.id} project={project} variant="recent" />)}</div>
                </section>
            ) : null}
        </>
    );
}

function QuickCreateCard({ icon, title, description, action, href, onClick }: { icon: ReactNode; title: string; description: string; action: string; href?: string; onClick?: () => void }) {
    const content = (
        <>
            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border/70 bg-foreground/[.04] text-[var(--workspace-accent)]">{icon}</span>
            <span className="mt-4 block text-sm font-semibold">{title}</span>
            <span className="mt-1 block text-xs leading-5 text-foreground/48">{description}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground/55 transition-colors group-hover:text-foreground">{action}<ArrowRight className="size-3.5" /></span>
        </>
    );
    const className = "app-home-quick-create-card group flex min-h-[148px] flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--card-elevation-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return href ? <Link to={href} className={className}>{content}</Link> : <button type="button" className={className} onClick={onClick}>{content}</button>;
}

function RecentProjectRow({ summary, divided }: { summary: ProjectSummary; divided: boolean }) {
    const completion = projectSummaryCompletion(summary);
    return (
        <Link to={`/projects/${summary.project.id}/overview`} className={`group grid min-h-[68px] grid-cols-[minmax(0,1fr)_80px_20px] items-center gap-3 px-3 py-2.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 sm:grid-cols-[minmax(0,1fr)_100px_120px_20px] ${divided ? "border-t border-border/65" : ""}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{summary.project.name}</span><span className="mt-1 block truncate text-[var(--fs-label)] text-foreground/42">{summary.unitCount} 章 · {summary.canvasCount} 张项目画布 · {summary.assetCount} 项资产</span></span>
            <span className="hidden text-[var(--fs-label)] text-foreground/45 sm:block">更新于<br />{formatRelativeTime(summary.project.updatedAt)}</span>
            <span className="min-w-0"><span className="flex items-center justify-between text-[var(--fs-tiny)] text-foreground/42"><span>章节</span><span>{completion}%</span></span><span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-active"><span className="block h-full rounded-full bg-foreground/65" style={{ width: `${completion}%` }} /></span></span>
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
