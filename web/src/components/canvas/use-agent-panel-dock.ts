import { useSyncExternalStore } from "react";

import { AGENT_DOCK_MIN_VIEWPORT, agentDockWidthBounds, clampAgentDockWidth } from "@/lib/canvas/agent-panel-dock";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

function subscribeViewport(onChange: () => void) {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
}

const viewportWidth = () => window.innerWidth;
const serverViewportWidth = () => 0;

/**
 * Agent 面板是否停靠在画布右侧。工作区布局和面板共用这一份判断，保证画布让出的宽度
 * 与面板宽度一致：只有在画布里、面板打开、用户选择停靠且视口足够宽时才生效。
 */
export function useAgentPanelDock() {
    const open = useGlobalAgentStore((state) => state.open);
    const onCanvas = useGlobalAgentStore((state) => state.canvas !== null);
    const docked = useGlobalAgentStore((state) => state.dock.docked);
    const storedWidth = useGlobalAgentStore((state) => state.dock.width);
    const width = useSyncExternalStore(subscribeViewport, viewportWidth, serverViewportWidth);
    const available = onCanvas && width >= AGENT_DOCK_MIN_VIEWPORT;
    return {
        /** 当前页面可以停靠（在画布里且视口够宽）。 */
        available,
        /** 正在停靠：面板贴右侧全高，工作区让出 width。 */
        active: open && docked && available,
        width: clampAgentDockWidth(storedWidth, width),
        bounds: agentDockWidthBounds(width),
    };
}
