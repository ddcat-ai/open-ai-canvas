import { expect, test } from "bun:test";
import { mergeCreationConversationHistory, projectCreationAgentConversation, retryCreationHistoryRead } from "../src/pages/create/creation-agent-conversation";
import { creationConversationMode } from "../src/pages/create/creation-conversations";
import type { CreationConversation, CreationHistoryEntry } from "../src/pages/create/creation-types";

const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const end = source.indexOf("    }, [smartCreationUserId, composerPreferencesHydrated, historyRefreshEpoch, toast]);");
const start = source.lastIndexOf("    useEffect(() => {", end);
if (start < 0 || end < 0) throw new Error("history hydration effect missing");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end) + "    }, []);");
const newStart = source.indexOf("    const startNewConversation = () => {");
const newEnd = source.indexOf("    const continueOnCanvas =", newStart);
if (newStart < 0 || newEnd < 0) throw new Error("new conversation handler missing");
const newCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(newStart, newEnd));
const selectStart = source.indexOf("    const cancelHistorySelection = () => {");
const selectEnd = source.indexOf("    const conversationRoute =", selectStart);
if (selectStart < 0 || selectEnd < 0) throw new Error("history selection handler missing");
const selectCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(selectStart, selectEnd));
const at = "2026-10-01T00:00:00Z";
const conversation = (id: string): CreationConversation => ({ id, agentSessionId: id, title: id, updatedAt: at, messages: [] });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function startHistory(local: CreationConversation[] = [conversation("active")], failures = new Set<string>()) {
    let hydrated = false;
    let cleanup = () => {};
    let selected = "";
    let pending: CreationHistoryEntry[] = [];
    let syncError = "";
    let loading = false;
    let scope = "alice";
    const writes: CreationConversation[][] = [];
    const calls: string[] = [];
    const slow = deferred<CreationConversation>();
    const current = { current: [] as CreationConversation[] };
    const active = { current: "" };
    const deleted = { current: new Set<string>() };
    const selection = { current: null as AbortController | null };
    const deps = {
        useEffect: (effect: () => () => void) => {
            cleanup = effect();
        },
        AbortController,
        conversationUserRef: { current: "alice" },
        smartCreationUserId: "alice",
        composerPreferencesHydrated: true,
        conversationsRef: current,
        activeIdRef: active,
        historyRecoveryDeletedRef: deleted,
        historySelectionRef: selection,
        getActiveUserScope: () => scope,
        loadCreationConversations: async () => local,
        useCreationPreferencesStore: { getState: () => ({ preferences: { activeConversationId: "active" } }) },
        listAgentSessions: async () => ({ sessions: ["slow", "active", "other"].map((id) => ({ id, title: id, surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at })) }),
        restoreCreationConversation: async (id: string) => {
            calls.push(id);
            if (failures.has(id)) throw new Error("模拟正文请求失败");
            if (id === "slow") return slow.promise;
            return conversation(id);
        },
        creationAgentRecoveryClient: {},
        mergeCreationConversationHistory,
        creationConversationMode,
        projectCreationAgentConversation,
        retryCreationHistoryRead,
        setHistoryPending: (value: CreationHistoryEntry[] | ((current: CreationHistoryEntry[]) => CreationHistoryEntry[])) => {
            pending = typeof value === "function" ? value(pending) : value;
        },
        setHistorySyncError: (value: string) => {
            syncError = value;
        },
        setHistoryLoading: (value: boolean) => {
            loading = value;
        },
        setConversationRetentionDays: () => {},
        syncConversationHistory: async (current: CreationConversation) => current.agentSessionId || current.id,
        conversationRoute: { show: () => {} },
        setCloudHistoryError: () => {},
        navigate: () => {},
        loadPendingCreationAgentSubmission: async () => null,
        clearPendingCreationAgentSubmission: async () => {},
        newConversation: () => ({ ...conversation("new"), agentSessionId: undefined }),
        setConversations: (value: CreationConversation[]) => {
            writes.push(value);
        },
        setActiveId: (value: string) => {
            selected = value;
        },
        setHydrated: (value: boolean) => {
            hydrated = value;
        },
        setMode: () => {},
        setPrompt: () => {},
        setAttachments: () => {},
        setDraftReferences: () => {},
        followLatestMessageRef: { current: false },
        setHistoryOpen: () => {},
        defaultCreationMode: "agent",
        toast: { warning: () => {}, error: () => {} },
    };
    const runEffect = () => new Function(...Object.keys(deps), code)(...Object.values(deps));
    runEffect();
    const handlers = new Function(...Object.keys(deps), `${selectCode}\n${newCode}\nreturn { select: selectConversation, startNew: startNewConversation, cancel: cancelHistorySelection };`)(...Object.values(deps));
    await flush();
    return {
        current,
        active,
        deleted,
        calls,
        writes,
        slow,
        ...handlers,
        switchAccount: () => {
            scope = "bob";
        },
        refresh: () => {
            cleanup();
            runEffect();
        },
        pending: () => pending,
        syncError: () => syncError,
        loading: () => loading,
        cleanup: () => {
            cleanup();
            selection.current?.abort();
        },
        hydrated: () => hydrated,
        selected: () => selected,
    };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("跨设备无缓存时只取标题目录，打开和刷新都不下载任何会话正文", async () => {
    const state = await startHistory([]);
    expect(state.hydrated()).toBe(true);
    expect(state.loading()).toBe(false);
    expect(state.calls).toEqual([]);
    expect(state.pending().map((entry: CreationHistoryEntry) => [entry.id, entry.historyStatus])).toEqual([
        ["slow", "unloaded"],
        ["active", "unloaded"],
        ["other", "unloaded"],
    ]);
    expect(state.selected()).toBe("new");
    state.refresh();
    await flush();
    expect(state.calls).toEqual([]);
    expect(state.selected()).toBe("new");
    state.cleanup();
});

test("本地历史首次交给页面前标记旧失败待复核，保留任务 ID 继续恢复", async () => {
    const cached: CreationConversation = {
        ...conversation("active"),
        messages: [{ id: "task-old", role: "assistant", mode: "image", agentRunId: "run", taskIds: ["old"], content: "正在生成图片（0/5，失败 1）", status: "error", error: "旧超时", createdAt: at }],
    };
    const state = await startHistory([cached]);
    try {
        expect(state.hydrated()).toBe(true);
        expect(state.writes[0][0].messages[0]).toMatchObject({ taskStatePending: true, taskIds: ["old"] });
        expect(state.calls).toEqual([]);
    } finally {
        state.cleanup();
    }
});

test("只加载点击的会话，失败保留目录并允许单独重试", async () => {
    const failures = new Set(["other"]);
    const state = await startHistory([], failures);
    try {
        await state.select(conversation("other"));
        expect(state.calls).toEqual(["other"]);
        expect(state.pending().find((entry: CreationHistoryEntry) => entry.id === "other")?.historyStatus).toBe("error");
        expect(state.selected()).toBe("new");
        failures.clear();
        await state.select(conversation("other"));
        expect(state.calls).toEqual(["other", "other"]);
        expect(state.pending().map((entry: CreationHistoryEntry) => entry.id)).toEqual(["slow", "active"]);
        expect(state.selected()).toBe("other");
    } finally {
        state.cleanup();
        state.slow.resolve(conversation("slow"));
    }
});

test("点击慢会话后新建，晚到正文不切走正在编辑的新会话", async () => {
    const state = await startHistory();
    try {
        const pending = state.select(conversation("slow"));
        state.startNew();
        state.slow.resolve(conversation("slow"));
        await pending;
        expect(state.active.current).toBe("new");
        expect(state.current.current.some((item) => item.id === "new")).toBe(true);
        expect(state.current.current.some((item) => item.id === "slow")).toBe(false);
    } finally {
        state.cleanup();
        state.slow.resolve(conversation("slow"));
    }
});

test("回到新创作保留原会话和正在生成的任务", async () => {
    const running: CreationConversation = {
        ...conversation("active"),
        agentRunId: "running-agent",
        messages: [{ id: "image", role: "assistant", mode: "image", content: "生成图片", createdAt: at, status: "pending", taskIds: ["running-image"] }],
    };
    const state = await startHistory([running]);
    try {
        state.startNew();
        expect(state.active.current).toBe("new");
        expect(state.current.current.find((item) => item.id === "new")?.messages).toEqual([]);
        expect(state.current.current.find((item) => item.id === "active")).toEqual(running);
    } finally {
        state.cleanup();
    }
});

test("连续点击两个标题，以最后点击的会话为准", async () => {
    const state = await startHistory([]);
    try {
        const pending = state.select(conversation("slow"));
        await state.select(conversation("other"));
        state.slow.resolve(conversation("slow"));
        await pending;
        expect(state.calls).toEqual(["slow", "other"]);
        expect(state.selected()).toBe("other");
        expect(state.current.current.some((item) => item.id === "slow")).toBe(false);
    } finally {
        state.cleanup();
        state.slow.resolve(conversation("slow"));
    }
});

test("历史恢复晚到时保留新提交状态，不恢复刚删除的会话", async () => {
    const state = await startHistory();
    try {
        const pending = state.select(conversation("slow"));
        state.deleted.current.add("slow");
        const active = state.current.current.find((item) => item.id === "active")!;
        active.messages.push({ id: "pending", role: "assistant", mode: "agent", content: "", createdAt: at, status: "streaming", clientOperationId: "agent-submission-active" });
        state.slow.resolve(conversation("slow"));
        await pending;
        expect(state.current.current.some((item) => item.id === "slow")).toBe(false);
        expect(state.current.current.find((item) => item.id === "active")?.messages[0]?.status).toBe("streaming");
    } finally {
        state.cleanup();
        state.slow.resolve(conversation("slow"));
    }
});

test.each(["unmount", "account"])("%s 后，旧历史请求不再写入状态", async (action) => {
    const state = await startHistory();
    const pending = state.select(conversation("slow"));
    if (action === "unmount") state.cleanup();
    else state.switchAccount();
    const writes = state.writes.length;
    state.slow.resolve(conversation("slow"));
    await pending;
    expect(state.writes).toHaveLength(writes);
    state.cleanup();
});
