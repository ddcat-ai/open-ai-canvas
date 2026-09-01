import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type DeletedCanvasHistoryItem = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string;
    nodeCount: number;
    coverUrl?: string;
};

type CanvasHistoryStore = {
    deletedProjects: DeletedCanvasHistoryItem[];
    recordDeletedProjects: (projects: CanvasProject[]) => void;
    removeDeletedHistoryItem: (id: string) => void;
    clearDeletedHistory: () => void;
};

export const CANVAS_HISTORY_STORE_KEY = "infinite-canvas:deleted_history_store";

const historyStorage: PersistStorage<CanvasHistoryStore> = {
    getItem: async (name) => {
        const value = await localForageStorageForScope().getItem(name);
        return value ? JSON.parse(value) : null;
    },
    setItem: (name, value) => localForageStorageForScope().setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorageForScope().removeItem(name),
};

export const useCanvasHistoryStore = create<CanvasHistoryStore>()(
    persist(
        (set) => ({
            deletedProjects: [],
            recordDeletedProjects: (projects) => {
                const now = new Date().toISOString();
                const newItems: DeletedCanvasHistoryItem[] = projects.map((p) => ({
                    id: p.id,
                    title: p.title || "未命名画布",
                    createdAt: p.createdAt || p.updatedAt || now,
                    updatedAt: p.updatedAt || now,
                    deletedAt: now,
                    nodeCount: p.nodes?.length || 0,
                }));
                set((state) => {
                    const existingIds = new Set(newItems.map((item) => item.id));
                    const filtered = state.deletedProjects.filter((item) => !existingIds.has(item.id));
                    return {
                        deletedProjects: [...newItems, ...filtered].slice(0, 200),
                    };
                });
            },
            removeDeletedHistoryItem: (id) =>
                set((state) => ({
                    deletedProjects: state.deletedProjects.filter((item) => item.id !== id),
                })),
            clearDeletedHistory: () => set({ deletedProjects: [] }),
        }),
        {
            name: CANVAS_HISTORY_STORE_KEY,
            storage: historyStorage,
        },
    ),
);
