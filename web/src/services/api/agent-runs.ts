import { apiClient, request } from "@/services/api/request";

export type AgentRunStatus = "running" | "completed" | "failed";

export type AgentRun = {
    id: string;
    userId: string;
    projectId: string;
    agentKind: string;
    threadId?: string;
    status: AgentRunStatus;
    inputSummary?: string;
    errorMessage?: string;
    startedAt: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export async function startAgentRun(projectId: string, agentKind: string, inputSummary: string) {
    return request<{ run: AgentRun }>(
        apiClient.post("/agent-runs", { projectId, agentKind, inputSummary }),
    );
}

export async function completeAgentRun(runId: string, threadId?: string) {
    return request<{ run: AgentRun }>(
        apiClient.post(`/agent-runs/${encodeURIComponent(runId)}/complete`, { threadId }),
    );
}

export async function failAgentRun(runId: string, errorMessage: string, threadId?: string) {
    return request<{ run: AgentRun }>(
        apiClient.post(`/agent-runs/${encodeURIComponent(runId)}/fail`, { errorMessage, threadId }),
    );
}

export async function getAgentRun(runId: string) {
    return request<{ run: AgentRun }>(
        apiClient.get(`/agent-runs/${encodeURIComponent(runId)}`),
    );
}
