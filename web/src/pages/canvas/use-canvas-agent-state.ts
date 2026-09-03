import { useEffect, useMemo, useRef } from "react";

import {
    agentTaskSummary,
    browserAgentStateStorage,
    deriveAgentStateFromNodes,
    loadAgentState,
    reconcileAgentState,
    saveAgentState,
    type CanvasAgentState,
} from "@/lib/canvas/canvas-agent-state";
import type { CanvasNodeData } from "@/types/canvas";

// 以画布真实节点为事实来源派生 Agent 创作状态，并与 localStorage 中的跨刷新记录对账。
// 节点本身已被持久化，因此即使本地缓存缺失也能完整恢复进行中/已完成任务，缓存只补充 mode/taskId。
export function useCanvasAgentState(projectId: string | undefined, nodes: CanvasNodeData[]) {
    const storage = useRef(browserAgentStateStorage());
    const persistedRef = useRef<CanvasAgentState | null>(null);
    const lastSavedRef = useRef<string>("");

    // 项目切换或首次挂载时读取一次持久化记录。
    const persistedKey = projectId || "";
    useEffect(() => {
        persistedRef.current = projectId ? loadAgentState(projectId, storage.current) : null;
        lastSavedRef.current = "";
    }, [persistedKey, projectId]);

    const state = useMemo<CanvasAgentState>(() => {
        const derived = deriveAgentStateFromNodes(nodes, "generating");
        return reconcileAgentState(derived, persistedRef.current);
    }, [nodes]);

    const summary = useMemo(() => agentTaskSummary(state), [state]);

    // 状态变化时写回本地（按序列化内容去重，避免无意义写入）。
    useEffect(() => {
        if (!projectId) return;
        const serialized = JSON.stringify(state);
        if (serialized === lastSavedRef.current) return;
        lastSavedRef.current = serialized;
        saveAgentState(projectId, state, storage.current);
    }, [projectId, state]);

    return { state, summary };
}
