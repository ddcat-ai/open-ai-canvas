import { expect, test } from "bun:test";
import * as state from "../src/pages/create/creation-conversations";
import type { CreationConversation } from "../src/pages/create/creation-types";

const existing: CreationConversation = { id: "existing-image", title: "已有创作", updatedAt: "2026-10-02T10:00:00Z", messages: [{ id: "user-image", role: "user", mode: "image", content: "生成原图片", createdAt: "2026-10-02T10:00:00Z" }, { id: "result-image", role: "assistant", mode: "image", content: "", createdAt: "2026-10-02T10:01:00Z", status: "done", taskIds: ["image-task"], resultStorageKeys: ["resource:image"] }] };

test("已有图片会话切 Agent、视频再切回时保持 ID、消息、任务和 Agent 归属", () => {
    const agent = (state as any).selectCreationConversationMode?.(existing, "agent");
    expect(agent?.id).toBe(existing.id);
    expect(agent?.messages).toBe(existing.messages);
    const attached = { ...agent, agentSessionId: "creation-session", agentRunId: "creation-run" };
    const video = (state as any).selectCreationConversationMode?.(attached, "video");
    expect(video).toMatchObject({ id: existing.id, composerMode: "video", agentSessionId: "creation-session", agentRunId: "creation-run" });
    expect(video?.messages).toBe(existing.messages);
    expect((state as any).creationConversationMode?.(video)).toBe("video");
    const returned = (state as any).selectCreationConversationMode?.(video, "agent");
    expect(returned?.messages).toBe(existing.messages);
    expect(returned?.agentSessionId).toBe("creation-session");
});

test("历史选择恢复已选模式，旧文本记录使用 Agent 而不生成新会话", () => {
    expect((state as any).creationConversationMode?.(existing)).toBe("image");
    expect((state as any).creationConversationMode?.({ ...existing, composerMode: "video", agentSessionId: "creation-session" })).toBe("video");
    expect((state as any).creationConversationMode?.({ ...existing, messages: [{ ...existing.messages[0], mode: "text" }] })).toBe("agent");
});
