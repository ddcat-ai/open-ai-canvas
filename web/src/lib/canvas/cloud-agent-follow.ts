import type { AgentRun } from "@/services/api/agent";
import { cloudAgentConversationServerId, type CloudAgentConversation } from "@/services/cloud-agent-conversations";

export function cloudAgentRunIsActive(run: AgentRun | null | undefined) {
    return Boolean(run?.cleanupPending || (run && ["queued", "running", "waiting_approval"].includes(run.status)));
}

export function canvasCloudAgentConversation(conversations: CloudAgentConversation[], canvasId: string, leaseRunId?: string) {
    if (!canvasId) return undefined;
    const matching = conversations.filter((item) => cloudAgentConversationServerId(item) && (item.run?.canvasId === canvasId || item.runs?.some((run) => run.canvasId === canvasId)));
    return matching.find((item) => item.run?.id === leaseRunId) || matching.find((item) => cloudAgentRunIsActive(item.run)) || [...matching].sort((a, b) => (b.run?.updatedAt || b.updatedAt).localeCompare(a.run?.updatedAt || a.updatedAt))[0];
}

export function cloudAgentFollowDecision(input: { current: CloudAgentConversation; candidate: CloudAgentConversation | undefined; canvasId: string; blocked: boolean }): "none" | "current" | "switch" | "offer" {
    const { current, candidate, canvasId, blocked } = input;
    if (!candidate) return "none";
    const identity = cloudAgentConversationServerId(current);
    if (current.id === candidate.id || (identity && identity === cloudAgentConversationServerId(candidate))) return blocked ? "none" : "current";
    if (blocked || current.draft?.trim() || cloudAgentRunIsActive(current.run) || current.localNewCanvasId || current.localSelectedCanvasId) return "offer";
    if ((!current.run && !current.messages.length) || current.run?.canvasId === canvasId) return "switch";
    return "offer";
}
