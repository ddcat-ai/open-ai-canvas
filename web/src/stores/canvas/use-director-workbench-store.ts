import { create } from "zustand";

import { DIRECTOR_DEFAULT_MODE, directorModeCapabilities, resolveDirectorModeTransition, type DirectorMode } from "@/lib/canvas/director/director-modes";
import { DIRECTOR_DEFAULT_VIEW_MODE, type DirectorViewMode } from "@/lib/canvas/director/director-view-modes";
import type { DirectorRenderMode } from "@/types/director";

type DirectorWorkbenchStore = {
    selectedObjectId: string | null;
    selectedBone: string | null;
    selectedLightId: string | null;
    mode: DirectorMode;
    /** 取景模式（3D/CAM/五个正交轴向）。纯视口状态，不影响一级模式的能力矩阵。 */
    viewMode: DirectorViewMode;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    playhead: number;
    playing: boolean;
    autoKey: boolean;
    sequencerHeight: number;
    sequencerVisible: boolean;
    setSelectedObjectId: (id: string | null) => void;
    setSelectedBone: (bone: string | null) => void;
    setSelectedLightId: (id: string | null) => void;
    /** 切换一级模式。离开动画模式时一并停播、关 Auto Key、夹回合法渲染视图。 */
    setMode: (mode: DirectorMode) => void;
    /** 切换取景模式。UI-only：不写入 DirectorScene，不产生 undo/history。 */
    setViewMode: (mode: DirectorViewMode) => void;
    setTransformMode: (mode: DirectorWorkbenchStore["transformMode"]) => void;
    /** 切换渲染视图。当前模式不允许的视图一律忽略，不做静默降级。 */
    setRenderMode: (mode: DirectorRenderMode) => void;
    setPlayhead: (time: number) => void;
    setPlaying: (playing: boolean) => void;
    setAutoKey: (autoKey: boolean) => void;
    setSequencerHeight: (height: number) => void;
    setSequencerVisible: (visible: boolean) => void;
    reset: () => void;
};

const initialState = {
    mode: DIRECTOR_DEFAULT_MODE,
    viewMode: DIRECTOR_DEFAULT_VIEW_MODE,
    selectedObjectId: null,
    selectedBone: null,
    selectedLightId: null,
    transformMode: "translate" as const,
    renderMode: "beauty" as const,
    playhead: 0,
    playing: false,
    autoKey: false,
    sequencerHeight: 300,
    sequencerVisible: true,
};

export const useDirectorWorkbenchStore = create<DirectorWorkbenchStore>((set) => ({
    ...initialState,
    setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId, selectedBone: null, selectedLightId: null }),
    setSelectedBone: (selectedBone) => set({ selectedBone }),
    setSelectedLightId: (selectedLightId) => set({ selectedLightId, selectedObjectId: null, selectedBone: null }),
    setMode: (mode) => set((state) => resolveDirectorModeTransition({ mode, playing: state.playing, autoKey: state.autoKey, renderMode: state.renderMode })),
    setViewMode: (viewMode) => set({ viewMode }),
    setTransformMode: (transformMode) => set({ transformMode }),
    // 夹在 store 层而不是只在 UI 层过滤：dock 与顶栏是两条路径，
    // 只挡其中一条迟早会漏（本轮就漏过一次：dock 的「骨骼视图」在摆场模式仍可点）。
    setRenderMode: (renderMode) => set((state) => (directorModeCapabilities(state.mode).renderModes.includes(renderMode) ? { renderMode } : {})),
    setPlayhead: (playhead) => set({ playhead }),
    setPlaying: (playing) => set({ playing }),
    setAutoKey: (autoKey) => set({ autoKey }),
    setSequencerHeight: (sequencerHeight) => set({ sequencerHeight: Math.max(180, Math.min(620, sequencerHeight)) }),
    setSequencerVisible: (sequencerVisible) => set({ sequencerVisible }),
    reset: () => set(initialState),
}));
