import { useUserStore } from "@/stores/use-user-store";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";

export function useCanvasWorkspaceTasks(projectId: string, enabled: boolean) {
    const userId = useUserStore((s) => s.user?.id);
    const query = useQuery<GenerationTask[]>({
        queryKey: ["canvas-workspace-tasks", userId, projectId],
        queryFn: () => listGenerationTasks(30, { projectId }),
        enabled: enabled && Boolean(projectId) && Boolean(userId),
        refetchInterval: (current) => {
            const data = current.state.data;
            if (!data?.length) return 10_000;
            const hasActive = data.some((task) => (task.status === "queued" || task.status === "running") && !isInternalAgentTask(task));
            return hasActive ? 3_000 : 10_000;
        },
        refetchOnWindowFocus: true,
    });

    useEffect(() => {
        if (!enabled) return;
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
    }, [enabled, projectId, query.refetch]);

    // 任务面板隐藏 Agent 内部任务；历史面板消费全量 allTasks。
    const tasks = useMemo(() => (query.data || []).filter((task) => !isInternalAgentTask(task)), [query.data]);

    return {
        tasks,
        allTasks: query.data || [],
        error: query.error,
        loading: query.isLoading,
        refreshing: query.isFetching,
        refetch: query.refetch,
    };
}

function isInternalAgentTask(task: GenerationTask) {
    return task.operation?.startsWith("cloud_agent") === true;
}
