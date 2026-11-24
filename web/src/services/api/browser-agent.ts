import { http } from "./request";
import { BROWSER_AGENT_PROTOCOL, type BrowserAgentRPC, type BrowserAgentState } from "@/services/agent/browser-agent-protocol";

export function listBrowserAgentRuns(signal: AbortSignal) {
    return http.get<string[]>("/agent/browser-runs", { signal, timeout: 15_000 });
}

export function requestBrowserAgentStep(message: BrowserAgentRPC, signal: AbortSignal) {
    const path = `/agent/runs/${encodeURIComponent(message.runId)}/runtime/`;
    if (message.method === "state") return http.get<BrowserAgentState>(path + "state", { signal, timeout: 15_000 });
    return http.post<BrowserAgentState>(path + message.method, { protocolVersion: BROWSER_AGENT_PROTOCOL, owner: message.owner, epoch: message.epoch, stepId: message.stepId }, { signal, timeout: 15_000 });
}
