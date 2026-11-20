import { afterEach, describe, expect, test } from "bun:test";
import { agentPageContextKey, isAgentPageContext, sameAgentRequestTarget, type AgentPageContext } from "@/lib/agent-page-context";
import { agentOutboxDispatchBlocker, agentOutboxInterjectBlocker, parseAgentOutbox, rebindAgentOutboxItem, type AgentOutbox, type AgentOutboxDispatchContext } from "@/lib/canvas/agent-outbox";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

const page: AgentPageContext = { kind: "drama", projectId: "project", episodeId: "episode", shotId: "shot" };
const queued: AgentOutbox = {
    version: 1,
    items: [
        {
            id: "queued-message",
            text: "优化这镜对白",
            canvasId: "",
            pageContext: page,
            focusNodeIds: [],
            focusNodeOmittedCount: 0,
            status: "queued",
            createdAt: "2026-11-13T00:00:00Z",
            settings: { model: "test", permissionMode: "request_approval", reasoningMode: "auto", skillIds: [], contextScope: [], maxCredits: "20", maxGenerationTasks: "0", maxVideoSeconds: "0" },
        },
    ],
};
const ready: AgentOutboxDispatchContext = { ready: true, requestInFlight: false, run: null, connected: true, canvasBusy: false, canvasId: "", canvasReady: true, pageContext: page };
afterEach(() => useGlobalAgentStore.getState().reset());

describe("当前短剧页面目标", () => {
    test("页面身份校验拒绝缺少集的镜头，身份比较包括项目、集与镜头", () => {
        expect(isAgentPageContext(page)).toBe(true);
        expect(isAgentPageContext({ kind: "drama", projectId: "p" })).toBe(true);
        expect(isAgentPageContext({ kind: "drama", projectId: "p", shotId: "shot" })).toBe(false);
        expect(isAgentPageContext({ ...page, projectId: " " })).toBe(false);
        expect(isAgentPageContext({ ...page, episodeId: "e\n1" })).toBe(false);
        expect(agentPageContextKey(null)).toBe("");
        expect(sameAgentRequestTarget({ canvasId: "", pageContext: page }, { canvasId: "", pageContext: { ...page, shotId: "other" } })).toBe(false);
    });

    test("全局预填只打开助手并冻结目标，不随页面后来切换，连续请求也不复用编号", () => {
        const store = useGlobalAgentStore.getState();
        store.setPage({ context: page, label: "第 1 集 · 镜头 1" });
        store.requestPrefill({ text: "读取当前镜头", displayText: "讨论镜头 1" });
        const first = useGlobalAgentStore.getState().prefillRequest!;
        expect(useGlobalAgentStore.getState().open).toBe(true);
        expect(first.autoSubmit).toBeUndefined();
        store.setPage({ context: { ...page, shotId: "other" }, label: "镜头 2" });
        expect(first.target).toEqual({ canvasId: "", pageContext: page });
        store.requestPrefill({ text: "另一个镜头" });
        const second = useGlobalAgentStore.getState().prefillRequest!;
        expect(second.id).not.toBe(first.id);
        store.clearPrefill(first.id);
        expect(useGlobalAgentStore.getState().prefillRequest?.id).toBe(second.id);
        store.clearPrefill(second.id);
        expect(useGlobalAgentStore.getState().prefillRequest).toBeNull();
    });

    test("队列重载保留目标，换项目、集、镜头或离页均暂停自动发送", () => {
        const restored = parseAgentOutbox(JSON.parse(JSON.stringify(queued)))!;
        expect(restored.items[0].pageContext).toEqual(page);
        expect(agentOutboxDispatchBlocker(restored, ready)).toBeNull();
        for (const next of [undefined, { ...page, projectId: "another" }, { ...page, episodeId: "another" }, { ...page, shotId: "another" }]) {
            expect(agentOutboxDispatchBlocker(restored, { ...ready, pageContext: next })).toBe("scope_changed");
        }
        expect(parseAgentOutbox({ ...queued, items: [{ ...queued.items[0], pageContext: { ...page, episodeId: undefined } }] })).toBeNull();
        const rebound = rebindAgentOutboxItem(restored, restored.items[0].id, "", { ...page, shotId: "chosen" });
        expect(rebound.items[0].pageContext?.shotId).toBe("chosen");
        expect(restored.items[0].pageContext?.shotId).toBe("shot");
    });

    test("当前页消息不能插入另一个分镜或全局对话的运行", () => {
        const context = { run: { status: "running" as const, canvasId: "", pageContext: page }, connected: true, stopping: false, canvasBusy: false, requestPending: false };
        expect(agentOutboxInterjectBlocker(queued.items[0], context)).toBeNull();
        expect(agentOutboxInterjectBlocker(queued.items[0], { ...context, run: { ...context.run, pageContext: { ...page, shotId: "other" } } })).toContain("分镜已变化");
        expect(agentOutboxInterjectBlocker(queued.items[0], { ...context, run: { ...context.run, pageContext: undefined } })).toContain("分镜已变化");
    });
});
