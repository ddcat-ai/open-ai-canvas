import path from "node:path";

type Json = Record<string, unknown>;

export type CodexThreadClient = {
    startThread: (cwd?: string) => Promise<unknown>;
    resumeThread: (threadId: string, cwd?: string) => Promise<unknown>;
    readThread: (threadId: string, includeTurns?: boolean) => Promise<unknown>;
};

export type CodexThreadOptions = { threadId?: string; cwd?: string };

export async function resolveCodexThread(client: CodexThreadClient, options: CodexThreadOptions, currentThreadId = "") {
    const requestedThreadId = String(options.threadId || "");
    if (requestedThreadId) {
        // thread/start 会先返回尚未落盘的 ID；同一进程内应直接开始首轮，不能立即恢复它。
        if (requestedThreadId === currentThreadId) return requestedThreadId;
        try {
            const result = await client.readThread(requestedThreadId, false);
            assertCodexThreadWorkspace(field(result, "thread") || {}, options.cwd);
            const thread = await client.resumeThread(requestedThreadId, options.cwd);
            assertCodexThreadWorkspace(thread, options.cwd);
            return String(field(thread, "id") || requestedThreadId);
        } catch (error) {
            // Agent 可能在新会话首轮前重启；这种空会话没有用户内容，可以安全替换。
            if (!isUnmaterializedCodexThreadError(error)) throw error;
            return await startCodexThread(client, options.cwd);
        }
    }
    if (currentThreadId) return currentThreadId;
    return await startCodexThread(client, options.cwd);
}

export function assertCodexThreadWorkspace(thread: unknown, cwd?: string) {
    if (!cwd || codexThreadInWorkspace(thread, cwd)) return;
    throw new Error("该 Codex 会话不属于当前画布工作空间");
}

export function codexThreadInWorkspace(thread: unknown, cwd: string) {
    const threadCwd = String(field(thread, "cwd") || "");
    return Boolean(threadCwd && path.resolve(threadCwd) === path.resolve(cwd));
}

async function startCodexThread(client: CodexThreadClient, cwd?: string) {
    const thread = await client.startThread(cwd);
    const threadId = String(field(thread, "id") || "");
    if (!threadId) throw new Error("Codex app-server 没有返回 thread id");
    return threadId;
}

function isUnmaterializedCodexThreadError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /no rollout found for thread id|not materialized yet/i.test(message);
}

function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Json)[key] : undefined;
}
