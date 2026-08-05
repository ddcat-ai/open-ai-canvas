import { create } from "zustand";

import type { DirectorRenderMode } from "@/types/director";

type DirectorWorkbenchStore = {
    selectedObjectId: string | null;
    selectedBone: string | null;
    selectedLightId: string | null;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    playhead: number;
    playing: boolean;
    autoKey: boolean;
    sequencerHeight: number;
    setSelectedObjectId: (id: string | null) => void;
    setSelectedBone: (bone: string | null) => void;
    setSelectedLightId: (id: string | null) => void;
    setTransformMode: (mode: DirectorWorkbenchStore["transformMode"]) => void;
    setRenderMode: (mode: DirectorRenderMode) => void;
    setPlayhead: (time: number) => void;
    setPlaying: (playing: boolean) => void;
    setAutoKey: (autoKey: boolean) => void;
    setSequencerHeight: (height: number) => void;
    reset: () => void;
};

const initialState = { selectedObjectId: null, selectedBone: null, selectedLightId: null, transformMode: "translate" as const, renderMode: "beauty" as const, playhead: 0, playing: false, autoKey: true, sequencerHeight: 300 };

export const useDirectorWorkbenchStore = create<DirectorWorkbenchStore>((set) => ({
    ...initialState,
    setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId, selectedBone: null, selectedLightId: null }),
    setSelectedBone: (selectedBone) => set({ selectedBone }),
    setSelectedLightId: (selectedLightId) => set({ selectedLightId, selectedObjectId: null, selectedBone: null }),
    setTransformMode: (transformMode) => set({ transformMode }),
    setRenderMode: (renderMode) => set({ renderMode }),
    setPlayhead: (playhead) => set({ playhead }),
    setPlaying: (playing) => set({ playing }),
    setAutoKey: (autoKey) => set({ autoKey }),
    setSequencerHeight: (sequencerHeight) => set({ sequencerHeight: Math.max(180, Math.min(620, sequencerHeight)) }),
    reset: () => set(initialState),
}));
