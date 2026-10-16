export type AgentPanelLayout = { left: number; top: number; width: number; height: number };
export type AgentPanelViewport = { width: number; height: number };
export type AgentPanelGesture = "move" | "north" | "west" | "northwest";

export const AGENT_PANEL_LAYOUT_KEY = "canvas:agent-panel-layout:v2";
const MARGIN = 12;
// 与画布 --canvas-topbar-offset 对齐，为顶部操作栏留出空间。
const TOP_INSET = 72;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampAgentPanelLayout(layout: AgentPanelLayout, viewport: AgentPanelViewport, minimumHeight = 420): AgentPanelLayout {
    const maxWidth = Math.max(1, viewport.width - MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - MARGIN * 2);
    const width = clamp(layout.width, Math.min(360, maxWidth), maxWidth);
    const height = clamp(layout.height, Math.min(minimumHeight, maxHeight), maxHeight);
    return {
        width,
        height,
        left: clamp(layout.left, MARGIN, Math.max(MARGIN, viewport.width - width - MARGIN)),
        top: clamp(layout.top, MARGIN, Math.max(MARGIN, viewport.height - height - MARGIN)),
    };
}

export function restoreAgentPanelLayout(raw: string | null, viewport: AgentPanelViewport): AgentPanelLayout {
    const fallback = defaultAgentPanelLayout(viewport);
    if (!raw) return fallback;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            const { layout, viewport: savedViewport } = parsed as { layout?: unknown; viewport?: unknown };
            if (
                layout &&
                typeof layout === "object" &&
                ["left", "top", "width", "height"].every((key) => typeof (layout as Record<string, unknown>)[key] === "number" && Number.isFinite((layout as Record<string, unknown>)[key])) &&
                savedViewport &&
                typeof savedViewport === "object" &&
                ["width", "height"].every((key) => typeof (savedViewport as Record<string, unknown>)[key] === "number" && Number.isFinite((savedViewport as Record<string, unknown>)[key]) && (savedViewport as Record<string, number>)[key] > 0)
            ) {
                return resizeAgentPanelLayout(layout as AgentPanelLayout, savedViewport as AgentPanelViewport, viewport);
            }
        }
    } catch {
        // UI 偏好损坏不影响对话或服务端数据，恢复可见的默认窗口。
    }
    return fallback;
}

export function defaultAgentPanelLayout(viewport: AgentPanelViewport): AgentPanelLayout {
    const width = 420;
    const height = viewport.height - TOP_INSET - MARGIN;
    // 默认满高优先为顶栏留出空间；短视口不强行撑到手动缩放的最小高度。
    return clampAgentPanelLayout({ width, height, left: viewport.width - width - MARGIN, top: TOP_INSET }, viewport, 1);
}

export function resizeAgentPanelLayout(layout: AgentPanelLayout, previousViewport: AgentPanelViewport, viewport: AgentPanelViewport): AgentPanelLayout {
    const previousDefault = defaultAgentPanelLayout(previousViewport);
    const nextDefault = defaultAgentPanelLayout(viewport);
    const fillsHeight = layout.top === previousDefault.top && layout.height === previousDefault.height;
    const anchoredRight = layout.left + layout.width === previousViewport.width - MARGIN;
    return clampAgentPanelLayout(
        {
            ...layout,
            left: anchoredRight ? viewport.width - layout.width - MARGIN : layout.left,
            top: fillsHeight ? nextDefault.top : layout.top,
            height: fillsHeight ? nextDefault.height : layout.height,
        },
        viewport,
        fillsHeight ? 1 : Math.min(420, Math.max(1, layout.height)),
    );
}

export function changeAgentPanelLayout(start: AgentPanelLayout, gesture: AgentPanelGesture, dx: number, dy: number, viewport: AgentPanelViewport): AgentPanelLayout {
    if (gesture === "move") return clampAgentPanelLayout({ ...start, left: start.left + dx, top: start.top + dy }, viewport, Math.min(420, Math.max(1, start.height)));
    const right = start.left + start.width;
    const bottom = start.top + start.height;
    const left = gesture === "north" ? start.left : clamp(start.left + dx, MARGIN, right - Math.min(360, start.width));
    const top = gesture === "west" ? start.top : clamp(start.top + dy, MARGIN, bottom - Math.min(420, start.height));
    return { left, top, width: right - left, height: bottom - top };
}
