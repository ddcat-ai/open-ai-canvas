import { useUserStore } from "@/stores/use-user-store";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";

export function canvasWorkspaceTasksKey(userId: string | undefined, projectId: string) {
    return ["canvas-workspace-tasks", userId, projectId] as const;
}

/** 新建任务先放到列表顶部（同 id 去重），refetch 返回前面板就能看到它。 */
export function insertCreatedWorkspaceTask(previous: GenerationTask[] | undefined, task: GenerationTask): GenerationTask[] {
    return [task, ...(previous || []).filter((item) => item.id !== task.id)];
}

export function useCanvasWorkspaceTasks(projectId: string, enabled: boolean) {
    const userId = useUserStore((s) => s.user?.id);
    const queryClient = useQueryClient();
    const queryKey = canvasWorkspaceTasksKey(userId, projectId);
    const query = useQuery<GenerationTask[]>({
        queryKey,
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
        if (!enabled || !userId) return;
        const handleTaskCreated = (event: Event) => {
            const task = (event as CustomEvent<{ task?: GenerationTask }>).detail?.task;
            if (!task?.id || task.projectId !== projectId) return;
            queryClient.setQueryData<GenerationTask[]>(canvasWorkspaceTasksKey(userId, projectId), (previous) => insertCreatedWorkspaceTask(previous, task));
            void query.refetch();
        };
        const handleTaskCancelled = (event: Event) => {
            const task = (event as CustomEvent<{ task?: GenerationTask }>).detail?.task;
            if (task?.projectId === projectId) void query.refetch();
        };
        window.addEventListener("canvas:task-created", handleTaskCreated);
        window.addEventListener("canvas:task-cancelled", handleTaskCancelled);
        return () => {
            window.removeEventListener("canvas:task-created", handleTaskCreated);
            window.removeEventListener("canvas:task-cancelled", handleTaskCancelled);
        };
    }, [enabled, projectId, query.refetch, queryClient, userId]);

    // 任务面板隐藏 Agent 内部任务；历史面板消费全量 allTasks。
    const tasks = useMemo(() => (query.data || []).filter((task) => !isInternalAgentTask(task)), [query.data]);

    return {
        tasks,
        allTasks: query.data || [],
        error: query.error,
        loading: query.isLoading,
        refreshing: query.isFetching,
        /** 正在同步且还没有任何数据：消费方应显示加载态而不是空态 */
        syncing: query.isFetching && !query.data,
        refetch: query.refetch,
    };
}

function isInternalAgentTask(task: GenerationTask) {
    return task.operation?.startsWith("cloud_agent") === true;
}
