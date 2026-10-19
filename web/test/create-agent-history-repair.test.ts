import { expect, test } from "bun:test";
import * as history from "../src/pages/create/creation-agent-conversation";
import type { AgentEvent, AgentRun, AgentSession } from "../src/services/api/agent";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";

const at = "2026-10-19T11:14:00Z";
const session: AgentSession = { id: "session-nine", title: "九张商品图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
const itemIds = ["main-1", "secondary-2", "secondary-3", "secondary-4", "secondary-5", "detail-1", "detail-2", "detail-3", "detail-4"];
const event = (seq: number, type: string, payload: Record<string, unknown>): AgentEvent => ({ runId: "run-nine", eventId: `run-nine:${seq}`, seq, type, payload, createdAt: at });
const events = [
    event(1, "plan_updated", {
        items: [
            { id: "visual", title: "锁定视觉方案", status: "done" },
            { id: "images", title: "生成九张图片", status: "doing" },
        ],
        plan: { items: itemIds.map((id) => ({ id, type: "image", title: id })) },
    }),
    ...Array.from({ length: 9 }, (_, i) => event(i + 2, "tool_completed", {})),
    ...itemIds.map((id, i) => event(i + 11, "generation_task_created", { taskId: `image-${i}`, commerceItemId: id, mode: "image", title: id })),
    ...itemIds.map((id, i) => event(i + 20, "generation_task_completed", { taskId: `image-${i}`, commerceItemId: id, status: "succeeded" })),
    event(29, "plan_updated", {
        items: [
            { id: "visual", title: "锁定视觉方案", status: "done" },
            { id: "images", title: "生成九张图片", status: "done" },
        ],
    }),
    event(30, "assistant_message", { text: "九张图片已生成" }),
];
const run: AgentRun = {
    id: "run-nine",
    sessionId: session.id,
    canvasId: "",
    surface: "creation",
    userPrompt: "5 张方图和 4 张竖图",
    status: "completed",
    permissionMode: "auto",
    createdAt: at,
    updatedAt: at,
    eventCount: events.length,
    latestSeq: events.length,
    events,
};
const project = (record = run) => history.projectCreationAgentConversation(session, [record]);
const missing = () => project({ ...run, events: events.filter((entry) => entry.seq !== 11) });
const gap = (conversation: CreationConversation) => history.creationAgentHistoryGapKey(conversation);
const client = (getSession: history.CreationAgentRecoveryClient["getSession"] = async () => ({ session, runs: [run] })): history.CreationAgentRecoveryClient => ({
    getSession,
    listRuns: async () => ({ runs: [] }),
    getRun: async () => ({ run }),
});
const finish = (conversation: CreationConversation) => {
    for (let i = 0; i < 9; i++) conversation = history.applyCreationAgentTaskState(conversation, { id: `image-${i}`, status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: `resource:image-${i}` }] }) });
    const reply = conversation.messages.find((message) => message.mode === "agent" && message.role === "assistant")!;
    return history.projectCreationAgentMediaBatches(
        reply,
        conversation.messages.filter((message) => message.taskIds?.length),
    )[0];
};

test("终态本地缓存漏创建事件时重新核对，九张成功图从8/9补回9/9", async () => {
    const cached = missing();
    expect(finish(cached)).toMatchObject({ batchTotal: 9, batchCompletedCount: 8 });
    expect(gap(cached)).not.toBe("");
    const recovered = await history.recoverCreationAgentHistory(() => cached, client());
    expect(recovered).toBeDefined();
    expect(gap(recovered!)).toBe("");
    expect(finish(recovered!)).toMatchObject({ batchTotal: 9, batchCompletedCount: 9 });
    expect(finish(recovered!).resultStorageKeys).toHaveLength(9);
});

test("实时流漏创建事件后收到完成事件即可发现缺口，不必等运行结束", () => {
    const current = project({ ...run, status: "running", events: events.filter((entry) => entry.seq <= 20 && entry.seq !== 11) });
    const key = gap(current);
    expect(key).not.toBe("");
    expect(gap(history.appendCreationAgentEvent(current, events[20]))).toBe(key);
});

test("终态快照保留服务器事件水位，最后一段事件未收到时触发恢复", () => {
    const current = project({ ...run, status: "running", eventCount: 10, events: events.slice(0, 10) });
    expect(gap(current)).toBe("");
    const ended = history.appendCreationAgentEvent(current, event(0, "run_status", { status: "completed", eventCount: 30, revision: 9 }));
    expect(ended.agentRuns?.[0].eventCount).toBe(30);
    expect(gap(ended)).not.toBe("");
});

test("完整记录不补拉，确实尚未提交的计划项也不凭数量补造任务", () => {
    expect(gap(project())).toBe("");
    const unsubmitted = events.filter((entry) => entry.seq !== 11 && entry.seq !== 20).map((entry, index) => ({ ...entry, seq: index + 1 }));
    expect(gap(project({ ...run, events: unsubmitted, eventCount: unsubmitted.length }))).toBe("");
});

test("没有事件缺口不发恢复请求，恢复读取失败保留原会话", async () => {
    let requests = 0;
    const unavailable = client(async () => {
        requests++;
        throw new Error("读取失败");
    });
    expect(await history.recoverCreationAgentHistory(() => project(), unavailable)).toBeUndefined();
    expect(requests).toBe(0);
    const cached = missing();
    await expect(history.recoverCreationAgentHistory(() => cached, unavailable)).rejects.toThrow("读取失败");
    expect(requests).toBe(1);
    expect(finish(cached)).toMatchObject({ batchTotal: 9, batchCompletedCount: 8 });
});

test("有完成记录却无创建记录、或消息投影漏项时也复核原任务", () => {
    const renumbered = events.filter((entry) => entry.seq !== 11).map((entry, index) => ({ ...entry, seq: index + 1 }));
    expect(gap(project({ ...run, events: renumbered, eventCount: renumbered.length }))).not.toBe("");
    const complete = project();
    expect(gap({ ...complete, messages: complete.messages.filter((message) => message.id !== "task-image-0") })).not.toBe("");
});

test("补拉期间新增普通图片、视频和后续Agent轮次均保留", async () => {
    let current = missing();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const recovery = history.recoverCreationAgentHistory(
        () => current,
        client(async () => {
            await waiting;
            return { session, runs: [run] };
        }),
    );
    const direct: CreationMessage[] = ["image", "video"].map((mode, i) => ({
        id: `direct-${i}`,
        role: "assistant",
        mode: mode as "image" | "video",
        content: "后续直接创作",
        createdAt: "2026-10-19T11:20:00Z",
        status: "pending",
        taskIds: [`direct-task-${i}`],
    }));
    const nextRun: AgentRun = { ...run, id: "new-run", status: "running", createdAt: "2026-10-19T11:21:00Z", updatedAt: "2026-10-19T11:21:00Z", eventCount: 0, events: [], userPrompt: "继续修改" };
    current = history.mergeCreationAgentConversation({ ...current, messages: [...current.messages, ...direct] }, history.projectCreationAgentConversation(session, [nextRun]));
    release();
    const recovered = await recovery;
    expect(recovered?.agentRunId).toBe("new-run");
    expect(recovered?.messages.filter((message) => message.id.startsWith("direct-"))).toEqual(direct);
    expect(recovered?.messages.some((message) => message.content === "继续修改")).toBe(true);
    expect(finish(recovered!)).toMatchObject({ batchCompletedCount: 9 });
});

test.each(["switch", "logout", "abort"])("异步补拉后%s不更新已经离开的会话", async (reason) => {
    let current: CreationConversation | undefined = missing();
    const controller = new AbortController();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const recovery = history.recoverCreationAgentHistory(
        () => current,
        client(async () => {
            await waiting;
            return { session, runs: [run] };
        }),
        controller.signal,
    );
    if (reason === "switch") current = { ...current, id: "another", agentSessionId: "another" };
    if (reason === "logout") current = undefined;
    if (reason === "abort") controller.abort();
    release();
    if (reason === "abort") await expect(recovery).rejects.toMatchObject({ name: "AbortError" });
    else expect(await recovery).toBeUndefined();
});
