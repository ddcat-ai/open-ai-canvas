import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { ArrowRight, Bot, Clapperboard, FolderKanban, Images, LayoutGrid, ListChecks, Plus, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { formatLocale } from "@/lib/format-locale";
import { projectDetailStage, projectSummaryCompletion } from "@/lib/project-workbench";
import { getProject, listProjects, type ProjectSummary } from "@/services/api/projects";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useLocaleStore } from "@/stores/use-locale-store";
import { useUserStore } from "@/stores/use-user-store";

export default function IndexPage() {
    const { t } = useTranslation(["home", "canvas"]);
    const { message } = App.useApp();
    const navigate = useNavigate();
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const user = useUserStore((state) => state.user);
    const userHydrated = useUserStore((state) => state.hydrated);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const domainProjectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => listProjects(), enabled: Boolean(user && shortDramaEnabled) });
    const domainProjects = [...(domainProjectsQuery.data?.projects || [])].sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt));
    const activeProject = domainProjects.find(({ project }) => project.status !== "archived") || domainProjects[0];
    const activeProjectQuery = useQuery({
        queryKey: ["project", activeProject?.project.id],
        queryFn: () => getProject(activeProject!.project.id),
        enabled: Boolean(user && shortDramaEnabled && activeProject?.project.id),
    });
    const recentIndependentCanvases = canvasProjects.filter((project) => !project.projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3);
    const workflow = [
        { title: t("home:organize-the-story"), description: t("home:import-a-novel-paste-text-or-create-chapters") },
        { title: t("home:confirm-the-setup"), description: t("home:organize-characters-scenes-styles-and-references") },
        { title: t("home:produce-shots"), description: t("home:generate-storyboard-frames-images-and-video-candidates") },
        { title: t("home:review-results"), description: t("home:compare-versions-handle-failures-and-prepare-exports") },
    ];

    const createIndependentCanvas = () => {
        if (!canvasHydrated) return;
        if (!user) {
            navigate(`/login?next=${encodeURIComponent("/canvas?mode=new")}`);
            return;
        }
        void createCanvasProjectWithRemoteSync(t("canvas:standalone-canvas-n", { n: canvasProjects.length + 1 })).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? t("home:canvas-created-locally-cloud-sync-failed-param", { message: syncError.message }) : t("home:canvas-created-locally-cloud-sync-failed"));
            navigate(`/canvas/${id}`);
        });
    };

    const loadingUserWorkspace = !userHydrated || (Boolean(user && shortDramaEnabled) && domainProjectsQuery.isLoading);
    return (
        <main className="app-user-content app-workspace-canvas app-workspace-scroll h-full overflow-y-auto text-foreground">
            <div className="app-home-workbench w-full px-4 pb-12 pt-5 sm:px-6 lg:px-8">
                {loadingUserWorkspace ? (
                    <WorkspaceLoadingState className="mt-3" label={t("home:restoring-workspace")} detail={t("home:loading-projects-chapters-and-recent-canvases")} rows={5} />
                ) : user && shortDramaEnabled && domainProjectsQuery.isError ? (
                    <WorkspaceErrorState
                        title={t("home:failed-to-load-project-workspace")}
                        description={domainProjectsQuery.error instanceof Error ? domainProjectsQuery.error.message : t("home:the-project-list-is-temporarily-unavailable")}
                        onRetry={() => void domainProjectsQuery.refetch()}
                    />
                ) : shortDramaEnabled && activeProject ? (
                    <ReturningWorkspace workflow={workflow} summary={activeProject} detail={activeProjectQuery.data} recentProjects={domainProjects.slice(0, 5)} recentIndependentCanvases={recentIndependentCanvases} onCreateIndependentCanvas={createIndependentCanvas} />
                ) : (
                    <FirstProjectWorkspace workflow={workflow} authenticated={Boolean(user)} canvasHydrated={canvasHydrated} recentIndependentCanvases={recentIndependentCanvases} onCreateIndependentCanvas={createIndependentCanvas} shortDramaEnabled={shortDramaEnabled} />
                )}
            </div>
        </main>
    );
}

function ReturningWorkspace({
    workflow,
    summary,
    detail,
    recentProjects,
    recentIndependentCanvases,
    onCreateIndependentCanvas,
}: {
    workflow: Array<{ title: string; description: string }>;
    summary: ProjectSummary;
    detail?: Awaited<ReturnType<typeof getProject>>;
    recentProjects: ProjectSummary[];
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
}) {
    const { t } = useTranslation("canvas");
    const stage = detail ? projectDetailStage(detail) : { label: t("home:in-progress"), detail: t("home:loading-project-progress") };
    const completion = projectSummaryCompletion(summary);
    return (
        <>
            <div className="studio-band">
                <header className="app-page-header flex min-h-14 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="min-w-0">
                            <h1 className="text-[var(--fs-title)] font-semibold leading-7">{t("home:continue-creating")}</h1>
                            <p className="mt-1 text-xs leading-5 text-foreground/55">{t("home:return-to-recent-work-or-clear-whatever-is-blocking-production-first")}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button icon={<LayoutGrid className="size-3.5" />} onClick={onCreateIndependentCanvas}>
                            {t("home:open-canvas-3")}
                        </Button>
                        <Link
                            className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                            to="/projects?create=1"
                        >
                            <Plus className="size-3.5" />
                            {t("home:create-project-3")}
                        </Link>
                    </div>
                </header>
            </div>

            <section className="app-home-quick-create grid gap-3 py-6 sm:grid-cols-3" aria-label={t("home:quick-create")}>
                <QuickCreateCard icon={<FolderKanban className="size-5" />} title={t("home:create-short-drama-project")} description={t("home:start-a-chapter-pipeline-from-blank-a-novel-or-raw-text")} action={t("home:create")} href="/projects?create=1" />
                <QuickCreateCard
                    icon={<LayoutGrid className="size-5" />}
                    title={t("home:open-standalone-canvas")}
                    description={t("home:good-for-quick-drafts-prompt-experiments-and-free-form-creation")}
                    action={t("home:open")}
                    onClick={onCreateIndependentCanvas}
                />
                <QuickCreateCard icon={<Images className="size-5" />} title={t("home:open-asset-library")} description={t("home:organize-characters-scenes-styles-and-media-assets")} action={t("home:enter")} href="/assets" />
            </section>

            <section className="grid gap-8 py-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold">{t("home:recent-projects")}</h2>
                            <p className="mt-1 text-xs text-foreground/45">{t("home:sorted-by-last-update")}</p>
                        </div>
                        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">
                            {t("home:view-all-2")}
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                    <div className="app-home-timeline overflow-hidden rounded-lg border border-border/80 bg-background/65">
                        {recentProjects.map((project, index) => (
                            <RecentProjectRow key={project.project.id} summary={project} divided={index > 0} />
                        ))}
                    </div>
                </div>

                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold">{t("home:recent-standalone-canvases")}</h2>
                            <p className="mt-1 text-xs text-foreground/45">{t("home:free-form-space-outside-any-project")}</p>
                        </div>
                        <Link to="/canvas" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">
                            {t("home:manage-canvases")}
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                    {recentIndependentCanvases.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                            {recentIndependentCanvases.slice(0, 2).map((project) => (
                                <CanvasProjectCard key={project.id} project={project} variant="recent" />
                            ))}
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="flex min-h-32 w-full items-center justify-center gap-3 rounded-lg border border-dashed border-border text-sm text-foreground/55 hover:border-foreground/30 hover:text-foreground"
                            onClick={onCreateIndependentCanvas}
                        >
                            <LayoutGrid className="size-4" />
                            {t("home:open-your-first-canvas")}
                        </button>
                    )}
                </div>
            </section>

            <section className="app-home-template-rail border-t border-border/80 py-7" aria-label={t("home:workflow-entry")}>
                <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                        <h2 className="text-base font-semibold">{t("home:start-from-the-workflow")}</h2>
                        <p className="mt-1 text-xs leading-5 text-foreground/48">{t("home:organize-story-confirm-setup-produce-shots-review-results")}</p>
                    </div>
                    <span className="hidden text-[var(--fs-label)] text-foreground/38 sm:block">
                        {stage.label} · {completion}%
                    </span>
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

function FirstProjectWorkspace({
    workflow,
    authenticated,
    canvasHydrated,
    recentIndependentCanvases,
    onCreateIndependentCanvas,
    shortDramaEnabled,
}: {
    workflow: Array<{ title: string; description: string }>;
    authenticated: boolean;
    canvasHydrated: boolean;
    recentIndependentCanvases: ReturnType<typeof useCanvasStore.getState>["projects"];
    onCreateIndependentCanvas: () => void;
    shortDramaEnabled: boolean;
}) {
    const { t } = useTranslation("canvas");
    const projectHref = authenticated ? "/projects?create=1" : `/login?next=${encodeURIComponent("/projects?create=1")}`;
    return (
        <>
            <section className="app-first-project-intro border-b border-border/80 pb-8 pt-3 sm:pb-10 sm:pt-6">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-foreground/48">
                    <WorkspaceSignalIcon variant="home" size="sm" />
                    {t("home:yingce")}
                </div>
                <h1 className="mt-5 max-w-[780px] text-3xl font-semibold leading-[1.08] sm:text-4xl lg:text-5xl">{t("home:take-a-story-to-deliverable-shots")}</h1>
                <p className="mt-5 max-w-[680px] text-sm leading-7 text-foreground/58 sm:text-base">{t("home:start-from-chapters-characters-and-references-then-generate-storyboards")}</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                    {shortDramaEnabled ? (
                        <Link
                            className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                            to={projectHref}
                        >
                            <FolderKanban className="size-4" />
                            {t("home:create-project-3")}
                        </Link>
                    ) : null}
                    <Button size="large" disabled={!canvasHydrated} icon={<LayoutGrid className="size-4" />} onClick={onCreateIndependentCanvas}>
                        {t("home:open-canvas-3")}
                    </Button>
                </div>
            </section>

            <section className="border-b border-border/80 py-7">
                <div className="mb-5">
                    <h2 className="text-lg font-semibold">{t("home:from-story-to-result")}</h2>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">{t("home:every-step-keeps-inputs-versions-and-generation-records-so-you-can-go-ba")}</p>
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

            <section className="grid gap-8 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.6fr)]">
                <div>
                    <h2 className="text-base font-semibold">{t("home:two-ways-to-start")}</h2>
                    <div className="mt-3 divide-y divide-border/75 border-y border-border/75">
                        {shortDramaEnabled ? (
                            <StartMode
                                icon={<Clapperboard className="size-4" />}
                                title={t("home:projects")}
                                description={t("home:for-short-dramas-storyboards-and-multi-chapter-production-chapters-asset")}
                                action={t("home:create-project-3")}
                                href={projectHref}
                            />
                        ) : null}
                        <StartMode
                            icon={<Sparkles className="size-4" />}
                            title={t("home:standalone-canvases")}
                            description={t("home:for-quick-drafts-prompt-experiments-and-free-creation-without-chapter-pi")}
                            action={t("home:open-canvas-3")}
                            onClick={onCreateIndependentCanvas}
                        />
                    </div>
                </div>
                <div>
                    <h2 className="text-base font-semibold">{t("home:during-creation")}</h2>
                    <div className="mt-3 space-y-3 text-xs leading-5 text-foreground/52">
                        <FeatureLine icon={<Images className="size-4" />} text={t("home:image-video-and-audio-results-can-spawn-variants-or-feed-the-next-step")} />
                        <FeatureLine icon={<Bot className="size-4" />} text={t("home:the-agent-reads-your-chosen-chapters-nodes-and-references-then-executes")} />
                        <FeatureLine icon={<ListChecks className="size-4" />} text={t("home:tasks-failure-reasons-and-usage-records-are-kept-for-recovery-and-retrie")} />
                    </div>
                </div>
            </section>

            {recentIndependentCanvases.length ? (
                <section className="border-t border-border/80 pt-6">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-base font-semibold">{t("home:continue-standalone-canvas")}</h2>
                        <Link to="/canvas" className="text-xs text-foreground/50 hover:text-foreground">
                            {t("home:view-all-2")}
                        </Link>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {recentIndependentCanvases.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} variant="recent" />
                        ))}
                    </div>
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
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground/55 transition-colors group-hover:text-foreground">
                {action}
                <ArrowRight className="size-3.5" />
            </span>
        </>
    );
    const className =
        "app-home-quick-create-card group flex min-h-[148px] flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--card-elevation-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return href ? (
        <Link to={href} className={className}>
            {content}
        </Link>
    ) : (
        <button type="button" className={className} onClick={onClick}>
            {content}
        </button>
    );
}

function RecentProjectRow({ summary, divided }: { summary: ProjectSummary; divided: boolean }) {
    const { t } = useTranslation("canvas");
    const completion = projectSummaryCompletion(summary);
    return (
        <Link
            to={`/projects/${summary.project.id}/overview`}
            className={`group grid min-h-[68px] grid-cols-[minmax(0,1fr)_80px_20px] items-center gap-3 px-3 py-2.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 sm:grid-cols-[minmax(0,1fr)_100px_120px_20px] ${divided ? "border-t border-border/65" : ""}`}
        >
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{summary.project.name}</span>
                <span className="mt-1 block truncate text-[var(--fs-label)] text-foreground/42">
                    {summary.unitCount} {t("home:chapters")} {summary.canvasCount} {t("home:project-canvases")} {summary.assetCount} {t("home:assets")}
                </span>
            </span>
            <span className="hidden text-[var(--fs-label)] text-foreground/45 sm:block">
                {t("home:updated")}
                <br />
                {formatRelativeTime(summary.project.updatedAt)}
            </span>
            <span className="min-w-0">
                <span className="flex items-center justify-between text-[var(--fs-tiny)] text-foreground/42">
                    <span>{t("home:chapters-2")}</span>
                    <span>{completion}%</span>
                </span>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-active">
                    <span className="block h-full rounded-full bg-foreground/65" style={{ width: `${completion}%` }} />
                </span>
            </span>
            <ArrowRight className="size-4 text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/60" />
        </Link>
    );
}

function StartMode({ icon, title, description, action, href, onClick }: { icon: ReactNode; title: string; description: string; action: string; href?: string; onClick?: () => void }) {
    const content = (
        <>
            <span className="mt-0.5 text-foreground/45">{icon}</span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-foreground/48">{description}</span>
            </span>
            <span className="self-center text-xs font-medium text-foreground/50">{action} →</span>
        </>
    );
    const className = "grid grid-cols-[20px_minmax(0,1fr)_auto] gap-3 py-4 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";
    return href ? (
        <Link to={href} className={className}>
            {content}
        </Link>
    ) : (
        <button type="button" className={className} onClick={onClick}>
            {content}
        </button>
    );
}

function FeatureLine({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5">
            <span className="text-foreground/35">{icon}</span>
            <p>{text}</p>
        </div>
    );
}

function formatRelativeTime(value: string) {
    const locale = formatLocale(useLocaleStore.getState().locale);
    const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) return formatter.format(diffDays, "day");
    return new Date(value).toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
}
