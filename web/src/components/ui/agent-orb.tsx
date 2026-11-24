import { FluidOrb } from "@/components/ui/fluid-orb";
import type { ThemeAgentOrbState } from "@/themes/types";
import { useThemePack } from "@/themes/use-theme-pack";

export type AgentOrbState = ThemeAgentOrbState;

/** 「工作中」对应运行和排队；「完成」对应已完成；其余（待命、等审批、失败、取消）都按待命画。 */
export function agentOrbStateForAvatar(avatarState: string): AgentOrbState {
    if (avatarState === "running" || avatarState === "queued") return "work";
    if (avatarState === "completed") return "done";
    return "idle";
}

/** 助手圆球：当前皮肤的主题包带了助手形象就用它，否则用上游流光球。 */
export function AgentOrb({ size = 60, state = "idle", color, className }: { size?: number; state?: AgentOrbState; color?: string; className?: string }) {
    const ThemeOrb = useThemePack()?.agentOrb;
    return ThemeOrb ? <ThemeOrb size={size} state={state} className={className} /> : <FluidOrb size={size} color={color} className={className} />;
}
