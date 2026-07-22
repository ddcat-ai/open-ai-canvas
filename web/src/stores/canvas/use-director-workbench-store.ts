import { create } from "zustand";

import type { DirectorRenderMode } from "@/types/director";

type DirectorWorkbenchStore = {
    selectedObjectId: string | null;
    selectedLightId: string | null;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    playhead: number;
    playing: boolean;
    setSelectedObjectId: (id: string | null) => void;
    setSelectedLightId: (id: string | null) => void;
    setTransformMode: (mode: DirectorWorkbenchStore["transformMode"]) => void;
    setRenderMode: (mode: DirectorRenderMode) => void;
    setPlayhead: (time: number) => void;
    setPlaying: (playing: boolean) => void;
    reset: () => void;
};

const initialState = { selectedObjectId: null, selectedLightId: null, transformMode: "translate" as const, renderMode: "beauty" as const, playhead: 0, playing: false };

export const useDirectorWorkbenchStore = create<DirectorWorkbenchStore>((set) => ({
    ...initialState,
    setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId, selectedLightId: null }),
    setSelectedLightId: (selectedLightId) => set({ selectedLightId, selectedObjectId: null }),
    setTransformMode: (transformMode) => set({ transformMode }),
    setRenderMode: (renderMode) => set({ renderMode }),
    setPlayhead: (playhead) => set({ playhead }),
    setPlaying: (playing) => set({ playing }),
    reset: () => set(initialState),
}));
