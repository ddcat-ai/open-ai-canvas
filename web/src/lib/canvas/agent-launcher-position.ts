export type AgentLauncherPosition = { right: number; bottom: number };
export type AgentLauncherViewport = { width: number; height: number };
export type AgentLauncherGesture = { x: number; y: number; start: AgentLauncherPosition; dragged: boolean };

export const AGENT_LAUNCHER_POSITION_KEY = "canvas:agent-launcher-position:v1";
export const AGENT_LAUNCHER_SIZE = 76;
const MARGIN = 20; // Includes the label below the orb.

export function clampAgentLauncherPosition(position: AgentLauncherPosition, viewport: AgentLauncherViewport): AgentLauncherPosition {
    const clamp = (value: number, extent: number) => {
        const available = Math.max(0, extent - AGENT_LAUNCHER_SIZE);
        const margin = Math.min(MARGIN, available / 2);
        return Math.min(Math.max(value, margin), available - margin);
    };
    return { right: clamp(position.right, viewport.width), bottom: clamp(position.bottom, viewport.height) };
}

export function restoreAgentLauncherPosition(raw: string | null, viewport: AgentLauncherViewport): AgentLauncherPosition {
    if (raw) {
        try {
            const value = JSON.parse(raw);
            if (value && Number.isFinite(value.right) && Number.isFinite(value.bottom)) return clampAgentLauncherPosition(value, viewport);
        } catch {
            // Damaged UI preferences must not hide the launcher.
        }
    }
    return clampAgentLauncherPosition({ right: MARGIN, bottom: MARGIN }, viewport);
}

export function moveAgentLauncher(gesture: AgentLauncherGesture, x: number, y: number, viewport: AgentLauncherViewport) {
    const dx = x - gesture.x;
    const dy = y - gesture.y;
    const dragged = gesture.dragged || Math.hypot(dx, dy) >= 6;
    return {
        dragged,
        position: clampAgentLauncherPosition(dragged ? { right: gesture.start.right - dx, bottom: gesture.start.bottom - dy } : gesture.start, viewport),
    };
}
