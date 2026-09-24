import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listGenerationTasks, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";

export function useCanvasActiveTasks(projectId: string, enabled: boolean) {
    const queryClient = useQueryClient();
    const query = useQuery<GenerationTask[]>({
        queryKey: ["canvas-active-tasks", projectId],
        // Agent 的持久化执行仍复用任务队列/计费生命周期，但不应占据画布右上角的“生成任务”浮层。
        // 多取一页再过滤，避免 Agent 排在前面时把真正的画布生成任务挤掉。
        queryFn: ({ signal }) => listGenerationTasks(30, { projectId, activeOnly: true }, undefined, signal).then((tasks) => tasks.filter((task) => !isInternalAgentTask(task)).slice(0, 5)),
        enabled: enabled && Boolean(projectId),
        // Shared task observers provide live updates. Lists only discover missed/new tasks.
        refetchInterval: 10_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
    });

    const taskIds = JSON.stringify((query.data || []).map((task) => task.id).sort());
    useEffect(() => {
        if (!enabled || !projectId) return;
        return subscribeGenerationTasks(JSON.parse(taskIds) as string[], (task) => {
            if (task.projectId !== projectId || isInternalAgentTask(task)) return;
            queryClient.setQueryData<GenerationTask[]>(["canvas-active-tasks", projectId], (current) => {
                if (!current) return current;
                const previous = current.find((item) => item.id === task.id);
                if (!previous || previous.updatedAt > task.updatedAt) return current;
                if (task.status !== "queued" && task.status !== "running") return current.filter((item) => item.id !== task.id);
                return current.map((item) => item.id === task.id ? task : item);
            });
        });
    }, [enabled, projectId, queryClient, taskIds]);

    useEffect(() => {
        if (!enabled || !projectId) return;
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

    return {
        tasks: query.data || [],
        loading: query.isLoading,
        refreshing: query.isFetching,
        refetch: query.refetch,
    };
}

function isInternalAgentTask(task: GenerationTask) {
    return task.operation?.startsWith("cloud_agent") === true;
}
