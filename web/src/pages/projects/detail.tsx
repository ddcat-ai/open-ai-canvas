import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Tooltip } from "antd";
import { ArrowLeft, BookOpenText, Images, LayoutDashboard, LayoutGrid, Plus, Settings2, type LucideIcon } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { getProject, linkCanvasUnit } from "@/services/api/projects";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { upsertProjectChapterStoryboard } from "@/lib/canvas/project-chapter-storyboard";

import ProjectAssetsView from "./detail/assets";
import ProjectCanvasesView from "./detail/canvases";
import ProjectChaptersView from "./detail/chapters";
import ProjectOverviewView from "./detail/overview";
import ProjectSettingsView from "./detail/settings";
import { useTranslation } from "react-i18next";

type DetailView = "overview" | "chapters" | "canvases" | "assets" | "settings";

export default function ProjectDetailPage() {
    const { t } = useTranslation("project");
    const views: Array<{ key: DetailView; label: string; shortLabel: string; icon: LucideIcon }> = [
        { key: "overview", label: t("project:production-overview"), shortLabel: t("project:overview"), icon: LayoutDashboard },
        { key: "chapters", label: t("project:story-chapters"), shortLabel: t("project:chapters-2"), icon: BookOpenText },
        { key: "canvases", label: t("project:project-canvases"), shortLabel: t("project:canvas-2"), icon: LayoutGrid },
        { key: "assets", label: t("project:characters-and-assets-2"), shortLabel: t("project:assets"), icon: Images },
        { key: "settings", label: t("project:project-settings-2"), shortLabel: t("project:settings"), icon: Settings2 },
    ];
    const { projectId = "", view, chapterId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const activeView: DetailView = chapterId ? "chapters" : views.some((item) => item.key === view) ? (view as DetailView) : "overview";
    const detail = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject(projectId), enabled: Boolean(projectId), refetchOnMount: "always" });
    const refreshProject = () => {
        void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
    };
    const createCanvas = () => {
        if (detail.data?.project.status === "archived") {
            message.warning(t("project:project-is-archived-restore-it-in-project-settings-first"));
            return;
        }
        const activeChapterId = chapterId || sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
        const unit = activeView === "chapters" ? detail.data?.units.find((item) => item.id === activeChapterId) || detail.data?.units.slice().sort((left, right) => left.position - right.position)[0] : undefined;
        const shots = unit ? detail.data?.shots.filter((shot) => shot.unitId === unit.id) || [] : [];
        const seed = unit && shots.length ? upsertProjectChapterStoryboard([], [], { unit, shots }) : undefined;
        const initialContent = seed ? { nodes: seed.nodes, connections: seed.connections } : undefined;
        const title = unit ? `${unit.title} · ${shots.length ? t("project:storyboard-canvases") : t("project:canvas-2")}` : t("project:new-canvas-for-project", { name: detail.data?.project.name || t("project:project") });
        void createCanvasProjectWithRemoteSync(title, projectId, initialContent)
            .then(async ({ id, syncError }) => {
                if (syncError) {
                    message.warning(syncError instanceof Error ? t("project:canvas-saved-locally-project-linking-will-retry-later-param", { message: syncError.message }) : t("project:canvas-saved-locally-project-linking-will-retry-later"));
                    navigate(`/canvas/${id}`);
                    return;
                }
                if (unit) {
                    try {
                        await linkCanvasUnit(projectId, { canvasId: id, unitId: unit.id, role: "storyboard" });
                    } catch (error) {
                        refreshProject();
                        message.error(error instanceof Error ? t("project:canvas-created-but-chapter-linking-failed-param", { message: error.message }) : t("project:canvas-created-but-chapter-linking-failed"));
                        return;
                    }
                }
                refreshProject();
                message.success(unit && shots.length ? t("project:chapter-canvas-created-with-param-storyboard-shots-imported", { length: shots.length }) : unit ? t("project:chapter-canvas-created-and-linked") : t("project:project-canvas-created"));
                navigate(`/canvas/${id}`);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("project:failed-to-create-canvas")));
    };

    if (detail.isLoading)
        return (
            <WorkspacePage>
                <WorkspaceLoadingState label={t("project:opening-project-workspace")} detail={t("project:loading-chapters-canvases-assets-and-current-progress")} />
            </WorkspacePage>
        );
    if (detail.isError || !detail.data)
        return (
            <WorkspacePage>
                <WorkspaceErrorState
                    title={t("project:project-unavailable")}
                    description={t("project:the-project-does-not-exist-was-deleted-or-your-account-has-no-access")}
                    actionLabel={t("project:back-to-projects")}
                    onRetry={() => navigate("/projects")}
                />
            </WorkspacePage>
        );
    if (!chapterId && (!view || !views.some((item) => item.key === view))) return <Navigate to={`/projects/${projectId}/overview`} replace />;
    const chapterHref = projectChapterHref(detail.data.units, projectId, chapterId);
    return (
        <WorkspacePage className="project-workbench-page !overflow-hidden" fluid>
            <div className="flex h-full min-h-0 flex-col">
                <header className="project-workbench-header shrink-0 bg-workspace-glass px-3 py-2 backdrop-blur-md sm:px-4 lg:px-5 lg:py-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 lg:min-h-16 lg:flex-nowrap">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:w-[250px] lg:flex-none xl:w-[290px]">
                            <button
                                type="button"
                                onClick={() => navigate("/projects")}
                                className="grid size-9 shrink-0 place-items-center rounded-md text-foreground/42 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={t("project:back-to-project")}
                                title={t("project:back-to-project")}
                            >
                                <ArrowLeft className="size-4" />
                            </button>
                            <div className="flex min-w-0 items-center gap-2">
                                <h1 className="min-w-0 truncate text-[var(--fs-body)] font-semibold text-foreground/90">{detail.data.project.name}</h1>
                                <span className={`size-1.5 shrink-0 rounded-full ${detail.data.project.status === "archived" ? "bg-foreground/30" : "bg-[var(--workspace-accent)]"}`} />
                                <span className="hidden shrink-0 text-[var(--fs-tiny)] text-foreground/42 sm:inline">{detail.data.project.status === "archived" ? t("project:archived-2") : t("project:in-progress")}</span>
                            </div>
                        </div>
                        <nav className="thin-scrollbar order-last mt-1 flex h-11 w-full min-w-0 items-center gap-0.5 overflow-x-auto lg:order-none lg:mt-0 lg:h-16 lg:flex-1 lg:pl-3" aria-label={t("project:project-navigation")}>
                            {views.map((item) => {
                                const Icon = item.icon;
                                const active = item.key === activeView;
                                const href = item.key === "chapters" ? chapterHref : `/projects/${projectId}/${item.key}`;
                                return (
                                    <Link
                                        key={item.key}
                                        to={href}
                                        className={`relative flex h-11 shrink-0 items-center gap-2 rounded-md px-2.5 text-[var(--fs-body)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 ${active ? "bg-[var(--workspace-accent-soft)] font-medium text-foreground lg:after:absolute lg:after:inset-x-3 lg:after:bottom-0 lg:after:h-0.5 lg:after:rounded-full lg:after:bg-[var(--workspace-accent)]" : "text-foreground/52 hover:bg-surface-hover hover:text-foreground"}`}
                                        aria-current={active ? "page" : undefined}
                                    >
                                        <Icon className={`size-4 shrink-0 ${active ? "text-[var(--workspace-accent)]" : "text-foreground/45"}`} />
                                        <span className="sm:hidden">{item.shortLabel}</span>
                                        <span className="hidden sm:inline">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                        <Tooltip title={activeView === "chapters" && detail.data.units.length ? t("project:new-canvas-for-current-chapter") : t("project:new-project-canvas")}>
                            <Button
                                size="small"
                                className="!h-9 !shrink-0 !px-2 sm:!px-3"
                                icon={<Plus className="size-4" />}
                                onClick={createCanvas}
                                aria-label={activeView === "chapters" && detail.data.units.length ? t("project:new-canvas-for-current-chapter") : t("project:new-project-canvas")}
                            >
                                <span className="hidden sm:inline">{t("project:new-canvas")}</span>
                            </Button>
                        </Tooltip>
                    </div>
                </header>
                {detail.data.project.status === "archived" ? <Alert type="warning" showIcon banner message={t("project:project-is-archived-restore-it-to-create-canvases-and-generation-tasks")} className="!border-x-0 !border-t-0" /> : null}
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div className={activeView === "chapters" ? "min-h-0 flex-1" : "thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-8 lg:py-7"}>
                        <div className={activeView === "overview" ? "w-full" : activeView === "chapters" ? "h-full w-full" : "w-full"}>
                            {activeView === "overview" ? <ProjectOverviewView detail={detail.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                            {activeView === "chapters" ? <ProjectChaptersView detail={detail.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                            {activeView === "canvases" ? <ProjectCanvasesView detail={detail.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                            {activeView === "assets" ? <ProjectAssetsView detail={detail.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                            {activeView === "settings" ? <ProjectSettingsView detail={detail.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                        </div>
                    </div>
                </main>
            </div>
        </WorkspacePage>
    );
}

function projectChapterHref(units: Array<{ id: string; position: number }>, projectId: string, routeChapterId?: string) {
    const rememberedId = sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
    const targetId = [routeChapterId, rememberedId].find((id) => id && units.some((unit) => unit.id === id)) || units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    return targetId ? `/projects/${projectId}/chapters/${targetId}` : `/projects/${projectId}/chapters`;
}
