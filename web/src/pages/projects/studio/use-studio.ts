import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useNavigate } from "react-router";

import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { getDrama, getDramaEpisode, listDramaCast, type DramaCast, type DramaEpisodeDetail, type DramaSummary } from "@/services/api/drama";
import { encodeDramaCanvasFocus, openDramaCanvasPath, type DramaCanvasFocus } from "@/services/drama-canvas";

export { dramaKeys };

function summaryActive(summary?: DramaSummary) {
    if (!summary) return false;
    return summary.production.status === "running" || (summary.jobCounts.running || 0) > 0;
}

export function useDramaSummary(projectId: string) {
    return useQuery({
        queryKey: dramaKeys.summary(projectId),
        queryFn: ({ signal }) => getDrama(projectId, signal),
        enabled: Boolean(projectId),
        refetchInterval: (query) => (summaryActive(query.state.data) ? 3_000 : 20_000),
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
            if (!active || !detail) return false;
            const writing = detail.segments?.some((segment) => segment.promptStatus === "queued" || segment.promptStatus === "running");
            return detail.jobs.length || writing || detail.episode.stage !== "done" ? 2_500 : false;
        },
    });
}

export function useDramaCast(projectId: string, active: boolean) {
    const query = useQuery({
        queryKey: dramaKeys.cast(projectId),
        queryFn: ({ signal }) => listDramaCast(projectId, signal),
        enabled: Boolean(projectId),
        refetchInterval: (state) => (active && state.state.data?.cast.some((cast) => cast.imageStatus !== "ready" && cast.imageStatus !== "failed" && !cast.locked) ? 4_000 : false),
    });
    const byId = useMemo(() => new Map((query.data?.cast || []).map((cast) => [cast.id, cast] as const)), [query.data]);
    return { ...query, cast: query.data?.cast || [], byId };
}

export function useDramaInvalidate(projectId: string) {
    const queryClient = useQueryClient();
    return (episodeId?: string) => {
        void queryClient.invalidateQueries({ queryKey: dramaKeys.summary(projectId), exact: true });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.cast(projectId) });
        void queryClient.invalidateQueries({ queryKey: dramaKeys.jobs(projectId) });
        void queryClient.invalidateQueries({ queryKey: ["drama", projectId, "takes"] });
        if (episodeId) void queryClient.invalidateQueries({ queryKey: dramaKeys.episode(projectId, episodeId) });
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
        async (focus?: DramaCanvasFocus) => {
            if (!id || openingRef.current) return;
            openingRef.current = true;
            setOpening(focus ? encodeDramaCanvasFocus(focus) : "canvas");
            try {
                navigate(await openDramaCanvasPath({ id, name }, focus));
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
