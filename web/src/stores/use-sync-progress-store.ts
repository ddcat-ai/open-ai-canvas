import { create } from "zustand";

export type SyncProjectProgress = {
    projectId: string;
    total: number;
    completed: number;
    phase: "uploading" | "saving" | "done" | "error";
    message?: string;
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
        return list.some((item) => item.phase === "uploading" || item.phase === "saving");
    },
}));
