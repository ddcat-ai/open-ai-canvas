type RetryStatus = "retrying" | "recovered" | "exhausted";
export type AgentToolRetry = { groupId: string; attempt: number; maxAttempts: number; status: RetryStatus };
type RetryMessage = { id: string; role: string; title?: string; text: string; detail?: unknown };
export type AgentToolRetryAttempt = { id: string; text: string; detail: unknown };

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function agentToolRetry(detail: unknown): AgentToolRetry | undefined {
    const retry = record(record(detail).retry);
    if (
        typeof retry.groupId !== "string" ||
        !retry.groupId ||
        typeof retry.attempt !== "number" ||
        !Number.isInteger(retry.attempt) ||
        retry.attempt < 1 ||
        typeof retry.maxAttempts !== "number" ||
        !Number.isInteger(retry.maxAttempts) ||
        retry.maxAttempts < retry.attempt
    )
        return;
    if (retry.status !== "retrying" && retry.status !== "recovered" && retry.status !== "exhausted") return;
    return retry as AgentToolRetry;
}

// Run-scoped group IDs and event IDs keep SSE replay idempotent. Successful
// calls retain their ordinary result card; only failed attempts are folded.
export function mergeAgentToolRetry<T extends RetryMessage>(messages: T[], message: T): T[] {
    const retry = agentToolRetry(message.detail);
    if (!retry) return messages;
    const id = `tool-retry:${retry.groupId}`;
    const index = messages.findIndex((item) => item.id === id);
    const previous = index >= 0 ? messages[index] : undefined;
    const previousDetail = record(previous?.detail);
    const attempts: AgentToolRetryAttempt[] = Array.isArray(previousDetail.retryAttempts) ? [...previousDetail.retryAttempts] : [];
    if (retry.status !== "recovered" && !attempts.some((item) => item.id === message.id)) attempts.push({ id: message.id, text: message.text, detail: message.detail });
    const previousRetry = agentToolRetry(previous?.detail);
    // An old failed event must not undo a later recovery during reconnection.
    const previousIsFinal = previousRetry?.status === "recovered" || previousRetry?.status === "exhausted";
    const latest = previousRetry && (previousIsFinal || previousRetry.attempt > retry.attempt) ? previousRetry : retry;
    const group = { ...message, id, detail: { ...record(message.detail), retry: latest, retryAttempts: attempts } };
    if (index < 0) return [...messages, group];
    return messages.map((item, itemIndex) => (itemIndex === index ? group : item));
}
