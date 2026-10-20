export type CanvasAppearance = {
    agentName: string;
    launcherLabel: string;
    panelTitle: string;
    welcomeTitle: string;
    welcomeDescription: string;
    inputPlaceholder: string;
    avatarType: "orb" | "live2d" | "bundle";
    live2dResourceId: string;
    live2dEntry: string;
    avatarBundleResourceId: string;
    avatarClipStates?: Partial<Record<AgentAvatarState, string>>;
    avatarHeight: number;
};

export type AgentAvatarState = "idle" | "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "rejected";
export const AGENT_AVATAR_STATES: { id: AgentAvatarState; label: string }[] = [
    { id: "idle", label: "待命" },
    { id: "queued", label: "排队中" },
    { id: "running", label: "运行中" },
    { id: "waiting_approval", label: "等待审批" },
    { id: "completed", label: "已完成" },
    { id: "failed", label: "异常" },
    { id: "cancelled", label: "已停止" },
    { id: "rejected", label: "已拒绝" },
];

export type AgentAvatarBundleManifest = {
    version: 1;
    width: number;
    height: number;
    clips: Record<string, string>;
};

export const DEFAULT_AGENT_AVATAR_CLIP_STATES: Record<AgentAvatarState, string> = {
    idle: "idle",
    queued: "sleep_loop",
    running: "working_loop",
    waiting_approval: "think",
    completed: "wave",
    failed: "wipe_sweat",
    cancelled: "lie_down",
    rejected: "think",
};

export function isAgentAvatarBundleManifest(value: unknown): value is AgentAvatarBundleManifest {
    if (typeof value !== "object" || value === null) return false;
    const manifest = value as Record<string, unknown>;
    if (manifest.version !== 1 || !Number.isInteger(manifest.width) || !Number.isInteger(manifest.height)) return false;
    const width = Number(manifest.width);
    const height = Number(manifest.height);
    if (width < 1 || width > 4096 || height < 1 || height > 4096 || typeof manifest.clips !== "object" || manifest.clips === null) return false;
    const clips = manifest.clips as Record<string, unknown>;
    return Object.keys(clips).length > 0 && Object.keys(clips).length <= 64 && Object.entries(clips).every(([id, file]) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && typeof file === "string" && /^[A-Za-z0-9._-]{1,124}\.mp4$/i.test(file));
}

export function agentAvatarClipForState(appearance: CanvasAppearance, state: AgentAvatarState, manifest: AgentAvatarBundleManifest) {
    const preferred = appearance.avatarClipStates?.[state] || DEFAULT_AGENT_AVATAR_CLIP_STATES[state];
    if (manifest.clips[preferred]) return preferred;
    if (manifest.clips.idle) return "idle";
    return Object.keys(manifest.clips)[0] ?? "";
}

export function agentAvatarStateForRunStatus(status: string): AgentAvatarState {
    return AGENT_AVATAR_STATES.some((state) => state.id === status) ? (status as AgentAvatarState) : "idle";
}

export function suggestedAgentAvatarClipStates(manifest: AgentAvatarBundleManifest): Record<AgentAvatarState, string> {
    const byNormalizedName = new Map(Object.keys(manifest.clips).map((clip) => [clip.toLowerCase().replace(/[^a-z0-9]/g, ""), clip]));
    const fallback = Object.keys(manifest.clips)[0] ?? "";
    const suggest = (candidates: string[]) => candidates.map((name) => byNormalizedName.get(name)).find(Boolean) || (manifest.clips.idle ? "idle" : fallback);
    return {
        idle: suggest(["idle", "idleloop"]),
        queued: suggest(["queued", "pending", "sleeploop", "sleep", "think", "idle"]),
        running: suggest(["workingloop", "runningloop", "working", "running", "workstart", "work"]),
        waiting_approval: suggest(["think", "thinking", "waiting", "wait", "idle"]),
        completed: suggest(["wave", "celebrate", "completed", "complete", "jump"]),
        failed: suggest(["wipesweat", "failed", "failure", "error", "think"]),
        cancelled: suggest(["cancelled", "canceled", "liedown", "sleep", "idle"]),
        rejected: suggest(["rejected", "think", "wipesweat", "idle"]),
    };
}

export const DEFAULT_CANVAS_APPEARANCE: CanvasAppearance = {
    agentName: "影策",
    launcherLabel: "Agent",
    panelTitle: "画布助手",
    welcomeTitle: "在这里，和{agentName}让灵感，慢慢成形",
    welcomeDescription: "从一个想法开始，和{agentName}一起创作。",
    inputPlaceholder: "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills",
    avatarType: "bundle",
    live2dResourceId: "",
    live2dEntry: "",
    avatarBundleResourceId: "",
    avatarClipStates: {
        idle: "idle",
        queued: "sleep_loop",
        running: "working_loop",
        waiting_approval: "think",
        completed: "wave",
        failed: "wipe_sweat",
        cancelled: "lie_down",
        rejected: "think",
    },
    avatarHeight: 220,
};

export function agentCopy(template: string, name: string) {
    return template.replaceAll("{agentName}", () => name);
}
