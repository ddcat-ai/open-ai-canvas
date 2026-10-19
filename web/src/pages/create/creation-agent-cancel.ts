import { cancelAgentRun, getAgentRun, type AgentRun } from "@/services/api/agent";
import { retryApiRead } from "@/services/api/request";
import type { CreationConversation } from "./creation-types";

export function creationAgentRunsToStop(conversation: CreationConversation): string[] {
    return (conversation.agentRuns || []).filter((run) => run.cleanupPending || ["queued", "running", "waiting_approval"].includes(run.status)).map((run) => run.id);
}

export async function stopCreationAgentRuns(conversation: CreationConversation, onRun: (run: AgentRun) => void) {
    const results = await Promise.allSettled(
        creationAgentRunsToStop(conversation).map(async (id) => {
            const result = await cancelAgentRun(id);
            if (!result.accepted) throw new Error("停止请求未被接受，请重试");
            const { run } = await retryApiRead(() => getAgentRun(id));
            if (run.sessionId !== conversation.agentSessionId || run.canvasId || run.surface !== "creation") throw new Error("停止结果不属于当前首页会话");
            onRun(run);
            if (run.cleanupPending || ["queued", "running", "waiting_approval"].includes(run.status)) throw new Error("Agent 正在停止，请稍后再试");
        }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
}
