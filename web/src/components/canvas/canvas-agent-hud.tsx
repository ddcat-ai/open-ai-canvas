import { LocateFixed, LocateOff } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

/**
 * 画布规模 HUD：节点与连线计数。Agent 批量搭建或生成时数字随增量一起涨，
 * 旁边的开关决定镜头是否跟随 Agent 的改动。
 */
export function CanvasAgentHud({ nodeCount, connectionCount, followAgent, onFollowAgentChange }: { nodeCount: number; connectionCount: number; followAgent: boolean; onFollowAgentChange: (value: boolean) => void }) {
    const theme = canvasThemes[useActiveTheme()];
    const FollowIcon = followAgent ? LocateFixed : LocateOff;
    return (
        <div className="canvas-agent-hud" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }} data-canvas-no-zoom>
            <span className="canvas-agent-hud-stat" aria-live="polite">
                节点 <strong style={{ color: theme.node.text }}>{nodeCount}</strong>
                <span aria-hidden="true"> · </span>
                连线 <strong style={{ color: theme.node.text }}>{connectionCount}</strong>
            </span>
            <button
                type="button"
                className="canvas-agent-hud-follow"
                aria-pressed={followAgent}
                title={followAgent ? "镜头跟随 Agent：开（点击关闭）" : "镜头跟随 Agent：关（点击开启）"}
                aria-label="镜头跟随 Agent"
                style={followAgent ? { color: theme.accent.primary } : undefined}
                onClick={() => onFollowAgentChange(!followAgent)}
            >
                <FollowIcon className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}
