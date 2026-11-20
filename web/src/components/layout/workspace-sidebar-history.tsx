import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FileText, Image as ImageIcon, LoaderCircle, PanelsTopLeft, Plus, Video } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { cn } from "@/lib/utils";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { resolveBackendApiUrl } from "@/stores/use-config-store";
import { useCreationSidebarHistory } from "@/hooks/use-creation-sidebar-history";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";

const PAGE_SIZE = 5;

function HistorySection({ title, action, children, loading }: { title: string; action?: ReactNode; children: ReactNode; loading?: boolean }) {
    return (
        <section className="workspace-history-section" aria-label={title} aria-busy={loading || undefined}>
            <header className="workspace-history-heading">
                <h2>{title}</h2>
                {action}
            </header>
            {children}
        </section>
    );
}

function HistorySkeleton() {
    return (
        <div className="workspace-history-list" aria-hidden="true">
            {Array.from({ length: PAGE_SIZE }, (_, index) => (
                <div className="workspace-history-skeleton" key={index}>
                    <span />
                    <span />
                </div>
            ))}
        </div>
    );
}

function HistoryPagination({ hasMore, expanded, loading, failed, onMore, onCollapse }: { hasMore: boolean; expanded: boolean; loading?: boolean; failed?: boolean; onMore: () => void; onCollapse: () => void }) {
    const { t } = useTranslation();
    if (!hasMore && !expanded && !failed) return null;
    return (
        <div className="workspace-history-pagination">
            {hasMore || failed ? (
                <button type="button" className="workspace-history-more" onClick={onMore} disabled={loading}>
                    {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : <ChevronDown aria-hidden />}
                    <span>{t(loading ? "nav.sidebar.loading" : failed ? "common.retry" : "nav.sidebar.loadMore")}</span>
                </button>
            ) : (
                <span />
            )}
            {expanded ? (
                <button type="button" className="workspace-history-more" onClick={onCollapse} disabled={loading}>
                    <ChevronUp aria-hidden />
                    <span>{t("nav.sidebar.showLess")}</span>
                </button>
            ) : null}
        </div>
    );
}

const conversationIcons = { video: Video, image: ImageIcon, text: FileText };

function ConversationHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    const { t } = useTranslation();
    const history = useCreationSidebarHistory(userId);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    return (
        <HistorySection
            title={t("nav.sidebar.conversations")}
            loading={history.loading}
            action={
                <Link
                    to="/?conversation=new"
                    className="product-icon-button"
                    aria-label={t("nav.sidebar.newConversation")}
                    title={t(history.canSelect ? "nav.sidebar.newConversation" : "nav.sidebar.switchUnavailable")}
                    aria-disabled={!history.canSelect || undefined}
                    onClick={(event) => {
                        if (!history.canSelect) event.preventDefault();
                        else onNavigate();
                    }}
                >
                    <Plus aria-hidden />
                </Link>
            }
        >
            {history.loading ? <HistorySkeleton /> : null}
            {history.error ? (
                <div className="workspace-history-state" role="alert">
                    <span>{t("nav.sidebar.historyFailed")}</span>
                    <button type="button" className="workspace-history-more" disabled={history.loading} onClick={history.refetch}>
                        {t("common.retry")}
                    </button>
                </div>
            ) : null}
            <ul className="workspace-history-list">
                {history.items.slice(0, visibleCount).map((item) => {
                    const current = item.id === history.activeId;
                    const disabled = !current && !history.canSelect;
                    const Icon = conversationIcons[item.mode];
                    return (
                        <li key={item.id}>
                            <Link
                                to={`/?conversation=${encodeURIComponent(item.id)}`}
                                className={cn("workspace-history-item", current && "is-active")}
                                aria-current={current ? "page" : undefined}
                                aria-disabled={disabled || undefined}
                                title={disabled ? t("nav.sidebar.switchUnavailable") : item.title || t("nav.sidebar.newConversation")}
                                onClick={(event) => {
                                    if (disabled) event.preventDefault();
                                    else onNavigate();
                                }}
                            >
                                <span className="workspace-history-thumb" role="img" aria-label={t(`create.mode.${item.mode}`)}>
                                    <Icon aria-hidden />
                                </span>
                                <span className="workspace-history-title">{item.title || t("nav.sidebar.newConversation")}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
            {!history.loading && !history.items.length && !history.error ? <p className="workspace-history-state">{t("nav.sidebar.noConversations")}</p> : null}
            <HistoryPagination hasMore={history.items.length > visibleCount} expanded={visibleCount > PAGE_SIZE} onMore={() => setVisibleCount((count) => count + PAGE_SIZE)} onCollapse={() => setVisibleCount(PAGE_SIZE)} />
        </HistorySection>
    );
}

function CanvasThumbnail({ project }: { project: CanvasLibrarySummary }) {
    const image = project.previewNodes.find((node) => node.type === CanvasNodeType.Image && (node.metadata?.storageKey || node.metadata?.previewContent || node.metadata?.content));
    const fallback = <PanelsTopLeft />;
    return (
        <span className="workspace-history-thumb" aria-hidden>
            {image ? (
                <CachedResourceImage storageKey={image.metadata?.storageKey} src={resolveBackendApiUrl(image.metadata?.previewContent || image.metadata?.content || "")} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={fallback} />
            ) : (
                fallback
            )}
        </span>
    );
}

function CanvasHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    const { t } = useTranslation();
    const hydrated = useUserStore((state) => state.hydrated);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const loadingMore = useRef(false);
    const query = useInfiniteQuery({
        queryKey: ["canvas-library", userId, "sidebar", "updated", PAGE_SIZE],
        queryFn: ({ pageParam, signal }) => listRemoteCanvasProjectsPage({ page: pageParam, pageSize: PAGE_SIZE, sort: "updated", signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
        enabled: hydrated,
    });
    // 更新排序的分页可能重叠：保留首次出现的最新摘要，避免重复条目。
    const projects = useMemo(() => {
        const unique = new Map<string, CanvasLibrarySummary>();
        for (const page of query.data?.pages ?? []) for (const project of page.projects) if (!unique.has(project.id)) unique.set(project.id, project);
        return [...unique.values()];
    }, [query.data]);
    const loadMore = async () => {
        if (query.isFetching || loadingMore.current) return;
        if (projects.length >= visibleCount + PAGE_SIZE || !query.hasNextPage) {
            setVisibleCount((count) => count + PAGE_SIZE);
            return;
        }
        loadingMore.current = true;
        try {
            const result = await query.fetchNextPage();
            if (!result.isError) setVisibleCount((count) => count + PAGE_SIZE);
        } finally {
            loadingMore.current = false;
        }
    };
    const preload = () => {
        void loadCanvasProjectPage();
    };
    return (
        <HistorySection
            title={t("nav.sidebar.canvases")}
            loading={query.isPending || query.isFetchingNextPage}
            action={
                <Link to="/canvas" className="workspace-history-all" onClick={onNavigate}>
                    {t("nav.sidebar.viewAll")}
                </Link>
            }
        >
            {query.isPending ? (
                <HistorySkeleton />
            ) : (
                <ul className="workspace-history-list">
                    {projects.slice(0, visibleCount).map((project) => (
                        <li key={project.id}>
                            <Link to={`/canvas/${project.id}`} className="workspace-history-item" title={project.title || t("create.recent.untitledCanvas")} onClick={onNavigate} onPointerEnter={preload} onFocus={preload}>
                                <CanvasThumbnail project={project} />
                                <span className="workspace-history-title">{project.title || t("create.recent.untitledCanvas")}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {query.isError ? (
                <div className="workspace-history-state" role="alert">
                    <span>{t("nav.sidebar.canvasesFailed")}</span>
                    {!query.isFetchNextPageError ? (
                        <button type="button" className="workspace-history-more" disabled={query.isFetching} onClick={() => void query.refetch()}>
                            {t("common.retry")}
                        </button>
                    ) : null}
                </div>
            ) : !query.isPending && !projects.length ? (
                <p className="workspace-history-state">{t("nav.sidebar.noCanvases")}</p>
            ) : null}
            <HistoryPagination
                hasMore={projects.length > visibleCount || Boolean(query.hasNextPage)}
                expanded={visibleCount > PAGE_SIZE}
                loading={query.isFetching}
                failed={query.isFetchNextPageError}
                onMore={() => void loadMore()}
                onCollapse={() => setVisibleCount(PAGE_SIZE)}
            />
        </HistorySection>
    );
}

export function WorkspaceSidebarHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    return (
        <div className="workspace-sidebar-history">
            <ConversationHistory key={`conversations-${userId}`} userId={userId} onNavigate={onNavigate} />
            <CanvasHistory key={`canvases-${userId}`} userId={userId} onNavigate={onNavigate} />
        </div>
    );
}
