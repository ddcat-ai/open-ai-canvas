import { create } from "zustand";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[] } };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";

type CanvasAgentStore = {
    width: number;
    connected: boolean;
    enabled: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    activity: string;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    setAgentState: (patch: Partial<Omit<CanvasAgentStore, "setAgentState" | "addMessage" | "addEventLog" | "clearEventLogs">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

const CANVAS_AGENT_ENABLED_STORAGE_KEY = "canvas-agent-enabled";

type CanvasAgentPreferenceStorage = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

export function readCanvasAgentEnabledPreference(storage: Pick<CanvasAgentPreferenceStorage, "getItem"> | undefined = browserPreferenceStorage()) {
    try {
        return storage?.getItem(CANVAS_AGENT_ENABLED_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

export function writeCanvasAgentEnabledPreference(enabled: boolean, storage: Pick<CanvasAgentPreferenceStorage, "setItem"> | undefined = browserPreferenceStorage()) {
    try {
        storage?.setItem(CANVAS_AGENT_ENABLED_STORAGE_KEY, String(enabled));
    } catch {
        // 浏览器隐私模式可能拒绝本地偏好写入；连接本身仍可继续。
    }
}

export function canvasAgentConnectionStartingPatch() {
    return { enabled: true, connected: false, activity: "连接中", connectError: "", activeTab: "chat" as const };
}

export function canvasAgentTransientDisconnectPatch(activity: string, connectError: string) {
    return { enabled: true, connected: false, activity, connectError, waiting: false, sending: false };
}

export function canvasAgentConnectionStatusText({ enabled, connected, activity, connectError }: Pick<CanvasAgentStore, "enabled" | "connected" | "activity" | "connectError">) {
    if (enabled && !connected && activity === "正在重连") return activity;
    return connectError ? "连接失败" : connected ? activity : enabled ? "连接中" : "未连接";
}

function browserPreferenceStorage(): CanvasAgentPreferenceStorage | undefined {
    return typeof window === "undefined" ? undefined : window.localStorage;
}

export const useCanvasAgentStore = create<CanvasAgentStore>((set) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    connected: false,
    enabled: readCanvasAgentEnabledPreference(),
    prompt: "",
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "chat",
    confirmTools: true,
    activity: "就绪",
    connectError: "",
    pendingTool: null,
    setAgentState: (patch) => {
        if (typeof patch.enabled === "boolean") writeCanvasAgentEnabledPreference(patch.enabled);
        set(patch);
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
