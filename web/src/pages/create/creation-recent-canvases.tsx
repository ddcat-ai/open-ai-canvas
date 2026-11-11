import { useTranslation } from "react-i18next";
import { useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, LoaderCircle, PanelsTopLeft, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { getActiveUserScope } from "@/lib/user-scope";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { canvasDraftNavigationState, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { trackSiteTrafficAction } from "@/services/site-traffic";

const RECENT_COUNT = 4;

export function CreationRecentCanvases({ onRequireLogin }: { onRequireLogin: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const recentQuery = useQuery({
        queryKey: ["canvas-library", userId, "recent"],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "updated", signal }),
        enabled: Boolean(userId) && sessionHydrated,
    });
    const recentProjects = useMemo<CanvasLibrarySummary[]>(
        () =>
            userId
                ? recentQuery.data?.projects || []
                : [...localProjects]
                      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
                      .slice(0, RECENT_COUNT)
                      .map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: project.nodes.slice(0, 4) })),
        [localProjects, recentQuery.data, userId],
    );
    const loading = !sessionHydrated || !canvasHydrated || Boolean(userId && recentQuery.isPending);
    const preload = () => {
        void loadCanvasProjectPage();
    };
    const createCanvas = async () => {
        if (!userId) {
            onRequireLogin();
            return;
        }
        if (!canvasHydrated || creatingRef.current) return;
        trackSiteTrafficAction("new_canvas");
        const scope = getActiveUserScope();
        creatingRef.current = true;
        setCreating(true);
        try {
            const id = useCanvasStore.getState().createDraftProject(t("create.recent.untitledCanvas"));
            if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) return;
            navigate(`/canvas/${id}`, { state: canvasDraftNavigationState(id) });
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : t("create.recent.createFailed"));
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    };

    return (
        <section className="creation-recent-canvases" aria-labelledby="creation-recent-title">
            <header className="creation-section-heading">
                <h2 id="creation-recent-title">
                    <Clock3 aria-hidden="true" />
                    {t("create.recent.title")}
                </h2>
                <Link to="/canvas" className="creation-section-link">
                    {t("create.recent.viewAll")}
                    <ArrowUpRight aria-hidden="true" />
                </Link>
            </header>
            <div className="creation-canvas-strip creation-scrollbar" role="list" aria-label={t("create.recent.listLabel")} aria-busy={loading}>
                <div className="creation-canvas-strip-item" role="listitem">
                    <button type="button" className="creation-canvas-tile is-create" disabled={!sessionHydrated || !canvasHydrated || creating} onClick={() => void createCanvas()} onPointerEnter={preload} onFocus={preload}>
                        <span className="creation-canvas-thumbnail is-create">{creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}</span>
                        <span className="creation-canvas-copy">
                            <strong>{creating ? t("create.recent.creating") : t("create.recent.create")}</strong>
                            <small>{t("create.recent.fromBlank")}</small>
                        </span>
                    </button>
                </div>
                {loading ? (
                    Array.from({ length: RECENT_COUNT }, (_, index) => (
                        <div key={index} className="creation-canvas-strip-item creation-canvas-skeleton" role="listitem" aria-label={t("create.recent.loading")}>
                            <span />
                            <span />
                        </div>
                    ))
                ) : userId && recentQuery.isError ? (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <span role="alert">{t("create.recent.loadFailed")}</span>
                        <button type="button" onClick={() => void recentQuery.refetch()} disabled={recentQuery.isFetching}>
                            {recentQuery.isFetching ? t("create.recent.retrying") : t("common.retry")}
                        </button>
                    </div>
                ) : recentProjects.length ? (
                    recentProjects.map((project) => (
                        <div className="creation-canvas-strip-item" role="listitem" key={project.id}>
                            <Link to={`/canvas/${project.id}`} className="creation-canvas-tile" onPointerEnter={preload} onFocus={preload} title={project.title}>
                                <span className="creation-canvas-thumbnail" aria-hidden="true">
                                    <ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage />
                                </span>
                                <span className="creation-canvas-copy">
                                    <strong>{project.title || t("create.recent.untitledCanvas")}</strong>
                                    <small>
                                        {t("create.recent.nodeCount", { count: project.nodeCount })} · <RelativeTime value={project.updatedAt} />
                                    </small>
                                </span>
                            </Link>
                        </div>
                    ))
                ) : (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <PanelsTopLeft aria-hidden="true" />
                        <span>{userId ? t("create.recent.empty") : t("create.recent.loginHint")}</span>
                        {!userId ? (
                            <button type="button" onClick={onRequireLogin}>
                                {t("shell.login")}
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
