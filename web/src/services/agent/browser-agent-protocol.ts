export const BROWSER_AGENT_PROTOCOL = 1;

export type BrowserAgentState = {
    runtimeProtocolVersion: number;
    checkpointVersion: number;
    epoch: number;
    runtimeConnection: "connected" | "disconnected";
    status: string;
    revision: number;
    nextAction: { kind: "model" | "tool" | "compact" | "settle" | "wait_task" | "wait_user" | "wait_approval" | "done"; stepId?: string };
};
export type BrowserAgentMethod = "claim" | "state" | "heartbeat" | "step";
export type BrowserAgentRPC = { type: "rpc"; id: number; runId: string; method: BrowserAgentMethod; owner: string; epoch: number; stepId?: string };
export type BrowserAgentReply = { type: "reply"; id: number; state?: BrowserAgentState; error?: { status?: number; reason?: string } };
export type BrowserAgentFailureCode = "worker_load_failed" | "worker_crashed" | "worker_message_failed" | "worker_unhandled" | "runtime_request_failed" | "runtime_protocol_mismatch";
export type BrowserAgentFailure = { type: "failure"; code: BrowserAgentFailureCode; phase: BrowserAgentMethod | "startup" | "worker"; runId?: string; stepId?: string; epoch?: number; httpStatus?: number };
export type BrowserAgentWorkerMessage = BrowserAgentRPC | BrowserAgentFailure | { type: "finished"; runId: string };
