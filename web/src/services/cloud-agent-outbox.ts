// Agent 排队消息的本机存储：按账号、按对话一份，不进对话快照，也不上云。
// 键与对话历史、待确认提交同一前缀（cloud-agent-conversations-v2:outbox:<对话 ID>），写入按对话串行。

import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { EMPTY_AGENT_OUTBOX, parseAgentOutbox, type AgentOutbox } from "@/lib/canvas/agent-outbox";

const OUTBOX_KEY_PREFIX = "cloud-agent-conversations-v2:outbox:";

function outboxStorageKey(conversationId: string) {
    return `${OUTBOX_KEY_PREFIX}${encodeURIComponent(conversationId)}`;
}

/** 读出某个对话的排队消息；没有记录返回 null。记录损坏时抛错，由调用方提示，不当成空队列静默吞掉。 */
export async function loadCloudAgentOutbox(conversationId: string, scope = getActiveUserScope()): Promise<AgentOutbox | null> {
    if (!conversationId) return null;
    const value = await localForageStorageForScope(scope).getItem(outboxStorageKey(conversationId));
    if (value === null || value === undefined) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("本机排队记录已损坏");
    }
    const outbox = parseAgentOutbox(parsed);
    if (!outbox) throw new Error("本机排队记录格式无效");
    return outbox;
}

const outboxWrites = new Map<string, Promise<unknown>>();

/** 保存排队消息；空队列直接删除记录。同一对话的写入串行：后发的快照不会被先发的覆盖。 */
export async function saveCloudAgentOutbox(conversationId: string, outbox: AgentOutbox, scope = getActiveUserScope()) {
    if (!conversationId) throw new Error("缺少 Agent 对话范围，无法保存排队消息");
    const key = `${scope}\u0000${conversationId}`;
    const storage = localForageStorageForScope(scope);
    const write = (outboxWrites.get(key) || Promise.resolve()).catch(() => undefined).then(() => (outbox.items.length ? storage.setItem(outboxStorageKey(conversationId), JSON.stringify(outbox)) : storage.removeItem(outboxStorageKey(conversationId))));
    outboxWrites.set(key, write);
    try {
        await write;
    } finally {
        if (outboxWrites.get(key) === write) outboxWrites.delete(key);
    }
}

export async function clearCloudAgentOutbox(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return;
    await saveCloudAgentOutbox(conversationId, EMPTY_AGENT_OUTBOX, scope);
}
