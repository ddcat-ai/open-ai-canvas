import { expect, test } from "bun:test";
import { createCreationHistoryWriter, creationConversationPath, creationHistoryInput, mergeCreationStoredHistory } from "../src/pages/create/creation-conversation-history";
import { mergeCreationAgentConversation, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import type { CreationConversation } from "../src/pages/create/creation-types";
import type { CreationHistoryInput } from "../src/services/api/creation-history";
import { bindCreationSubmissionTask } from "../src/pages/create/creation-conversations";
import { displayCreationPrompt } from "../src/pages/create/creation-references";

const at = "2026-10-20T12:00:00.000Z";
const conversation: CreationConversation = {
    id: "local-conversation-123",
    title: "街景",
    updatedAt: at,
    messages: [
        {
            id: "user",
            role: "user",
            mode: "image",
            content: "生成街景",
            createdAt: at,
            attachments: [{ id: "ref", name: "参考", type: "image/png", storageKey: "resource:owned", url: "https://signed.invalid/private", previewUrl: "data:image/png;base64,private", bytes: 20 }],
        },
        { id: "result", role: "assistant", mode: "image", content: "browser text", createdAt: at, taskIds: ["street"], resultUrls: ["data:image/png;base64,private"], resultStorageKeys: ["resource:street"], clientOperationId: "operation" },
        { id: "agent-run:assistant", role: "assistant", mode: "agent", content: "原生正文", agentRunId: "agent-run", createdAt: at },
    ],
};

test("持久化普通历史只保存必要字段，不重复上传图片或伪造原生 Agent 正文", () => {
    const input = creationHistoryInput(conversation);
    expect(input.messages).toHaveLength(2);
    expect(input.messages[0].content).toBe("生成街景");
    expect(input.messages[1].content).toBe("");
    const serialized = JSON.stringify(input);
    expect(serialized).not.toMatch(/signed.invalid|base64|resultUrls|原生正文|agentRunId/);
    expect(input.messages[0].attachments?.[0].storageKey).toBe("resource:owned");
    expect(creationConversationPath(conversation)).toBe("/c/local-conversation-123");
    expect(creationConversationPath({ ...conversation, agentSessionId: "AGS_000030" })).toBe("/c/AGS_000030");
});

test("跨设备合并包含普通消息和原生轮次，旧本地缓存不会吞掉远端普通消息", () => {
    const agent = projectCreationAgentConversation({ id: "session", surface: "creation", title: "混合", status: "active", revision: 1, createdAt: at, updatedAt: at }, []);
    const restored = mergeCreationStoredHistory(agent, { version: 1, ...creationHistoryInput(conversation) });
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[1]).toMatchObject({ status: "pending", taskIds: ["street"], taskStatePending: true });
    const old = { ...agent, messages: [{ id: "older", role: "user" as const, mode: "image" as const, content: "旧设备", createdAt: at }] };
    const merged = mergeCreationAgentConversation(old, restored);
    expect(merged.messages.map((message) => message.id)).toEqual(["older", "user", "result"]);
    expect(merged.historySourceId).toBe(conversation.id);
});

test("任务回执的重试和批次投影不改写已保存消息，引用标签可以跨设备显示", () => {
    const before = { ...conversation, messages: [conversation.messages[1]] };
    const updated = bindCreationSubmissionTask(before.messages[0], { id: "street", retryOf: "old", attemptGroupId: "group" } as Parameters<typeof bindCreationSubmissionTask>[1]);
    expect(creationHistoryInput({ ...before, messages: [{ ...updated, batchId: "batch", batchTotal: 3 }] })).toEqual(creationHistoryInput(before));
    const referenced: CreationConversation = {
        ...conversation,
        messages: [
            { ...conversation.messages[0], content: "参考 @[skill:example] 创作", references: [{ id: "skill-example", nodeId: "skill-example", kind: "skill", label: "电影光效", title: "电影光效", mentionToken: "@[skill:example]", active: true }] },
        ],
    };
    const restored = mergeCreationStoredHistory({ ...conversation, agentSessionId: conversation.id, messages: [] }, { version: 1, ...creationHistoryInput(referenced) });
    expect(displayCreationPrompt(restored.messages[0].content, restored.messages[0].references || [])).toBe("参考 @电影光效 创作");
});

test("同会话串行保存、相同快照去重，并发创建使用稳定 ID", async () => {
    const creations: unknown[] = [],
        saves: CreationHistoryInput[] = [];
    const writer = createCreationHistoryWriter({
        getActiveUserScope: () => "user",
        createAgentSession: async (input) => {
            creations.push(input);
            return { session: { id: input.id!, surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at } };
        },
        saveCreationHistory: async (_id, input) => {
            saves.push(input);
            return { saved: true };
        },
    });
    const ids = await Promise.all([writer(conversation, "user"), writer(conversation, "user")]);
    expect(ids).toEqual([conversation.id, conversation.id]);
    expect(creations).toHaveLength(1);
    expect(saves).toHaveLength(1);
    await writer({ ...conversation, messages: [...conversation.messages, { id: "next", role: "user", mode: "image", content: "继续", createdAt: at }] }, "user");
    expect(saves).toHaveLength(2);
});

test("保存失败不会标记云端成功，账号切换后不再写入", async () => {
    let scope = "user",
        attempts = 0;
    const writer = createCreationHistoryWriter({
        getActiveUserScope: () => scope,
        createAgentSession: async () => {
            throw new Error("unexpected create");
        },
        saveCreationHistory: async () => {
            if (++attempts === 1) throw new Error("离线");
            return { saved: true };
        },
    });
    const bound = { ...conversation, agentSessionId: "session" };
    await expect(writer(bound, "user")).rejects.toThrow("离线");
    await expect(writer(bound, "user")).resolves.toBe("session");
    scope = "other";
    await expect(writer(bound, "user")).rejects.toThrow("账号已切换");
    expect(attempts).toBe(2);
});
