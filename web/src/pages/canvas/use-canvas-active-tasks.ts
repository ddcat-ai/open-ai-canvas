import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";

export function useCanvasActiveTasks(projectId: string, enabled: boolean) {
    const query = useQuery<GenerationTask[]>({
        queryKey: ["canvas-active-tasks", projectId],
        // Agent 的持久化执行仍复用任务队列/计费生命周期，但不应占据画布右上角的“生成任务”浮层。
        // 多取一页再过滤，避免 Agent 排在前面时把真正的画布生成任务挤掉。
        queryFn: () => listGenerationTasks(30, { projectId, activeOnly: true }).then((tasks) => tasks.filter((task) => !isInternalAgentTask(task)).slice(0, 5)),
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

function isInternalAgentTask(task: GenerationTask) {
    return task.operation?.startsWith("cloud_agent") === true;
}
