import { expect, test } from "bun:test";
import * as conversationHelpers from "../src/pages/create/creation-agent-conversation";
import * as agentApi from "../src/services/api/agent";
import * as interjectionHelpers from "../src/pages/create/creation-agent-interjection";
import { creationConversationMode } from "../src/pages/create/creation-conversations";
import { buildCreationAgentRunInput } from "../src/pages/create/creation-agent-request";
import { createCreationSubmitGate } from "../src/pages/create/creation-submit-gate";
import { ApiError } from "../src/services/api/request";
import { creationHasInput, type CreationConversation } from "../src/pages/create/creation-types";
import type { PendingCreationAgentSubmission } from "../src/services/creation-conversation-store";

// Exercise the real page submit closure and conversation reducers; isolate only
// transport, persistence and React setters, without registering module mocks.
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const start = source.indexOf("    const interjectCreationAgent = async (");
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
    const interjections: Array<{ runId: string; text: string; messageId: string }> = [];
    const createdSessions: Array<{ title: string }> = [];
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
        const run = {
            ...parent,
            id: `run-${serial}`,
            parentId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "running",
            idempotencyKey: body.idempotencyKey,
            userPrompt: body.prompt,
            attachments: body.attachments?.map((item, index) => ({ ...item, turnIndex: index + 1 })),
        };
        runs.push(run);
        return { run };
    };
    const submit = async (action?: { recoverPending?: boolean; retry?: agentApi.CreateAgentRunInput["retry"] }) => {
        const bindings = {
            ...conversationHelpers,
            ...agentApi,
            ...interjectionHelpers,
            creationConversationMode,
            buildCreationAgentRunInput,
            creationHasInput,
            activeConversation: conversation,
            syncConversationHistory: async (current: CreationConversation) => {
                if (!current.agentSessionId) createdSessions.push({ title: current.title });
                return current.agentSessionId || session.id;
            },
            conversationRoute: { show: () => {} },
            prompt,
            promptRef: {
                get current() {
                    return prompt;
                },
            },
            attachmentsRef: {
                get current() {
                    return draftAttachments;
                },
            },
            unmountedRef: { current: false },
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
            getAgentRun: async (id: string) => ({ run: runs.find((run) => run.id === id)! }),
            sendAgentInterjection: async (runId: string, input: { text: string; messageId: string }) => {
                interjections.push({ runId, ...input });
                return { accepted: true, pending: 1 };
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
            agentImageSelectionMode: "preferred",
            agentVideoSelectionMode: "preferred",
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
            createAgentSession: async (body: { title: string }) => {
                createdSessions.push(body);
                return { session: { ...session, title: body.title } };
            },
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
        interjections,
        createdSessions,
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
        onlyAttachment() {
            prompt = "";
        },
        clearDraft() {
            prompt = "";
            draftAttachments = [];
        },
        textOnly() {
            draftAttachments = [];
        },
        continueText() {
            prompt = "继续啊";
            draftAttachments = [];
        },
        confirmLastRequest() {
            const last = requests.at(-1)!;
            runs.push({
                ...parent,
                id: "accepted-retry",
                parentId: last.parent,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: "running",
                userPrompt: last.body.prompt,
                idempotencyKey: last.body.idempotencyKey,
                eventCount: 0,
            });
        },
        afterPost(callback: () => void) {
            afterPost = callback;
        },
        runStatus(status: agentApi.AgentRun["status"]) {
            runs = runs.map((run) => ({ ...run, status, canvasId: "" }));
            conversation = { ...conversation, agentRuns: runs };
        },
        serverContextReceipts(ids: string[]) {
            runs = runs.map((run) => ({ ...run, creationContextMessageIds: ids }));
        },
        serverAdvance(status: agentApi.AgentRun["status"]) {
            runs = [...runs, { ...parent, id: "edited-text", parentId: parent.id, userPrompt: "把杯身文字修改为 IGO", status, createdAt: "2026-10-19T00:01:00Z", updatedAt: "2026-10-19T00:01:00Z", eventCount: 0 }];
        },
        ordinaryHistory() {
            conversation = { ...conversation, messages: [{ id: "ordinary", role: "user", mode: "image", content: "之前的普通生图说明", createdAt: at }] };
        },
        newConversation() {
            delete conversation.agentSessionId;
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

test("另一标签已完成改字轮，新发送沿最新父轮继续，不接刷新前捕获的旧轮", async () => {
    const page = fixture(true);
    page.serverAdvance("completed");
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests[0].parent).toBe("edited-text");
    expect(page.conversation.messages.some((message) => message.role === "user" && message.content === "把杯身文字修改为 IGO")).toBe(true);
});

test("另一标签的改字轮仍运行，纯文本补充送到该轮，不创建收费兄弟轮", async () => {
    const page = fixture(true);
    page.textOnly();
    page.serverAdvance("running");
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(0);
    expect(page.interjections).toHaveLength(1);
    expect(page.interjections[0].runId).toBe("edited-text");
    expect(page.pending).toBeNull();
});

test("最新轮仍运行且有新附件时保留草稿，不绕过活动轮创建旧分支", async () => {
    const page = fixture(true);
    page.serverAdvance("running");
    page.error(undefined);
    expect(await page.submit()).toBe(false);
    expect(page.requests).toHaveLength(0);
    expect(page.interjections).toHaveLength(0);
    expect(page.draft.attachments).toHaveLength(1);
});

test("重试目标可以是旧轮，但新运行仍继承最新对话轮", async () => {
    const page = fixture(true);
    page.serverAdvance("completed");
    page.error(undefined);
    expect(await page.submit({ retry: { runId: "parent" } })).toBe(true);
    expect(page.requests[0].parent).toBe("edited-text");
    expect(page.requests[0].body.retry?.runId).toBe("parent");
});

test("新轮已出现时未知请求恢复仍固定原父轮和原正文，不自动改成最新轮", async () => {
    const page = fixture(true);
    page.error(new ApiError("回执丢失", { status: 502 }));
    expect(await page.submit()).toBe(false);
    const original = structuredClone(page.requests[0]);
    page.serverAdvance("completed");
    page.error(undefined);
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests[1]).toEqual(original);
});

test("服务端原子核对发现旧父轮，明确拒绝释放新身份并保留草稿", async () => {
    const page = fixture(true);
    page.error(new ApiError("会话已有更新，请同步后重新发送", { status: 409, code: 409, reason: "agent_session_stale_parent" }));
    expect(await page.submit()).toBe(false);
    expect(page.pending).toBeNull();
    expect(page.draft.prompt).toBe("生成商品图");
});

test("失败后点击重试立即有提交状态，收到回执后的继续只插入重试轮", async () => {
    const page = fixture(true);
    page.error(undefined);
    page.afterPost(() => {
        expect(page.conversation.messages.at(-1)).toMatchObject({ role: "assistant", mode: "agent", status: "streaming" });
    });
    expect(await page.submit({ retry: { runId: "parent" } })).toBe(true);
    const retryRun = page.conversation.agentRunId;
    expect(retryRun).not.toBe("parent");
    page.continueText();
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(1);
    expect(page.interjections).toHaveLength(1);
    expect(page.interjections[0]).toMatchObject({ runId: retryRun, text: "继续啊" });
});

test("重试回执丢失后发继续，先查服务端已接收身份再补充到原重试轮", async () => {
    const page = fixture(true);
    page.error(new ApiError("回执丢失", { status: 502 }));
    expect(await page.submit({ retry: { runId: "parent" } })).toBe(false);
    page.confirmLastRequest();
    page.continueText();
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(1);
    expect(page.pending).toBeNull();
    expect(page.interjections).toHaveLength(1);
    expect(page.interjections[0]).toMatchObject({ runId: "accepted-retry", text: "继续啊" });
});

test.each([false, true])("纯附件 Agent 请求保留空提示词并生成用户气泡，首次与续轮均可提交；续轮=%s", async (followup) => {
    const page = fixture(followup);
    page.onlyAttachment();
    if (!followup) page.newConversation();
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(1);
    expect(page.requests[0].body).toMatchObject({ prompt: "", attachments: [{ resourceId: "product" }] });
    expect(page.requests[0].parent).toBe(followup ? "parent" : undefined);
    if (!followup) expect(page.createdSessions[0].title).toBe("商品");
    expect(page.conversation.messages.find((message) => message.role === "user" && message.id === "user-run-1")).toMatchObject({ content: "", attachments: [expect.objectContaining({ storageKey: "resource:product" })] });
    expect(page.draft).toEqual({ prompt: "", attachments: [] });
});

test("纯附件待确认请求重载后从空草稿恢复，沿用原 key 与附件，不重新附带历史资源", async () => {
    const page = fixture();
    page.onlyAttachment();
    page.error(new ApiError("回执丢失", { status: 502 }));
    expect(await page.submit()).toBe(false);
    expect(page.pending?.request.prompt).toBe("");
    expect(page.pending?.request.attachments).toHaveLength(1);
    page.reload();
    page.clearDraft();
    page.error(undefined);
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests[1].body).toEqual(page.requests[0].body);
    expect(page.conversation.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test.each([400, 401, 402, 403, 404, 413, 422])("准入 HTTP %s 明确拒绝允许修正后重试", async (status) => {
    const page = fixture();
    page.error(new ApiError("拒绝", { status }));
    await page.submit();
    expect(page.pending).toBeNull();
});

test("续轮在服务端确认上一轮仍执行时释放新请求身份，可编辑后重新提交", async () => {
    // The local completed snapshot can lag behind the server's execution/cleanup
    // check. Only the explicit admission reason proves this new turn was rejected.
    const page = fixture(true);
    page.error(new ApiError("上一轮 Agent 尚未结束", { status: 409, code: 409, reason: "canvas_agent_busy" }));
    expect(await page.submit()).toBe(false);
    expect(page.requests[0].parent).toBe("parent");
    expect(page.pending).toBeNull();
    expect(page.conversation.messages.some((message) => message.agentIdempotencyKey)).toBe(false);
    expect(page.draft.prompt).toBe("生成商品图");
    expect(page.draft.attachments).toHaveLength(1);
    expect(page.notices.at(-1)).toBe("上一轮 Agent 尚未结束");

    page.reload();
    page.edit();
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests).toHaveLength(2);
    expect(page.requests[1].parent).toBe("parent");
    expect(page.requests[1].body).toMatchObject({ prompt: "生成五张商品图", logicalModelId: "new-model", budget: { maxCredits: 300 } });
    expect(page.requests[1].body.idempotencyKey).not.toBe(page.requests[0].body.idempotencyKey);
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

test.each([new ApiError("模型已停用", { status: 400 }), new ApiError("上一轮 Agent 尚未结束", { status: 409, code: 409, reason: "canvas_agent_busy" })])("未知请求的后续提交拒绝不能证明首次未接收，继续保留原身份：%s", async (rejection) => {
    const page = fixture(true);
    page.error(new ApiError("断网", { status: 502 }));
    await page.submit();
    const key = page.pending?.key;
    page.reload();
    page.error(rejection);
    expect(await page.submit({ recoverPending: true })).toBe(false);
    expect(page.pending?.key).toBe(key);
    expect(page.requests[1]).toEqual(page.requests[0]);
    expect(page.clearScopes).toEqual([]);
    page.edit();
    expect(await page.submit()).toBe(false);
    expect(page.requests).toHaveLength(2);
    page.error(undefined);
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests[2]).toEqual(page.requests[0]);
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

test("恢复纯附件原提交时不把新草稿文字写进旧用户消息", async () => {
    const page = fixture();
    page.onlyAttachment();
    page.error(new Error("network unavailable"));
    expect(await page.submit()).toBe(false);
    const original = page.requests[0].body;
    page.edit();
    page.error(undefined);
    expect(await page.submit({ recoverPending: true })).toBe(true);
    expect(page.requests[1].body).toEqual(original);
    expect(page.draft.prompt).toBe("生成五张商品图");
    expect(page.conversation.messages.find((item) => item.role === "user" && item.id.startsWith("user-run-"))?.content).toBe("");
});

test.each(["running", "queued", "waiting_approval"] as const)("真实首页提交闭包把 %s 文字补充送入原轮次，连续点击不新建收费任务", async (status) => {
    const page = fixture(true);
    page.runStatus(status);
    page.textOnly();
    const outcomes = await Promise.all([page.submit(), page.submit()]);
    expect(outcomes).toEqual([true, false]);
    expect(page.interjections).toHaveLength(1);
    expect(page.interjections[0]).toMatchObject({ runId: "parent", text: "生成商品图" });
    expect(page.requests).toHaveLength(0);
    expect(page.createdSessions).toHaveLength(0);
    expect(page.draft.prompt).toBe("");
    expect(page.conversation.messages.find((item) => item.agentInterjection)?.agentInterjection).toBe("queued");
});

test("运行中附图不会走插话或新建，当前文字和图片草稿完整保留", async () => {
    const page = fixture(true);
    page.runStatus("running");
    expect(await page.submit()).toBe(false);
    expect(page.interjections).toHaveLength(0);
    expect(page.requests).toHaveLength(0);
    expect(page.draft.prompt).toBe("生成商品图");
    expect(page.draft.attachments).toHaveLength(1);
    expect(page.notices.at(-1)).toContain("附件已保留");
});

test("已有未确认的新轮提交不能把同一草稿误发成原轮插话", async () => {
    const page = fixture(true);
    page.error(new Error("未知回执"));
    expect(await page.submit()).toBe(false);
    page.runStatus("running");
    page.textOnly();
    expect(await page.submit()).toBe(false);
    expect(page.interjections).toHaveLength(0);
    expect(page.requests).toHaveLength(1);
    expect(page.notices.at(-1)).toContain("待确认");
});

test("会话读取的新上下文收据用于当前新请求，而非闭包里的旧会话", async () => {
    const page = fixture(true);
    page.ordinaryHistory();
    page.serverContextReceipts(["ordinary"]);
    page.error(undefined);
    expect(await page.submit()).toBe(true);
    expect(page.requests[0].body.creationContext?.some((item) => item.messageId === "ordinary") || false).toBe(false);
});
