import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useNavigate } from "react-router";

import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { dramaSummaryQuery } from "@/lib/drama/drama-summary-query";
import { dramaIsWorking } from "@/lib/drama/use-drama-cast";
import { getDramaEpisode, type DramaCast, type DramaEpisodeDetail, type DramaSummary } from "@/services/api/drama";
import { encodeDramaCanvasFocus, openDramaCanvasPath, type DramaCanvasEditor, type DramaCanvasFocus } from "@/services/drama-canvas";

export { dramaKeys };

export { useDramaCast } from "@/lib/drama/use-drama-cast";

export function useDramaSummary(projectId: string) {
    return useQuery({
        ...dramaSummaryQuery(projectId),
        enabled: Boolean(projectId),
        refetchInterval: (query) => (dramaIsWorking(query.state.data) ? 3_000 : 20_000),
        refetchOnWindowFocus: true,
    });
}

export function useDramaEpisode(projectId: string, episodeId: string, active: boolean) {
    return useQuery({
        queryKey: dramaKeys.episode(projectId, episodeId),
        queryFn: ({ signal }) => getDramaEpisode(projectId, episodeId, signal),
        enabled: Boolean(projectId && episodeId),
        placeholderData: (previous) => (previous?.episode.id === episodeId ? previous : undefined),
        refetchInterval: (query) => {
            const detail = query.state.data;
            if (detail?.composeJob?.status === "queued" || detail?.composeJob?.status === "running") return 2_500;
            if (!active || !detail) return false;
            const writing = detail.segments?.some((segment) => segment.promptStatus === "queued" || segment.promptStatus === "running");
            return detail.jobs.length || writing || detail.episode.stage !== "done" ? 2_500 : false;
        },
    });
}

/**
 * renumbered=true 用于插入或删除集：后续各集集号都变了，全部单集详情一起失效。
 * removedEpisodeId 是刚删除的集，先移出缓存，避免仍挂着的旧查询被重新请求成 404。
 */
export function useDramaInvalidate(projectId: string) {
    const queryClient = useQueryClient();
    return (episodeId?: string, options: { renumbered?: boolean; removedEpisodeId?: string; assetsChanged?: boolean } = {}) => {
        if (options.removedEpisodeId) queryClient.removeQueries({ queryKey: dramaKeys.episode(projectId, options.removedEpisodeId), exact: true });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.summary(projectId), exact: true });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.cast(projectId) });
        void queryClient.invalidateQueries({ queryKey: ["drama", projectId, "cast-impact"] });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.jobs(projectId) });
        void queryClient.invalidateQueries({ queryKey: ["drama", projectId, "takes"] });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.chapters(projectId) });
        if (options.renumbered || options.assetsChanged) return queryClient.invalidateQueries({ queryKey: dramaKeys.episodes(projectId) });
        if (episodeId) return queryClient.invalidateQueries({ queryKey: dramaKeys.episode(projectId, episodeId) });
    };
}

/**
 * 打开作品的精修画布（没有时新建并关联），可带上要投送或定位的对象。
 * opening 是正在打开的对象键（无对象时为 canvas），用于按钮的加载态。
 */
export function useOpenDramaCanvas(summary: DramaSummary | undefined) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [opening, setOpening] = useState<string | null>(null);
    const openingRef = useRef(false);
    const id = summary?.project.id || "";
    const name = summary?.project.name || "";
    const open = useCallback(
        async (focus?: DramaCanvasFocus, editor: DramaCanvasEditor = "canvas") => {
            if (!id || openingRef.current) return;
            openingRef.current = true;
            setOpening(focus ? encodeDramaCanvasFocus(focus) : "canvas");
            try {
                navigate(await openDramaCanvasPath({ id, name }, focus, editor));
            } catch (error) {
                message.error(error instanceof Error && error.message ? error.message : "打开精修画布失败");
            } finally {
                openingRef.current = false;
                setOpening(null);
            }
        },
        [id, message, name, navigate],
    );
    return { open, opening };
}

export type StudioContext = {
    projectId: string;
    summary: DramaSummary;
    detail?: DramaEpisodeDetail;
    castById: Map<string, DramaCast>;
};

export function isTypingTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || Boolean(element.closest(".ant-select, .ant-modal, .ant-drawer, .ant-popover, .ant-dropdown, [role='dialog'], [role='listbox'], [aria-haspopup]"));
}
