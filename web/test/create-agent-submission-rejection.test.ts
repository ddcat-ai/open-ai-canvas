import { expect, test } from "bun:test";
import * as conversationHelpers from "../src/pages/create/creation-agent-conversation";
import * as agentApi from "../src/services/api/agent";
import { buildCreationAgentRunInput } from "../src/pages/create/creation-agent-request";
import { createCreationSubmitGate } from "../src/pages/create/creation-submit-gate";
import { ApiError } from "../src/services/api/request";
import type { CreationConversation } from "../src/pages/create/creation-types";
import type { PendingCreationAgentSubmission } from "../src/services/creation-conversation-store";

// Exercise the real page submit closure and conversation reducers; isolate only
// transport, persistence and React setters, without registering module mocks.
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const start = source.indexOf("    const submitCreationAgent = async (");
const end = source.indexOf("\n    const decideCreationApproval", start);
if (start < 0 || end < 0) throw new Error("Agent submit closure not found");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const at = "2026-10-19T00:00:00Z";

function fixture(followup = false) {
    const session = { id: "session", title: "商品图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
    const parent = { id: "parent", sessionId: session.id, surface: "creation", status: "completed", userPrompt: "之前的需求", createdAt: at, updatedAt: at, events: [] };
    let runs: agentApi.AgentRun[] = followup ? [parent] : [];
    let conversation: CreationConversation = { id: "conversation", title: "新创作", updatedAt: at, messages: [], agentSessionId: session.id, ...(followup ? { agentRunId: parent.id, agentRuns: runs } : {}) };
    let saved = structuredClone(conversation);
    let pending: PendingCreationAgentSubmission | null = null;
    let prompt = "生成商品图",
        model = "old-model",
        budget = 200,
        busy = false,
        serial = 0,
        scope = "owner";
    let requestError: unknown = new ApiError("模型参数无效", { status: 400 });
    let readError: unknown, clearError: unknown, persistError: unknown;
    let afterPost: (() => void) | undefined;
    let missingReceipt = false;
    const requests: Array<{ parent?: string; body: agentApi.CreateAgentRunInput }> = [];
    const notices: string[] = [],
        clearScopes: string[] = [];
    const attachments = [{ id: "product", name: "商品", type: "image/png", storageKey: "resource:product", url: "", previewUrl: "", bytes: 1 }];
    let draftAttachments = attachments;
    const gate = createCreationSubmitGate(),
        saveChain = { current: Promise.resolve() };
    const post = async (body: agentApi.CreateAgentRunInput, parentId?: string) => {
        requests.push({ parent: parentId, body: structuredClone(body) });
        afterPost?.();
        if (requestError) throw requestError;
        if (missingReceipt) return {};
        const run = { ...parent, id: `run-${serial}`, status: "running", idempotencyKey: body.idempotencyKey, userPrompt: body.prompt };
        runs.push(run);
        return { run };
    };
    const submit = async (action?: { recoverPending?: boolean }) => {
        const bindings = {
            ...conversationHelpers,
            ...agentApi,
            buildCreationAgentRunInput,
            activeConversation: conversation,
            prompt,
            busy,
            stoppingConversationRef: { current: "" },
            agentInputError: "",
            submitGateRef: { current: gate },
            getActiveUserScope: () => scope,
            activeIdRef: { current: conversation.id },
            followLatestMessageRef: { current: false },
            setPrompt: (value: string) => {
                prompt = value;
            },
            setAttachments: (value: typeof attachments) => {
                draftAttachments = value;
            },
            setDraftReferences: () => {},
            setBusy: (value: boolean) => {
                busy = value;
            },
            loadPendingCreationAgentSubmission: async () => structuredClone(pending),
            savePendingCreationAgentSubmission: async (_id: string, value: PendingCreationAgentSubmission) => {
                pending = structuredClone(value);
            },
            clearPendingCreationAgentSubmission: async (_id: string, owner = scope, key?: string) => {
                clearScopes.push(owner);
                if (clearError) throw clearError;
                if (owner === "owner" && (!key || pending?.key === key)) pending = null;
            },
            getAgentSession: async () => {
                if (readError) throw readError;
                return { session, runs };
            },
            updateConversation: (_id: string, update: (value: CreationConversation) => CreationConversation) => {
                conversation = update(conversation);
                saved = structuredClone(conversation);
                return [conversation];
            },
            createClientId: () => `key-${++serial}`,
            config: { textModel: model },
            creationManagedModelSelection: (_config: unknown, value: string) => ({ logicalModelId: value }),
            agentPermissionMode: "request_approval",
            agentImageParameterMode: "auto",
            agentImageSettings: {},
            agentVideoParameterMode: "auto",
            agentVideoSettings: {},
            agentBudget: { maxCredits: budget, maxGenerationTasks: 0, maxVideoSeconds: 30 },
            attachments: draftAttachments,
            draftReferences: [],
            agentAttachmentSelection: { attachmentMode: "inherit" },
            agentOutputPreference: "concise",
            addedSkills: [],
            conversationSaveChainRef: saveChain,
            queueCreationConversationsSave: async () => {
                if (persistError) throw persistError;
            },
            createAgentRun: (body: agentApi.CreateAgentRunInput) => post(body),
            sendAgentMessage: (id: string, body: agentApi.CreateAgentRunInput) => post(body, id),
            restoreCreationAgentConversation: async () => conversationHelpers.projectCreationAgentConversation(session, runs),
            conversationsRef: { current: [conversation] },
            toast: { error: (text: string) => notices.push(text), warning: (text: string) => notices.push(text) },
        };
        return new Function(...Object.keys(bindings), `${code}\nreturn submitCreationAgent;`)(...Object.values(bindings))(undefined, undefined, false, action) as Promise<boolean>;
    };
    return {
        submit,
        requests,
        notices,
        clearScopes,
        get pending() {
            return pending;
        },
        get conversation() {
            return conversation;
        },
        get draft() {
            return { prompt, attachments: draftAttachments };
        },
        edit() {
            prompt = "生成五张商品图";
            model = "new-model";
            budget = 300;
        },
        reload() {
            conversation = structuredClone(saved);
        },
        error(value: unknown) {
            requestError = value;
        },
        readError(value: unknown) {
            readError = value;
        },
        clearError(value: unknown) {
            clearError = value;
        },
        persistError(value: unknown) {
            persistError = value;
        },
        switchAfterPost() {
            afterPost = () => {
                scope = "other-owner";
            };
        },
        missingReceipt() {
            missingReceipt = true;
        },
    };
}

test.each([false, true])("明确拒绝释放身份并保留草稿，刷新后可修改模型、预算和提示词重交；续轮=%s", async (followup) => {
    const page = fixture(followup);
    expect(await page.submit()).toBe(false);
    expect(page.pending).toBeNull();
    expect(page.conversation.messages.at(-1)).toMatchObject({ status: "error", error: "模型参数无效" });
    expect(page.conversation.messages.some((message) => message.agentIdempotencyKey)).toBe(false);
    expect(page.draft.prompt).toBe("生成商品图");
    expect(page.draft.attachments).toHaveLength(1);
    page.reload();
    page.edit();
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(2);
    expect(page.requests[1].body).toMatchObject({ prompt: "生成五张商品图", logicalModelId: "new-model", budget: { maxCredits: 300 } });
    expect(page.requests[1].body.idempotencyKey).not.toBe(page.requests[0].body.idempotencyKey);
    expect(page.requests[1].parent).toBe(followup ? "parent" : undefined);
    expect(page.conversation.messages.filter((message) => message.role === "user").at(-1)?.content).toBe("生成五张商品图");
});

test.each([400, 401, 402, 403, 404, 413, 422])("准入 HTTP %s 明确拒绝允许修正后重试", async (status) => {
    const page = fixture();
    page.error(new ApiError("拒绝", { status }));
    await page.submit();
    expect(page.pending).toBeNull();
});

test.each([undefined, 408, 409, 429, 500, 502, 503, 504])("结果未知 HTTP %s 保留原请求，刷新/改参数不新建，恢复仍使用相同 key/body", async (status) => {
    const page = fixture();
    page.error(new ApiError("结果未知", { status }));
    await page.submit();
    const pending = structuredClone(page.pending);
    expect(pending?.key).toBeTruthy();
    page.reload();
    page.edit();
    expect(await page.submit()).toBe(false);
    expect(page.requests).toHaveLength(1);
    page.error(undefined);
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests[1].body).toEqual(page.requests[0].body);
});

test("未知请求的后续提交拒绝不能证明首次未接收，继续保留原身份", async () => {
    const page = fixture();
    page.error(new ApiError("断网", { status: 502 }));
    await page.submit();
    const key = page.pending?.key;
    page.error(new ApiError("模型已停用", { status: 400 }));
    await page.submit({ recoverPending: true });
    expect(page.pending?.key).toBe(key);
});

test("会话查询拒绝不能清除之前提交结果未知的身份", async () => {
    const page = fixture();
    page.error(new ApiError("断网", { status: 502 }));
    await page.submit();
    const key = page.pending?.key;
    page.readError(new ApiError("读取失败", { status: 400 }));
    await page.submit({ recoverPending: true });
    expect(page.pending?.key).toBe(key);
    expect(page.requests).toHaveLength(1);
});

test("发送前持久化失败释放尚未发送的新请求，保留草稿", async () => {
    const page = fixture();
    page.persistError(new Error("存储失败"));
    await page.submit();
    expect(page.requests).toHaveLength(0);
    expect(page.pending).toBeNull();
    expect(page.draft.prompt).toBe("生成商品图");
});

test("明确拒绝但删除缓存失败时保留恢复身份，不假装解锁", async () => {
    const page = fixture();
    page.clearError(new Error("缓存删除失败"));
    await page.submit();
    expect(page.pending?.key).toBeTruthy();
    expect(page.conversation.messages.at(-1)?.agentIdempotencyKey).toBe(page.pending?.key);
    expect(page.draft.prompt).toBe("生成商品图");
    expect(page.notices.at(-1)).toContain("缓存删除失败");
    expect(page.notices.at(-1)).toContain("已保留原请求");
});

test("服务端已接受后缓存清理失败仍视为提交成功，重载只能恢复原运行", async () => {
    const page = fixture();
    page.error(undefined);
    page.clearError(new Error("缓存删除失败"));
    expect(await page.submit()).toBe(true);
    expect(page.conversation.agentRunId).toBe("run-1");
    expect(page.draft.prompt).toBe("");
    page.reload();
    page.clearError(undefined);
    // The recovery button passes the original prompt, as the page does.
    page.edit();
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests).toHaveLength(1);
    expect(page.pending).toBeNull();
});

test("请求返回前账号切换，拒绝只清原账号缓存，不操作新账号消息", async () => {
    const page = fixture();
    page.switchAfterPost();
    await page.submit();
    expect(page.clearScopes).toEqual(["owner"]);
    expect(page.pending).toBeNull();
    expect(page.notices).toEqual([]);
});

test("HTTP 成功但缺少运行回执仍属未知，不清草稿和请求身份", async () => {
    const page = fixture();
    page.error(undefined);
    page.missingReceipt();
    expect(await page.submit()).toBe(false);
    expect(page.pending?.key).toBeTruthy();
    expect(page.draft.prompt).toBe("生成商品图");
});
