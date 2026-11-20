import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDramaCast, type DramaCast, type DramaSummary } from "@/services/api/drama";
import { dramaKeys } from "./drama-query-keys";

export function dramaIsWorking(summary?: DramaSummary) {
    return Boolean(summary && (summary.production.status === "running" || (summary.jobCounts.running || 0) > 0));
}

export function useDramaCast(projectId: string, summary?: DramaSummary) {
    const client = useQueryClient();
    const active = dramaIsWorking(summary);
    const query = useQuery({
        queryKey: dramaKeys.cast(projectId),
        queryFn: ({ signal }) => listDramaCast(projectId, signal),
        enabled: Boolean(projectId),
        refetchOnMount: "always",
        refetchInterval: active ? 4_000 : false,
    });
    const previous = useRef<{ projectId: string; active: boolean; cast?: DramaCast[] } | null>(null);
    const casts = query.data?.cast;
    useEffect(() => {
        const prior = previous.current;
        previous.current = { projectId, active, cast: casts };
        if (!projectId || prior?.projectId !== projectId) return;
        const settled = prior.active && !active;
        if (settled) void client.invalidateQueries({ queryKey: dramaKeys.cast(projectId), exact: true });
        // React Query 对相同的数据保留数组引用。引用数也可能随分镜写入而变化。
        if (prior.cast === casts && !settled) return;
        void client.invalidateQueries({ queryKey: dramaKeys.episodes(projectId) });
        void client.invalidateQueries({ queryKey: ["drama", projectId, "cast-impact"] });
        void client.invalidateQueries({ queryKey: ["drama", projectId, "takes", "cast"] });
        void client.invalidateQueries({ queryKey: ["project-asset-picker", projectId] });
    }, [active, casts, client, projectId]);
    const byId = useMemo(() => new Map((casts || []).map((cast) => [cast.id, cast] as const)), [casts]);
    return { ...query, cast: casts || [], byId };
}
