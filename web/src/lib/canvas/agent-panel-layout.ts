export type AgentPanelLayout = { left: number; top: number; width: number; height: number };
export type AgentPanelViewport = { width: number; height: number };
export type AgentPanelGesture = "move" | "north" | "west" | "northwest";

// v2：默认窗口改为拉满顶栏下方的可用高度；v1 里每位用户都存过旧的 640px 窗口，换键让新默认生效。
export const AGENT_PANEL_LAYOUT_KEY = "canvas:agent-panel-layout:v2";
const MARGIN = 12;
/** 默认窗口从顶栏下方开始，不压住画布顶栏。 */
const DEFAULT_TOP = 72;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampAgentPanelLayout(layout: AgentPanelLayout, viewport: AgentPanelViewport): AgentPanelLayout {
    const maxWidth = Math.max(1, viewport.width - MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - MARGIN * 2);
    const width = clamp(layout.width, Math.min(360, maxWidth), maxWidth);
    const height = clamp(layout.height, Math.min(420, maxHeight), maxHeight);
    return {
        width,
        height,
        left: clamp(layout.left, MARGIN, Math.max(MARGIN, viewport.width - width - MARGIN)),
        top: clamp(layout.top, MARGIN, Math.max(MARGIN, viewport.height - height - MARGIN)),
    };
}

export function restoreAgentPanelLayout(raw: string | null, viewport: AgentPanelViewport): AgentPanelLayout {
    const fallback = defaultAgentPanelLayout(viewport);
    if (!raw) return clampAgentPanelLayout(fallback, viewport);
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && ["left", "top", "width", "height"].every((key) => typeof (parsed as Record<string, unknown>)[key] === "number" && Number.isFinite((parsed as Record<string, unknown>)[key]))) {
            return clampAgentPanelLayout(parsed as AgentPanelLayout, viewport);
        }
    } catch {
        // UI 偏好损坏不影响对话或服务端数据，恢复可见的默认窗口。
    }
    return clampAgentPanelLayout(fallback, viewport);
}

export function defaultAgentPanelLayout(viewport: AgentPanelViewport): AgentPanelLayout {
    const width = 420;
    const height = viewport.height - DEFAULT_TOP - MARGIN;
    return clampAgentPanelLayout({ width, height, left: viewport.width - width - MARGIN, top: DEFAULT_TOP }, viewport);
}

export function changeAgentPanelLayout(start: AgentPanelLayout, gesture: AgentPanelGesture, dx: number, dy: number, viewport: AgentPanelViewport): AgentPanelLayout {
    if (gesture === "move") return clampAgentPanelLayout({ ...start, left: start.left + dx, top: start.top + dy }, viewport);
    const right = start.left + start.width;
    const bottom = start.top + start.height;
    const left = gesture === "north" ? start.left : clamp(start.left + dx, MARGIN, right - Math.min(360, start.width));
    const top = gesture === "west" ? start.top : clamp(start.top + dy, MARGIN, bottom - Math.min(420, start.height));
    return { left, top, width: right - left, height: bottom - top };
}
