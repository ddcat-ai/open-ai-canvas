import { expect, test } from "bun:test";
import { appendCreationAgentEvent, beginCreationAgentSubmission, mergeCreationAgentConversation, mergeCreationConversationHistory, projectCreationAgentConversation, settleCreationAgentSubmission } from "../src/pages/create/creation-agent-conversation";
import type { AgentRun, AgentSession } from "../src/services/api/agent";
import type { CreationAttachment, CreationConversation } from "../src/pages/create/creation-types";

const at = "2026-10-20T09:00:00Z";
const session: AgentSession = { id: "session", title: "连续创作", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
const upload: CreationAttachment = { id: "upload:new", storageKey: "resource:new", name: "本轮上传", type: "image/png", bytes: 12, url: "blob:new", previewUrl: "blob:preview" };
const historical: CreationAttachment = { ...upload, id: "resource:old", storageKey: "resource:old", name: "历史图片" };
const record = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    id: "run",
    sessionId: session.id,
    canvasId: "",
    surface: "creation",
    userPrompt: "重新设计文案",
    status: "running",
    permissionMode: "auto",
    createdAt: at,
    updatedAt: at,
    events: [],
    attachments: [
        { resourceId: "old", storageKey: "resource:old", name: "历史图片", kind: "image", role: "reference", turnIndex: 0 },
        { resourceId: "legacy", storageKey: "resource:legacy", name: "后台引用", kind: "image", role: "reference" },
        { resourceId: "new", storageKey: "resource:new", name: "本轮上传", kind: "image", role: "reference", turnIndex: 1 },
    ],
    ...overrides,
});
const userAttachments = (value: CreationConversation) => value.messages.find((message) => message.id === "user-run")?.attachments;

test("历史授权素材只供后台引用，消息仅展示本轮主动上传，正常文字仍流式更新", () => {
    const projected = projectCreationAgentConversation(session, [record()]);
    expect(userAttachments(projected)?.map((item) => item.storageKey)).toEqual(["resource:new"]);
    const streamed = appendCreationAgentEvent(projected, { eventId: "run:1", runId: "run", seq: 1, type: "assistant_delta", payload: { messageId: "answer", text: "我会根据你刚才的方案调整文案。" }, createdAt: at });
    expect(userAttachments(streamed)?.map((item) => item.storageKey)).toEqual(["resource:new"]);
    expect(streamed.messages.find((message) => message.role === "assistant")?.content).toBe("我会根据你刚才的方案调整文案。");
    expect(streamed.agentRuns?.[0].attachments).toHaveLength(3);
});

test("没有主动上传的本轮不会回显后台继承或意图选中的历史图片", () => {
    const projected = projectCreationAgentConversation(session, [record({ attachments: record().attachments?.slice(0, 2) })]);
    expect(userAttachments(projected) || []).toEqual([]);
});

test("合并历史清除旧缓存误显示的附件，保留本轮上传的本地预览和其他模式消息", () => {
    const remote = projectCreationAgentConversation(session, [record()]);
    const local: CreationConversation = {
        ...remote,
        messages: [...remote.messages.map((message) => (message.role === "user" ? { ...message, attachments: [historical, upload] } : message)), { id: "direct", role: "user", mode: "image", content: "普通生图", createdAt: at, attachments: [historical] }],
    };
    const merged = mergeCreationAgentConversation(local, remote);
    expect(userAttachments(merged)).toEqual([expect.objectContaining({ id: upload.id, storageKey: upload.storageKey, url: upload.url, previewUrl: upload.previewUrl })]);
    expect(merged.messages.find((message) => message.id === "direct")?.attachments).toEqual([historical]);
    const empty = projectCreationAgentConversation(session, [record({ attachments: [] })]);
    expect(userAttachments(mergeCreationAgentConversation(local, empty)) || []).toEqual([]);
});

test("仅本地缓存恢复也清除继承附件，避免再次编辑消息时自动填入素材区", () => {
    const projected = projectCreationAgentConversation(session, [record()]);
    const cached = { ...projected, messages: projected.messages.map((message) => (message.role === "user" ? { ...message, attachments: [historical, upload] } : message)) };
    const restored = mergeCreationConversationHistory([cached], []).conversations[0];
    expect(userAttachments(restored)).toEqual([expect.objectContaining({ id: upload.id, storageKey: upload.storageKey, url: upload.url })]);
});

test("提交回执只回显真实上传，后台静默引用不会变成本轮用户附件", () => {
    const local: CreationConversation = { id: "local", title: "连续创作", updatedAt: at, messages: [] };
    const pending = beginCreationAgentSubmission(local, { id: "submit", prompt: "重新设计文案", createdAt: at, attachments: [upload] });
    const incoming = projectCreationAgentConversation(session, [record()]);
    expect(userAttachments(settleCreationAgentSubmission(pending, incoming, "submit"))).toEqual([expect.objectContaining({ id: upload.id, storageKey: upload.storageKey, url: upload.url })]);
    const empty = beginCreationAgentSubmission(local, { id: "submit", prompt: "继续之前的设计", createdAt: at, attachments: [] });
    const inherited = projectCreationAgentConversation(session, [record({ attachments: record().attachments?.slice(0, 2) })]);
    expect(userAttachments(settleCreationAgentSubmission(empty, inherited, "submit")) || []).toEqual([]);
});

test("按幂等键确认乐观提交不会把后台历史附件补进原用户消息", () => {
    const pending = beginCreationAgentSubmission({ id: "local", title: "连续创作", updatedAt: at, messages: [] }, { id: "submit", prompt: "继续之前的设计", createdAt: at, attachments: [] });
    const keyed = { ...pending, messages: pending.messages.map((message) => ({ ...message, agentIdempotencyKey: "key" })) };
    const incoming = projectCreationAgentConversation(session, [record({ idempotencyKey: "key", attachments: record().attachments?.slice(0, 2) })]);
    expect(userAttachments(mergeCreationAgentConversation(keyed, incoming)) || []).toEqual([]);
});

test("用户手动重新选择同一历史素材仍按本轮上传正常回显", () => {
    const projected = projectCreationAgentConversation(session, [record({ attachments: [{ resourceId: "old", storageKey: "resource:old", name: "手动选中", kind: "image", role: "reference", turnIndex: 1 }] })]);
    expect(userAttachments(projected)?.map((item) => item.storageKey)).toEqual(["resource:old"]);
});

test("仅主动上传的 Agent 消息保留空正文，回执、流式及历史恢复不丢用户气泡", async () => {
    const pending = beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, messages: [] }, { id: "submit", prompt: "", attachments: [upload], createdAt: at });
    expect(pending.title).toBe(upload.name);
    expect(pending.messages[0]).toMatchObject({ role: "user", content: "", attachments: [upload] });
    const remote = projectCreationAgentConversation({ ...session, title: "" }, [record({ userPrompt: "" })]);
    expect(remote.title).toBe(upload.name);
    expect(remote.messages.find((message) => message.role === "user")).toMatchObject({ content: "", attachments: [expect.objectContaining({ storageKey: upload.storageKey })] });
    const settled = settleCreationAgentSubmission(pending, remote, "submit");
    expect(settled.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(userAttachments(settled)?.[0].url).toBe(upload.url);
    const streamed = appendCreationAgentEvent(settled, { runId: "run", seq: 1, eventId: "run:1", type: "assistant_delta", payload: { messageId: "answer", text: "按之前约定继续" }, createdAt: at });
    const restored = mergeCreationConversationHistory([JSON.parse(JSON.stringify(streamed))], [remote]).conversations[0];
    expect(restored.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(userAttachments(restored)?.map((item) => item.storageKey)).toEqual(["resource:new"]);
    expect(restored.messages.find((message) => message.role === "assistant")?.content).toBe("按之前约定继续");
});

test("后台继承附件不会为无正文轮次制造用户消息，静默重试仍不插入用户气泡", () => {
    for (const value of [record({ userPrompt: "", attachments: record().attachments?.slice(0, 2) }), record({ userPrompt: "", retry: { runId: "original" } })]) {
        expect(projectCreationAgentConversation(session, [value]).messages.filter((message) => message.role === "user")).toEqual([]);
    }
});
