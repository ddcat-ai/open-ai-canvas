export type AgentLauncherPosition = { right: number; bottom: number };
export type AgentLauncherViewport = { width: number; height: number };
export type AgentLauncherGesture = { x: number; y: number; start: AgentLauncherPosition; dragged: boolean };

export const AGENT_LAUNCHER_POSITION_KEY = "canvas:agent-launcher-position:v1";
export const AGENT_LAUNCHER_SIZE = 76;
const MARGIN = 20; // Includes the label below the orb.
const LAUNCHER_LABEL_CLEARANCE = 40;
/** 画布编辑器以外的页面和窄屏上，大形象会压住页面右下角的按钮，高度封顶到这个值。 */
export const AGENT_LAUNCHER_COMPACT_AVATAR_HEIGHT = 120;
export const AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH = 768;

/** 大形象（Live2D / 动画包）的入口高度：受外观设置、视口和宽高比约束，离开画布编辑器或窄屏时再封顶。 */
export function resolveAgentLauncherAvatarHeight(preferred: number, aspectRatio: number, viewport: AgentLauncherViewport, inCanvasEditor: boolean) {
    const compact = !inCanvasEditor || viewport.width < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH;
    return Math.max(40, Math.min(preferred, viewport.height - 60, (viewport.width - 40) / aspectRatio, compact ? AGENT_LAUNCHER_COMPACT_AVATAR_HEIGHT : Infinity));
}

export function clampAgentLauncherPosition(position: AgentLauncherPosition, viewport: AgentLauncherViewport, size = { width: AGENT_LAUNCHER_SIZE, height: AGENT_LAUNCHER_SIZE }): AgentLauncherPosition {
    const clamp = (value: number, extent: number, dimension: number) => {
        const available = Math.max(0, extent - dimension);
        const margin = Math.min(MARGIN, available / 2);
        return Math.min(Math.max(value, margin), available - margin);
    };
    return { right: clamp(position.right, viewport.width, size.width), bottom: clamp(position.bottom, viewport.height, size.height) };
}

export function restoreAgentLauncherPosition(raw: string | null, viewport: AgentLauncherViewport, size?: AgentLauncherViewport, inCanvasEditor = true): AgentLauncherPosition {
    if (raw) {
        try {
            const value = JSON.parse(raw);
            if (value && Number.isFinite(value.right) && Number.isFinite(value.bottom)) return clampAgentLauncherPosition(value, viewport, size);
        } catch {
            // Damaged UI preferences must not hide the launcher.
        }
    }
    const footerClearance = viewport.width < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH ? 144 : 80;
    return clampAgentLauncherPosition({ right: MARGIN, bottom: inCanvasEditor ? MARGIN : footerClearance + LAUNCHER_LABEL_CLEARANCE }, viewport, size);
}

export function moveAgentLauncher(gesture: AgentLauncherGesture, x: number, y: number, viewport: AgentLauncherViewport, size?: AgentLauncherViewport) {
    const dx = x - gesture.x;
    const dy = y - gesture.y;
    const dragged = gesture.dragged || Math.hypot(dx, dy) >= 6;
    return {
        dragged,
        position: clampAgentLauncherPosition(dragged ? { right: gesture.start.right - dx, bottom: gesture.start.bottom - dy } : gesture.start, viewport, size),
    };
}
