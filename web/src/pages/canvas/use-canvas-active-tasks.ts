import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";

export function useCanvasActiveTasks(projectId: string, enabled: boolean) {
    const query = useQuery<GenerationTask[]>({
        queryKey: ["canvas-active-tasks", projectId],
        queryFn: () => listGenerationTasks(5, { projectId, activeOnly: true }),
        enabled: enabled && Boolean(projectId),
        refetchInterval: (current) => (current.state.data?.length ? 2_000 : 10_000),
        refetchOnWindowFocus: true,
    });

    useEffect(() => {
        const handleTaskChanged = (event: Event) => {
            const task = (event as CustomEvent<{ task?: GenerationTask }>).detail?.task;
            if (task?.projectId === projectId) void query.refetch();
        };
        window.addEventListener("canvas:task-created", handleTaskChanged);
        window.addEventListener("canvas:task-cancelled", handleTaskChanged);
        return () => {
            window.removeEventListener("canvas:task-created", handleTaskChanged);
            window.removeEventListener("canvas:task-cancelled", handleTaskChanged);
        };
    }, [projectId, query.refetch]);

    return {
        tasks: query.data || [],
        loading: query.isLoading,
        refreshing: query.isFetching,
        refetch: query.refetch,
    };
}

