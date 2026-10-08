import { create } from "zustand";

type ProjectId = string;
type ProjectTitle = string;
type ProjectIdList = string[];

type ProjectUiState = {
    editingProjectId: ProjectId | null;
    editingProjectTitle: ProjectTitle;
    selectedProjectIds: ProjectIdList;
    deleteProjectIds: ProjectIdList;
};

type CanvasUiStore = ProjectUiState & {
    startEditingProject: (id: string, title: string) => void;
    setEditingProjectTitle: (title: string) => void;
    stopEditingProject: () => void;
    toggleSelectedProjectId: (id: string, selected: boolean) => void;
    setDeleteProjectIds: (ids: string[]) => void;
    removeSelectedProjectIds: (ids: string[]) => void;
};

const emptyProjectUi: ProjectUiState = {
    editingProjectId: null,
    editingProjectTitle: "",
    selectedProjectIds: [] as ProjectIdList,
    deleteProjectIds: [] as ProjectIdList,
};

function selectProject(ids: readonly string[], id: string, selected: boolean): string[] {
    if (!selected) return ids.filter((item) => item !== id);
    if (ids.includes(id)) return [...ids];
    return [...ids, id];
}

function dropProjects(ids: readonly string[], removed: readonly string[]): string[] {
    const blocked = new Set(removed);
    return ids.filter((id) => !blocked.has(id));
}

export const useCanvasUiStore = create<CanvasUiStore>((set) => ({
    ...emptyProjectUi,
    startEditingProject: (id, title) => {
        set({ editingProjectId: id, editingProjectTitle: title });
    },
    setEditingProjectTitle: (title) => {
        set({ editingProjectTitle: title });
    },
    stopEditingProject: () => {
        set({ editingProjectId: null });
    },
    toggleSelectedProjectId: (id, selected) => {
        set((state) => ({ selectedProjectIds: selectProject(state.selectedProjectIds, id, selected) }));
    },
    setDeleteProjectIds: (ids) => {
        set({ deleteProjectIds: ids });
    },
    removeSelectedProjectIds: (ids) => {
        set((state) => ({ selectedProjectIds: dropProjects(state.selectedProjectIds, ids) }));
    },
}));
