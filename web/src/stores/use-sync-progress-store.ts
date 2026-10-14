import { create } from "zustand";

export type LocalCanvasPersistencePhase = "saved" | "pending" | "error";

export type SyncProjectProgress = {
    projectId: string;
    total: number;
    completed: number;
    phase: "local" | "pending" | "uploading" | "saving" | "done" | "error";
    message?: string;
    errorKind?: "local" | "network" | "conflict" | "resources";
    localPhase?: LocalCanvasPersistencePhase;
    localSavedAt?: string;
    localError?: string;
    pendingWrites?: number;
    pendingChanges?: number;
    cloudRevision?: number;
};

type SyncProgressStore = {
    syncingProjects: Record<string, SyncProjectProgress>;
    setProjectProgress: (projectId: string, patch: Partial<SyncProjectProgress> | null) => void;
    incrementProjectCompleted: (projectId: string) => void;
    clearAll: () => void;
    isAnySyncing: () => boolean;
};

export const useSyncProgressStore = create<SyncProgressStore>((set, get) => ({
    syncingProjects: {},
    setProjectProgress: (projectId, patch) =>
        set((state) => {
            if (!patch) {
                const next = { ...state.syncingProjects };
                delete next[projectId];
                return { syncingProjects: next };
            }
            const current = state.syncingProjects[projectId] || {
                projectId,
                total: 0,
                completed: 0,
                phase: "uploading",
            };
            return {
                syncingProjects: {
                    ...state.syncingProjects,
                    [projectId]: { ...current, ...patch },
                },
            };
        }),
    incrementProjectCompleted: (projectId) =>
        set((state) => {
            const current = state.syncingProjects[projectId];
            if (!current) return state;
            return {
                syncingProjects: {
                    ...state.syncingProjects,
                    [projectId]: {
                        ...current,
                        completed: Math.min(current.total, current.completed + 1),
                    },
                },
            };
        }),
    clearAll: () => set({ syncingProjects: {} }),
    isAnySyncing: () => {
        const list = Object.values(get().syncingProjects);
        return list.some((item) => (item.phase !== "done" && item.phase !== "local") || item.localPhase === "pending" || item.localPhase === "error");
    },
}));

// 下载媒体时锚点点击会被浏览器当成一次导航（跨域地址不遵守 download 属性），
// 此时若画布正在同步，就会弹出「离开此网站」确认框。下载窗口期内临时放行，
// 让下载直接开始；真正的关闭/刷新不受影响。
let beforeUnloadSuppressedUntil = 0;

export function suppressBeforeUnloadGuard(durationMs = 3_000) {
    if (typeof window === "undefined") return;
    beforeUnloadSuppressedUntil = Date.now() + Math.max(0, durationMs);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", (event) => {
        if (Date.now() < beforeUnloadSuppressedUntil) return;
        if (useSyncProgressStore.getState().isAnySyncing()) {
            event.preventDefault();
            event.returnValue = "画布正在同步至云端，请勿关闭页面。";
            return "画布正在同步至云端，请勿关闭页面。";
        }
    });
}
