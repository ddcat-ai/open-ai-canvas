import { expect, test } from "bun:test";
import * as conversation from "../src/pages/create/creation-agent-conversation";

const at = "2026-10-02T10:00:00Z";
const event = (runId: string, seq: number, type: string, payload: Record<string, unknown>) => ({ eventId: `${runId}:${seq}`, runId, seq, type, payload, createdAt: at });
const session = { id: "session-1", title: "产品图片", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
const run = (id: string, prompt: string, status: string, events: ReturnType<typeof event>[]) => ({ id, sessionId: session.id, canvasId: "", surface: "creation", userPrompt: prompt, status, permissionMode: "request_approval", createdAt: at, updatedAt: at, latestSeq: events.length, events });

test("新站点规划失败时不展示历史继承的旧方案，旧轮次仍保留自己的计划", () => {
    const oldItems = [{ id: "jp-hero", title: "日本站六图", status: "pending" }];
    const previous = run("run-1", "日本站六图", "completed", [
        event("run-1", 1, "plan_updated", { items: oldItems, plan: { planId: "jp-six", site: "JP", items: oldItems } }),
        event("run-1", 2, "assistant_message", { text: "日本站方案" }),
    ]);
    const next = run("run-2", "法国站五图", "failed", [
        event("run-2", 1, "plan_updated", { inherited: true, items: oldItems }),
        event("run-2", 2, "error", { text: "模型服务暂时不可用（HTTP 503）" }),
    ]);
    const projected = conversation.projectCreationAgentConversation(session as any, [previous, next] as any);
    expect(projected.agentPlanItems?.length || 0).toBe(0);
    expect(projected.agentCommercePlan).toBeUndefined();
    expect(projected.messages.find((item) => item.id === "run-1:assistant")?.commercePlan?.site).toBe("JP");
    expect(projected.messages.find((item) => item.id === "run-2:assistant")?.commercePlan).toBeUndefined();
});

test("恢复完整服务端轮次，保留用户、回复、任务、计划及待审批事实", () => {
    const first = run("run-1", "做一套 UK 产品图", "completed", [
        event("run-1", 1, "plan_updated", { items: [{ id: "hero", title: "主图", status: "done" }] }),
        event("run-1", 2, "generation_task_created", { taskId: "task-1", mode: "image", title: "主图" }),
        event("run-1", 3, "assistant_message", { messageId: "answer-1", text: "已提交主图任务" }),
    ]);
    const second = run("run-2", "再生成视频", "waiting_approval", [
        event("run-2", 1, "assistant_message", { messageId: "answer-2", text: "视频计划需要审批" }),
        event("run-2", 2, "plan_updated", { items: [{ id: "video", title: "视频计划", status: "pending", targetCopy: "Product demo", zhReviewCopy: "商品演示" }] }),
        event("run-2", 3, "approval_requested", { approvalId: "approval-1", text: "预计消耗 12 积分" }),
    ]);
    const result = (conversation as any).projectCreationAgentConversation?.(session, [second, first]);
    expect(result.messages.filter((item: { role: string }) => item.role === "user").map((item: { content: string }) => item.content)).toEqual(["做一套 UK 产品图", "再生成视频"]);
    expect(result.messages.some((item: { taskIds?: string[] }) => item.taskIds?.includes("task-1"))).toBe(true);
    expect(result.agentPlanItems).toEqual([{ id: "video", title: "视频计划", status: "pending", targetCopy: "Product demo", zhReviewCopy: "商品演示" }]);
    expect(result.agentApproval?.approvalId).toBe("approval-1");
    expect(result.agentRunId).toBe("run-2");
});

test("电商计划恢复完整摘要、事实、素材角色和逐图画面，而不是只剩标题", () => {
    const plan = {
        planVersion: "2", planId: "plan-uk", version: 3, intent: "生成英国站商品图", platform: "amazon", site: "UK", language: "en-GB",
        styleBible: "统一柔和布光，保持产品轮廓", assumptions: ["缺少尺寸，改为细节图"],
        productFacts: [{ id: "f1", claim: "蓝色瓶身", sourceIds: ["product-1"], status: "supported" }],
        items: [{ id: "detail", type: "image", purpose: "细节图", title: "瓶身细节", prompt: "Close-up of the blue bottle", targetCopy: "Blue silhouette", zhReviewCopy: "蓝色轮廓", factIds: ["f1"], attachmentResourceIds: ["product-1"], specs: { size: "1:1" } }],
    };
    const projected = conversation.projectCreationAgentConversation(session as any, [run("run-1", "生成商品图", "waiting_approval", [
        event("run-1", 1, "plan_updated", { plan, planHash: "hash-3", references: [{ resourceId: "product-1", name: "当前产品图", role: "product", selection: "current" }], skills: [{ id: "igo-visual-design", name: "电商视觉设计" }], items: [{ id: "detail", title: "瓶身细节", status: "pending" }] }),
    ]) as any]);
    expect(projected.agentCommercePlan?.planId).toBe("plan-uk");
    expect(projected.agentCommercePlan?.planHash).toBe("hash-3");
    expect(projected.agentCommercePlan?.references?.[0]?.role).toBe("product");
    expect(projected.agentCommercePlan?.items[0]?.prompt).toBe("Close-up of the blue bottle");
    expect(projected.agentCommercePlan?.productFacts[0]?.claim).toBe("蓝色瓶身");
    expect(projected.agentCommercePlan?.assumptions).toEqual(["缺少尺寸，改为细节图"]);
    expect(projected.messages.find((item) => item.id === "run-1:assistant")?.commercePlan?.planHash).toBe("hash-3");
});

test("恢复时分页读取所有 run 与事件，不重复同一序号", async () => {
    const first = run("run-1", "第一轮", "completed", []);
    const second = run("run-2", "第二轮", "completed", []);
    const seen: Array<string> = [];
    const restored = await (conversation as any).restoreCreationAgentConversation?.("session-1", {
        getSession: async () => ({ session, runs: [second], nextRunCursor: "run-2" }),
        listRuns: async (_: string, before: string) => { seen.push(before); return { runs: [first] }; },
        getRun: async (id: string, sinceSeq: number, fromStart: boolean) => {
            seen.push(`${id}:${sinceSeq}`);
            if (sinceSeq === 0) expect(fromStart).toBe(true);
            const seq = sinceSeq + 1;
            return { run: { ...(id === "run-1" ? first : second), eventCount: 2, latestSeq: seq, events: seq <= 2 ? [event(id, seq, "assistant_message", { messageId: `${id}:answer`, text: seq === 2 ? "完成" : "过程" })] : [] } };
        },
    });
    expect(seen).toContain("run-2");
    expect(seen).toContain("run-1:0");
    expect(seen).toContain("run-1:1");
    expect(restored.messages.filter((item: { role: string }) => item.role === "assistant")).toHaveLength(2);
});

test("服务端任务完成后沿原任务消息展示媒体结果，失败保留错误", () => {
    const base = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "生成主图", "completed", [event("run-1", 1, "generation_task_created", { taskId: "task-1", mode: "image", title: "主图" })])]);
    const done = (conversation as any).applyCreationAgentTaskState?.(base, { id: "task-1", status: "succeeded", resultJson: JSON.stringify({ mode: "image", images: [{ dataUrl: "https://example.com/a.png", storageKey: "resource:asset-1" }] }) });
    expect(done.messages.find((item: { id: string }) => item.id === "task-task-1")).toMatchObject({ status: "done", resultStorageKeys: ["resource:asset-1"] });
    const failed = (conversation as any).applyCreationAgentTaskState?.(base, { id: "task-1", status: "failed", error: "provider unavailable" });
    expect(failed.messages.find((item: { id: string }) => item.id === "task-task-1")).toMatchObject({ status: "error", error: "provider unavailable" });
});

test("实时事件按 run 和序号去重并更新当前会话", () => {
    const base = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "你好", "running", [])]);
    const answer = event("run-1", 1, "assistant_message", { messageId: "answer", text: "我来规划" });
    const once = (conversation as any).appendCreationAgentEvent?.(base, answer);
    const twice = (conversation as any).appendCreationAgentEvent?.(once, answer);
    expect(twice.messages.filter((item: { role: string }) => item.role === "assistant")).toHaveLength(1);
    expect(twice.messages.find((item: { role: string }) => item.role === "assistant")?.content).toBe("我来规划");
    const stopped = (conversation as any).appendCreationAgentEvent?.(twice, event("run-1", 0, "run_status", { status: "completed" }));
    expect(stopped.agentRuns.at(-1).status).toBe("completed");
});

test("模式切回 Agent 后实时事件保留同会话的直出图片和已解析结果", () => {
    const base = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "你好", "running", [event("run-1", 1, "generation_task_created", { taskId: "task-1", mode: "image" })])]);
    const completed = (conversation as any).applyCreationAgentTaskState(base, { id: "task-1", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:agent-image" }] }) });
    completed.id = "local-conversation";
    completed.canvasId = "handoff-canvas";
    completed.messages.push({ id: "direct-image", role: "assistant", mode: "image", content: "原图片", status: "done", taskIds: ["direct-task"], resultStorageKeys: ["resource:direct-image"], createdAt: at });
    const next = (conversation as any).appendCreationAgentEvent(completed, event("run-1", 2, "assistant_message", { messageId: "answer", text: "继续规划" }));
    expect(next.id).toBe("local-conversation");
    expect(next.canvasId).toBe("handoff-canvas");
    expect(next.messages.find((item: { id: string }) => item.id === "direct-image")).toMatchObject({ resultStorageKeys: ["resource:direct-image"], status: "done" });
    expect(next.messages.find((item: { id: string }) => item.id === "task-task-1")).toMatchObject({ resultStorageKeys: ["resource:agent-image"], status: "done" });
});

test("恢复远端历史保留本地会话 ID，不清掉混合模式消息或用户选择", () => {
    const remote = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "继续", "completed", [])]);
    const local = { ...remote, id: "local-conversation", composerMode: "video", messages: [...remote.messages, { id: "local-video", role: "assistant", mode: "video", content: "视频", createdAt: at, resultStorageKeys: ["resource:video"] }] };
    const result = (conversation as any).mergeCreationConversationHistory?.([local], [remote], "local-conversation");
    expect(result?.activeId).toBe("local-conversation");
    expect(result?.conversations).toHaveLength(1);
    expect(result?.conversations[0]).toMatchObject({ id: "local-conversation", composerMode: "video" });
    expect(result?.conversations[0].messages.map((item: { id: string }) => item.id)).toEqual(["user-run-1", "local-video"]);
});

test("迟到恢复不覆盖更晚事件或另一个新轮次", () => {
    const stale = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "第一轮", "running", [])]);
    const current = (conversation as any).projectCreationAgentConversation(session, [run("run-1", "第一轮", "completed", [event("run-1", 1, "assistant_message", { messageId: "answer", text: "第一轮完成" })]), run("run-2", "第二轮", "running", [])]);
    const result = (conversation as any).mergeCreationAgentConversation?.(current, stale);
    expect(result?.agentRunId).toBe("run-2");
    expect(result?.messages.some((item: { content: string }) => item.content === "第一轮完成")).toBe(true);
    expect(result?.agentRuns.find((item: { id: string }) => item.id === "run-1").status).toBe("completed");
});

test("首页恢复拒绝画布会话，不把 canvas run 伪装为 creation", async () => {
    let fetchedRuns = 0;
    await expect((conversation as any).restoreCreationAgentConversation("session-1", {
        getSession: async () => ({ session: { ...session, surface: "canvas" }, runs: [run("run-1", "画布", "completed", [])] }),
        listRuns: async () => ({ runs: [] }),
        getRun: async () => { fetchedRuns++; return { run: run("run-1", "画布", "completed", []) }; },
    })).rejects.toThrow("首页");
    expect(fetchedRuns).toBe(0);
});

test("合并直出与 Agent 消息按真实时间排序，兼容带毫秒和不带毫秒的时间戳", () => {
    const remote = (conversation as any).projectCreationAgentConversation(session, [{ ...run("run-1", "后续 Agent", "completed", []), createdAt: "2026-10-02T10:00:00.100Z" }]);
    const local = { id: "local", title: "旧图片", updatedAt: at, messages: [{ id: "direct", role: "user", mode: "image", content: "先前图片", createdAt: at }] };
    const merged = (conversation as any).mergeCreationAgentConversation(local, remote);
    expect(merged.messages.map((item: { id: string }) => item.id)).toEqual(["direct", "user-run-1"]);
});

test("同轮工具前说明、流式增量和最终快照只更新一个助手气泡", () => {
    let current = conversation.projectCreationAgentConversation(session, [run("run-1", "看看参考图", "running", []) as any]);
    const initial = current.messages.find((item) => item.role === "assistant");
    expect(initial).toMatchObject({ content: "", status: "streaming" });
    const id = initial!.id;
    for (const next of [
        event("run-1", 1, "assistant_delta", { messageId: "step-1", text: "我先" }),
        event("run-1", 2, "assistant_delta", { messageId: "step-1", text: "查看参考图。" }),
        event("run-1", 3, "assistant_message", { messageId: "step-1", text: "我先查看参考图。" }),
        event("run-1", 4, "assistant_delta", { messageId: "step-2", text: "图片中" }),
    ]) current = conversation.appendCreationAgentEvent(current, next);
    expect(current.messages.filter((item) => item.role === "assistant")).toEqual([expect.objectContaining({ id, content: "我先查看参考图。\n\n图片中", status: "streaming" })]);
    current = conversation.appendCreationAgentEvent(current, event("run-1", 5, "assistant_message", { messageId: "step-2", text: "图片中是一只红色水杯。" }));
    current = conversation.appendCreationAgentEvent(current, event("run-1", 0, "run_status", { status: "completed" }));
    expect(current.messages.filter((item) => item.role === "assistant")).toEqual([expect.objectContaining({ id, content: "我先查看参考图。\n\n图片中是一只红色水杯。", status: "done" })]);
});

test("结构化提问及选项与正文同条展示，实时和历史恢复均不丢失", () => {
    const events = [
        event("run-1", 1, "assistant_message", { messageId: "step-1", text: "有几点需要先跟你确认：" }),
        event("run-1", 2, "user_question", { phase: "question", kind: "choice", question: "这套配件的真实用途是什么？", options: [{ label: "水族接头", detail: "鱼缸管路" }, { label: "灌溉接头", detail: "花园管路" }], allowFreeform: true, round: 1, maxRounds: 2 }),
    ];
    let live = conversation.projectCreationAgentConversation(session, [run("run-1", "做日本站套图", "running", [events[0]]) as any]);
    live = conversation.appendCreationAgentEvent(live, events[1]);
    live = conversation.appendCreationAgentEvent(live, events[1]);
    live = conversation.appendCreationAgentEvent(live, event("run-1", 0, "run_status", { status: "completed" }));
    const restored = conversation.projectCreationAgentConversation(session, [run("run-1", "做日本站套图", "completed", events) as any]);
    expect(live.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
    expect(live.messages.find((item) => item.role === "assistant")).toMatchObject({ content: "有几点需要先跟你确认：", status: "done", agentQuestion: { question: "这套配件的真实用途是什么？", options: [{ label: "水族接头", detail: "鱼缸管路" }, { label: "灌溉接头", detail: "花园管路" }] } });
    expect(restored.messages.find((item) => item.role === "assistant")?.agentQuestion).toEqual(live.messages.find((item) => item.role === "assistant")?.agentQuestion);
});

test("仅有动态表单提问也恢复助手消息和全部字段", () => {
    const restored = conversation.projectCreationAgentConversation(session, [run("run-1", "确认方案", "completed", [event("run-1", 1, "user_question", { phase: "question", kind: "form", question: "确认创作方向", fields: [{ id: "purpose", title: "用途", type: "single_select", required: true, options: [{ id: "aquarium", label: "水族", detail: "鱼缸使用" }, { id: "other", label: "其他" }] }, { id: "notes", title: "补充说明", type: "textarea", placeholder: "可选" }] })]) as any]);
    expect(restored.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
    expect(restored.messages.find((item) => item.role === "assistant")?.agentQuestion).toMatchObject({ question: "确认创作方向", fields: [{ title: "用途", required: true, options: [{ label: "水族", detail: "鱼缸使用" }, { label: "其他" }] }, { title: "补充说明", placeholder: "可选" }] });
});

test("序号零的恢复快照即时显示且不污染持久事件游标，最终快照不重复", () => {
    let current = conversation.projectCreationAgentConversation(session, [run("run-1", "你好", "running", []) as any]);
    current = conversation.appendCreationAgentEvent(current, event("run-1", 0, "assistant_message", { messageId: "step-1", text: "正在查看" }));
    expect(current.messages.find((item) => item.role === "assistant")?.content).toBe("正在查看");
    expect(current.agentRuns?.[0].events).toEqual([]);
    current = conversation.appendCreationAgentEvent(current, event("run-1", 0, "assistant_message", { messageId: "step-1", text: "正在查看图片" }));
    current = conversation.appendCreationAgentEvent(current, event("run-1", 1, "assistant_message", { messageId: "step-1", text: "正在查看图片。" }));
    expect(current.messages.filter((item) => item.role === "assistant")).toEqual([expect.objectContaining({ content: "正在查看图片。" })]);
    expect(current.agentRuns?.[0].events?.map((item) => item.seq)).toEqual([1]);
});

test("首次恢复直接读取 activeMessage，后续持久增量不会把已显示快照截短", () => {
    let current = conversation.projectCreationAgentConversation(session, [{ ...run("run-1", "你好", "running", []), activeMessage: { messageId: "step-1", text: "你好，世界" } } as any]);
    expect(current.messages.find((item) => item.role === "assistant")?.content).toBe("你好，世界");
    current = conversation.appendCreationAgentEvent(current, event("run-1", 1, "assistant_delta", { messageId: "step-1", text: "你好" }));
    expect(current.messages.find((item) => item.role === "assistant")?.content).toBe("你好，世界");
    current = conversation.appendCreationAgentEvent(current, event("run-1", 2, "assistant_delta", { messageId: "step-1", text: "，世界！" }));
    expect(current.messages.find((item) => item.role === "assistant")?.content).toBe("你好，世界！");
});

test("首页统计使用当前轮服务端读数，取消后清除压缩中的过期状态", () => {
    let current = conversation.projectCreationAgentConversation(session, [run("run-1", "你好", "running", [
        event("run-1", 1, "context_pressure", { modelLimitConfigured: true, tokenSource: "provider", contextWindowTokens: 1000, projectedNextInputTokens: 700, projectedPressureRatio: 0.7 }),
        event("run-1", 2, "context_compaction_requested", { basis: "tokens" }),
    ]) as any]);
    expect(current.agentContextUsage?.reading?.projectedNextInputTokens).toBe(700);
    current = conversation.appendCreationAgentEvent(current, event("run-1", 0, "run_status", { status: "cancelled" }));
    expect(current.agentContextUsage).toMatchObject({ runId: "run-1", compactionPending: null, readingStale: true });
});

test("提交开始就显示用户输入和助手占位，服务端接收后替换而不重复", () => {
    const local = { id: "local", title: "新创作", updatedAt: at, messages: [] };
    const attachment = { id: "image-1", name: "参考图", type: "image/png", storageKey: "resource:image-1", previewUrl: "https://example.com/a.png", url: "https://example.com/a.png", bytes: 10 };
    const pending = (conversation as any).beginCreationAgentSubmission?.(local, { id: "submit-1", prompt: "看看参考图", createdAt: at, attachments: [attachment] });
    expect(pending?.messages).toEqual([
        expect.objectContaining({ role: "user", content: "看看参考图", attachments: [attachment] }),
        expect.objectContaining({ role: "assistant", content: "", status: "streaming" }),
    ]);
    const incoming = conversation.projectCreationAgentConversation(session, [run("run-1", "看看参考图", "running", []) as any]);
    const settled = (conversation as any).settleCreationAgentSubmission?.(pending, incoming, "submit-1");
    expect(settled?.messages).toEqual([
        expect.objectContaining({ id: "user-run-1", role: "user", attachments: [attachment] }),
        expect.objectContaining({ role: "assistant", status: "streaming" }),
    ]);
});

test("提交失败停止占位动画，原提示词保留，重试仍只保留一组待提交消息", () => {
    const local = { id: "local", title: "新创作", updatedAt: at, messages: [] };
    const submission = { id: "submit-1", prompt: "看看参考图", createdAt: at };
    const pending = (conversation as any).beginCreationAgentSubmission?.(local, submission);
    const failed = (conversation as any).failCreationAgentSubmission?.(pending, "submit-1", "请求超时");
    expect(failed?.messages).toEqual([
        expect.objectContaining({ role: "user", content: "看看参考图" }),
        expect.objectContaining({ role: "assistant", status: "error", error: "请求超时" }),
    ]);
    const retry = (conversation as any).beginCreationAgentSubmission?.(failed, submission);
    expect(retry?.messages).toHaveLength(2);
});

test("旧版按步骤存下的两个助手气泡恢复后合并，不残留旧气泡", () => {
    const first = run("run-1", "你好", "completed", [event("run-1", 1, "assistant_message", { messageId: "step-1", text: "我先查看" }), event("run-1", 2, "assistant_message", { messageId: "step-2", text: "查看完成" })]);
    const remote = conversation.projectCreationAgentConversation(session, [first as any]);
    const local = { ...remote, messages: [remote.messages[0], { id: "run-1:step-1", role: "assistant", mode: "agent", content: "我先查看", createdAt: at }, { id: "run-1:step-2", role: "assistant", mode: "agent", content: "查看完成", createdAt: at }] };
    const merged = conversation.mergeCreationAgentConversation(local as any, remote);
    expect(merged.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
});

test("服务端恢复的本轮有效附件保留稳定资源键，不从旧轮复活已清除素材", () => {
    const first = { ...run("run-1", "看看参考图", "completed", []), attachments: [{ resourceId: "image-1", storageKey: "resource:image-1", kind: "image", role: "product", name: "水杯图" }] };
    const second = { ...run("run-2", "不要用旧图", "completed", []), attachments: [] };
    const restored = conversation.projectCreationAgentConversation(session, [first as any, second as any]);
    expect(restored.messages.find((item) => item.id === "user-run-1")?.attachments).toEqual([expect.objectContaining({ storageKey: "resource:image-1", type: "image/*", role: "product", name: "水杯图" })]);
    expect(restored.messages.find((item) => item.id === "user-run-2")?.attachments?.length || 0).toBe(0);
    expect(restored.agentRuns?.at(-1)?.attachments).toEqual([]);
});

test("刷新恢复未收到回执的本地占位时停止动画并提示待确认，不伪造任务失败", () => {
    const local = conversation.beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, messages: [] }, { id: "agent-submission-local", prompt: "看看参考图", createdAt: at });
    const recovered = conversation.mergeCreationConversationHistory([local], []);
    expect(recovered.conversations[0].messages.find((item) => item.role === "assistant")).toMatchObject({ status: "error", error: "请求结果待确认，请先核对历史运行记录，或使用原提示词和设置重试" });
    expect(recovered.conversations[0].messages.find((item) => item.role === "user")?.content).toBe("看看参考图");
    expect(recovered.conversations[0].agentRunId).toBeUndefined();
});

test("发送前将精确幂等键和会话绑定到原乐观消息，不追加气泡", () => {
    const local = conversation.beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, messages: [] }, { id: "agent-submission-local", prompt: "看看参考图", createdAt: at });
    const bound = (conversation as any).bindCreationAgentSubmission?.(local, "agent-submission-local", session.id, "request-key-1");
    expect(bound?.agentSessionId).toBe(session.id);
    expect(bound?.messages).toHaveLength(2);
    expect(bound?.messages.map((message: any) => message.agentIdempotencyKey)).toEqual(["request-key-1", "request-key-1"]);
});

test("服务端接收但回执丢失后刷新，按幂等键替换乐观气泡并保留附件", () => {
    const attachment = { id: "image-1", name: "参考图", type: "image/png", storageKey: "resource:image-1", previewUrl: "https://example.com/a.png", url: "https://example.com/a.png", bytes: 10 };
    const pending = conversation.beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, agentSessionId: session.id, messages: [] }, { id: "agent-submission-local", prompt: "看看参考图", createdAt: at, attachments: [attachment] });
    const keyed = { ...pending, messages: pending.messages.map((message) => ({ ...message, agentIdempotencyKey: "request-key-1" })) };
    const remote = conversation.projectCreationAgentConversation(session, [{ ...run("run-1", "看看参考图", "completed", [event("run-1", 1, "assistant_message", { messageId: "step-1", text: "已查看图片" })]), idempotencyKey: "request-key-1" } as any]);
    const recovered = conversation.mergeCreationConversationHistory([keyed], [remote], "local");
    expect(recovered.conversations).toHaveLength(1);
    expect(recovered.conversations[0].messages).toEqual([
        expect.objectContaining({ id: "user-run-1", role: "user", attachments: [attachment] }),
        expect.objectContaining({ id: "run-1:assistant", role: "assistant", content: "已查看图片", status: "done" }),
    ]);
    expect((recovered as any).confirmedSubmissions).toEqual([{ conversationId: "local", key: "request-key-1" }]);
});

test("提示词和时间相同但幂等键不同，不擅自清除待确认输入", () => {
    const pending = conversation.beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, agentSessionId: session.id, messages: [] }, { id: "agent-submission-local", prompt: "你好", createdAt: at });
    const keyed = { ...pending, messages: pending.messages.map((message) => ({ ...message, agentIdempotencyKey: "unconfirmed-key" })) };
    const remote = conversation.projectCreationAgentConversation(session, [{ ...run("run-1", "你好", "completed", []), idempotencyKey: "different-key" } as any]);
    const recovered = conversation.mergeCreationConversationHistory([keyed], [remote]);
    expect(recovered.conversations[0].messages.some((message) => message.clientOperationId === "agent-submission-local")).toBe(true);
    expect((recovered as any).confirmedSubmissions).toEqual([]);
});

test("旧请求待确认时修改草稿重试，不覆盖已绑定幂等键的原输入", () => {
    const original = conversation.beginCreationAgentSubmission({ id: "local", title: "新创作", updatedAt: at, messages: [] }, { id: "agent-submission-local", prompt: "原始请求", createdAt: at });
    const keyed = { ...original, messages: original.messages.map((message) => ({ ...message, agentIdempotencyKey: "pending-key" })) };
    const retry = conversation.beginCreationAgentSubmission(keyed, { id: "agent-submission-local", prompt: "修改后的草稿", createdAt: at });
    expect(retry.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(["原始请求"]);
    expect((retry.messages[0] as any).agentIdempotencyKey).toBe("pending-key");
});

test("首个流式事件按稳定资源键保留本地视频地址、预览和尺寸", () => {
    const remote = conversation.projectCreationAgentConversation(session, [{ ...run("run-1", "看看视频", "running", []), attachments: [{ resourceId: "video-1", storageKey: "resource:video-1", kind: "video", role: "reference", name: "视频" }] } as any]);
    const localVideo = { id: "upload:video-1", storageKey: "resource:video-1", type: "video/mp4", name: "视频", url: "blob:video-local", previewUrl: "blob:poster-local", bytes: 1024, width: 1920, height: 1080, durationMs: 5000 };
    const current = { ...remote, messages: remote.messages.map((message) => message.role === "user" ? { ...message, attachments: [localVideo] } : message) };
    const streamed = conversation.appendCreationAgentEvent(current, event("run-1", 1, "assistant_delta", { messageId: "answer", text: "我先查看视频" }));
    expect(streamed.messages.find((message) => message.role === "user")?.attachments).toEqual([expect.objectContaining({ storageKey: "resource:video-1", type: "video/mp4", url: "blob:video-local", previewUrl: "blob:poster-local", bytes: 1024, width: 1920, height: 1080, durationMs: 5000 })]);
});

test("只从服务端恢复的视频仍具有稳定资源播放地址", () => {
    const restored = conversation.projectCreationAgentConversation(session, [{ ...run("run-1", "看看视频", "completed", []), attachments: [{ resourceId: "video-1", storageKey: "resource:video-1", kind: "video", role: "reference", name: "视频" }] } as any]);
    expect(restored.messages[0].attachments?.[0].url).toContain("/resources/video-1/file");
});
