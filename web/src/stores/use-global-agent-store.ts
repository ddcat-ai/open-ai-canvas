import { create } from "zustand";
import { AGENT_PANEL_DOCK_KEY, restoreAgentPanelDock, type AgentPanelDockPreference } from "@/lib/canvas/agent-panel-dock";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CloudAgentMessagePresentation } from "@/services/cloud-agent-conversations";
import type { CanvasNodeData } from "@/types/canvas";

export type AgentPrefillRequest = CloudAgentMessagePresentation & { id: number; text: string; autoSubmit?: boolean; requiresVision?: boolean };

/**
 * 当前页面提供给平台级 Agent 的画布上下文。只有画布编辑器会发布它；
 * 离开画布时清空，此后的对话轮次不再绑定该画布。
 */
export type AgentCanvasContext = {
    canvasId: string;
    domainProjectId?: string;
    nodeCount: number;
    selectedNodeIds: string[];
    references: CanvasResourceReference[];
    canvasNodes?: readonly CanvasNodeData[];
    runningNodeId?: string | null;
    prefillRequest?: AgentPrefillRequest | null;
    onFocusNode?: (nodeId: string) => void;
};

type GlobalAgentStore = {
    /** 平台唯一 Agent 面板的开合状态，跨路由保持。 */
    open: boolean;
    canvas: AgentCanvasContext | null;
    /** 本机 UI 偏好：在画布里是否停靠到右侧，以及停靠宽度。账号切换不影响。 */
    dock: AgentPanelDockPreference;
    openAgent: () => void;
    closeAgent: () => void;
    setCanvas: (canvas: AgentCanvasContext | null) => void;
    setDocked: (docked: boolean) => void;
    setDockWidth: (width: number) => void;
    reset: () => void;
};

function readDockPreference() {
    try {
        return restoreAgentPanelDock(typeof localStorage === "undefined" ? null : localStorage.getItem(AGENT_PANEL_DOCK_KEY));
    } catch (error) {
        console.warn("Agent 停靠偏好无法读取", error);
        return restoreAgentPanelDock(null);
    }
}

function sameRecord(left: object, right: object) {
    if (left === right) return true;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every((key) => Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** 内容没变就沿用旧数组；变了也尽量沿用没变的元素，订阅方可以按引用判断变化。 */
function reuseEqualItems<T>(previous: readonly T[] | undefined, next: readonly T[] | undefined, equal: (left: T, right: T) => boolean): readonly T[] | undefined {
    if (!previous || !next || previous === next) return next;
    let changed = previous.length !== next.length;
    const merged = next.map((item, index) => {
        const old = previous[index];
        if (index < previous.length && equal(old, item)) return old;
        changed = true;
        return item;
    });
    return changed ? merged : previous;
}

/**
 * 画布每次选中、拖动结束或编辑都会重新发布上下文，其中大部分字段并没有变。
 * 这里把内容相同的数组和整份上下文换回旧引用，面板只在真正用到的字段变化时才重渲染。
 */
function stabilizeCanvasContext(previous: AgentCanvasContext | null, next: AgentCanvasContext | null): AgentCanvasContext | null {
    if (!previous || !next || previous.canvasId !== next.canvasId) return next;
    const stable: AgentCanvasContext = {
        ...next,
        references: reuseEqualItems(previous.references, next.references, sameRecord) as CanvasResourceReference[],
        selectedNodeIds: reuseEqualItems(previous.selectedNodeIds, next.selectedNodeIds, Object.is) as string[],
    };
    return sameRecord(previous, stable) ? previous : stable;
}

let persistDockTimer: ReturnType<typeof setTimeout> | undefined;

// 拖动调宽时每帧都会更新，合并后再写本地存储。
function persistDockPreference(dock: AgentPanelDockPreference) {
    if (typeof localStorage === "undefined") return;
    clearTimeout(persistDockTimer);
    persistDockTimer = setTimeout(() => {
        try {
            localStorage.setItem(AGENT_PANEL_DOCK_KEY, JSON.stringify(dock));
        } catch (error) {
            console.warn("Agent 停靠偏好无法保存", error);
        }
    }, 150);
}

export const useGlobalAgentStore = create<GlobalAgentStore>()((set, get) => ({
    open: false,
    canvas: null,
    dock: readDockPreference(),
    openAgent: () => set({ open: true }),
    closeAgent: () => set({ open: false }),
    setCanvas: (canvas) =>
        set((state) => {
            const next = stabilizeCanvasContext(state.canvas, canvas);
            // 返回同一个 state 时 zustand 不通知订阅者。
            return next === state.canvas ? state : { canvas: next };
        }),
    setDocked: (docked) => {
        const dock = { ...get().dock, docked };
        set({ dock });
        persistDockPreference(dock);
    },
    setDockWidth: (width) => {
        if (get().dock.width === width) return;
        const dock = { ...get().dock, width };
        set({ dock });
        persistDockPreference(dock);
    },
    reset: () => set({ open: false, canvas: null }),
}));
