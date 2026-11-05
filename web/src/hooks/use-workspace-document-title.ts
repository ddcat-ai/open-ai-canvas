import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { workspacePageTitleKey } from "@/lib/workspace-page-title";
import type { DramaSummary } from "@/services/api/drama";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useDocumentTitleStore } from "@/stores/use-document-title-store";

/**
 * 浏览器标签页显示当前页面：画布显示画布名（重命名后立即更新），短剧显示项目名，
 * 设置页显示分类名，其余页面显示导航名称。
 */
export function useWorkspaceDocumentTitle() {
    const { t } = useTranslation();
    const { pathname, search } = useLocation();
    const [slug, id] = pathname.split("/").filter(Boolean);
    const canvasId = slug === "canvas" ? id || "" : "";
    const canvasTitle = useCanvasStore((state) => (canvasId ? state.projects.find((project) => project.id === canvasId)?.title?.trim() || "" : ""));
    const dramaProjectId = slug === "projects" && id && id !== "new" ? id : "";
    const dramaName = useCachedDramaProjectName(dramaProjectId);
    const titleKey = workspacePageTitleKey(pathname);
    const pageLabel = titleKey ? t(titleKey) : "";
    const section = slug === "settings" ? new URLSearchParams(search).get("section") : null;
    const sectionLabel = section ? t(`settings.sections.${section}.label`, { defaultValue: "" }) : "";
    const title = canvasId ? canvasTitle || pageLabel : dramaProjectId ? dramaName || pageLabel : sectionLabel ? `${sectionLabel} · ${pageLabel}` : pageLabel;
    const setPageTitle = useDocumentTitleStore((state) => state.setPageTitle);

    useLayoutEffect(() => setPageTitle(title), [setPageTitle, title]);
    useLayoutEffect(() => () => setPageTitle(""), [setPageTitle]);
}

/** 只读短剧制作台已加载的摘要缓存，不另发请求，也不改动制作台查询的配置。 */
function useCachedDramaProjectName(projectId: string) {
    const queryClient = useQueryClient();
    const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
    return useSyncExternalStore(subscribe, () => (projectId ? queryClient.getQueryData<DramaSummary>(dramaKeys.summary(projectId))?.project?.name?.trim() || "" : ""));
}
