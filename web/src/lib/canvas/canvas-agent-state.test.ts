import { describe, expect, it } from "bun:test";

import {
    AGENT_STATE_VERSION,
    agentTaskSummary,
    canTransition,
    classifyNodeTask,
    clearAgentState,
    createEmptyAgentState,
    deriveAgentStateFromNodes,
    filterGenerationOps,
    loadAgentState,
    markTaskCompleted,
    markTaskFailed,
    markTaskSubmitted,
    reconcileAgentState,
    saveAgentState,
    setCreationPhase,
    shouldSubmitGeneration,
    type AgentStateStorage,
} from "./canvas-agent-state";
import type { CanvasNodeData } from "@/types/canvas";

function memoryStorage(): AgentStateStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
    };
}

function node(id: string, metadata: Record<string, unknown> = {}): Pick<CanvasNodeData, "id" | "metadata"> {
    return { id, metadata };
}

describe("agentState 状态转换规则", () => {
    it("允许无→pending、pending→completed/failed，且终态幂等", () => {
        expect(canTransition(undefined, "pending", false)).toBe(true);
        expect(canTransition("pending", "completed", false)).toBe(true);
        expect(canTransition("pending", "failed", false)).toBe(true);
        expect(canTransition("completed", "completed", false)).toBe(true);
        expect(canTransition("failed", "failed", false)).toBe(true);
    });

    it("completed/failed 只有显式 retry 才能重新回到 pending", () => {
        expect(canTransition("completed", "pending", false)).toBe(false);
        expect(canTransition("completed", "pending", true)).toBe(true);
        expect(canTransition("failed", "pending", false)).toBe(false);
        expect(canTransition("failed", "pending", true)).toBe(true);
    });

    it("pending 重复 pending 属于幂等（changed=false），真正拦截发生在 shouldSubmitGeneration", () => {
        const state = createEmptyAgentState("generating", 1000);
        const submitted = markTaskSubmitted(state, "n1", { at: 1001 });
        expect(submitted.ok).toBe(true);
        if (!submitted.ok) return;
        const again = markTaskSubmitted(submitted.state, "n1", { at: 1002 });
        expect(again.ok).toBe(true);
        expect(again.ok && again.changed).toBe(false);
        // 防重复提交由 shouldSubmitGeneration 负责
        expect(shouldSubmitGeneration(submitted.state, "n1").submit).toBe(false);
    });

    it("mark* 返回 changed 标记，幂等更新不产生新状态", () => {
        let state = createEmptyAgentState("generating", 0);
        const a = markTaskSubmitted(state, "n1", { taskId: "t1", at: 1 });
        expect(a.ok && a.changed).toBe(true);
        if (!a.ok) return;
        state = a.state;
        const same = markTaskSubmitted(state, "n1", { taskId: "t1", at: 2 });
        expect(same.ok).toBe(true);
        expect(same.ok && same.changed).toBe(false);
    });

    it("缺少 nodeId 属于边界非法输入", () => {
        const result = markTaskSubmitted(createEmptyAgentState(), "");
        expect(result.ok).toBe(false);
    });
});

describe("从真实节点派生生命周期", () => {
    it("queued/running/processing 归为 pending", () => {
        expect(classifyNodeTask(node("a", { taskId: "t", taskStatus: "running" }))?.lifecycle).toBe("pending");
        expect(classifyNodeTask(node("b", { taskId: "t", taskOfficialStatus: "queued" }))?.lifecycle).toBe("pending");
    });

    it("成功且资源就绪归为 completed", () => {
        const record = classifyNodeTask(node("a", { taskId: "t", taskStatus: "succeeded", status: "success", storageKey: "k" }));
        expect(record?.lifecycle).toBe("completed");
    });

    it("provider 成功但资源未物化仍算 pending，避免窗口期重复提交", () => {
        const record = classifyNodeTask(node("a", { taskId: "t", taskStatus: "succeeded" }));
        expect(record?.lifecycle).toBe("pending");
    });

    it("失败/取消归为 failed；无任务节点返回 null", () => {
        expect(classifyNodeTask(node("a", { taskId: "t", taskStatus: "failed" }))?.lifecycle).toBe("failed");
        expect(classifyNodeTask(node("b", { taskId: "t", agentGenerationContinuation: { status: "failed" } }))?.lifecycle).toBe("failed");
        expect(classifyNodeTask(node("c", { status: "idle" }))).toBeNull();
    });

    it("deriveAgentStateFromNodes 聚合全部任务并在仍有进行中时锁定 generating 阶段", () => {
        const state = deriveAgentStateFromNodes([
            node("a", { taskId: "1", taskStatus: "running" }),
            node("b", { taskId: "2", taskStatus: "succeeded", status: "success", storageKey: "k" }),
            node("c", { status: "idle" }),
        ], "review");
        expect(Object.keys(state.tasks).sort()).toEqual(["a", "b"]);
        expect(state.phase).toBe("generating"); // 有 pending，不允许跳到 review
        expect(agentTaskSummary(state)).toEqual({ pending: 1, completed: 1, failed: 0, total: 2 });
    });
});

describe("防重复提交", () => {
    it("进行中/已完成默认不重复提交，失败需显式 retry", () => {
        const running = markTaskSubmitted(createEmptyAgentState(), "p", { taskId: "t" });
        expect(running.ok).toBe(true);
        if (!running.ok) return;
        expect(shouldSubmitGeneration(running.state, "p").submit).toBe(false);

        let done = createEmptyAgentState();
        const c = markTaskCompleted(done, "d", { taskId: "t2" });
        if (c.ok) done = c.state;
        const decision = shouldSubmitGeneration(done, "d");
        expect(decision.submit).toBe(false);
        if (!decision.submit) expect(decision.reason).toBe("completed");
        expect(shouldSubmitGeneration(done, "d", { retry: true }).submit).toBe(true);

        let failedState = createEmptyAgentState();
        const f = markTaskFailed(failedState, "f");
        if (f.ok) failedState = f.state;
        const failDecision = shouldSubmitGeneration(failedState, "f");
        expect(failDecision.submit).toBe(false);
        if (!failDecision.submit) expect(failDecision.reason).toBe("failed-needs-retry");
    });

    it("真实节点上的活跃任务即使内存状态为空也能挡住重复提交", () => {
        const state = createEmptyAgentState();
        const decision = shouldSubmitGeneration(state, "n", { target: node("n", { taskId: "t", taskStatus: "running" }) });
        expect(decision.submit).toBe(false);
    });

    it("filterGenerationOps 拆分待提交与跳过清单", () => {
        let state = createEmptyAgentState();
        const a = markTaskSubmitted(state, "busy", { taskId: "t" });
        if (a.ok) state = a.state;
        const ops = [
            { nodeId: "busy" },
            { nodeId: "fresh" },
            { nodeId: "busy", retry: true },
        ];
        const nodeById = new Map<string, Pick<CanvasNodeData, "id" | "metadata">>();
        const { toSubmit, skipped } = filterGenerationOps(state, ops, nodeById);
        expect(toSubmit.map((op) => op.nodeId)).toEqual(["fresh", "busy"]);
        expect(skipped).toHaveLength(1);
        expect(skipped[0].op.nodeId).toBe("busy");
    });

    it("缺少 nodeId 判定为 no-target", () => {
        expect(shouldSubmitGeneration(createEmptyAgentState(), undefined).submit).toBe(false);
    });
});

describe("刷新恢复与对账", () => {
    it("reconcile 以真实节点为准，并用持久化记录补全 mode/taskId", () => {
        const persisted = createEmptyAgentState("generating");
        const withTask = markTaskSubmitted(persisted, "a", { taskId: "persisted-t", mode: "video" });
        const derived = deriveAgentStateFromNodes([node("a", { taskStatus: "running" })], "generating");
        const merged = reconcileAgentState(derived, withTask.ok ? withTask.state : null);
        expect(merged.tasks.a.taskId).toBe("persisted-t");
        expect(merged.tasks.a.mode).toBe("video");
        expect(merged.tasks.a.lifecycle).toBe("pending");
    });

    it("持久化版本不匹配时安全回退到派生状态", () => {
        const derived = deriveAgentStateFromNodes([node("a", { taskId: "t", taskStatus: "running" })]);
        const stale = { ...createEmptyAgentState(), version: 999 as never };
        const merged = reconcileAgentState(derived, stale);
        expect(merged).toEqual(derived);
    });
});

describe("本地持久化", () => {
    it("按项目隔离存取，损坏/缺版本返回 null 自愈", () => {
        const storage = memoryStorage();
        const state = deriveAgentStateFromNodes([node("a", { taskId: "t", taskStatus: "running" })]);
        expect(saveAgentState("proj-1", state, storage)).toBe(true);
        expect(loadAgentState("proj-1", storage)?.version).toBe(AGENT_STATE_VERSION);
        expect(loadAgentState("proj-2", storage)).toBeNull();
        storage.setItem("canvas-agent-state:proj-1", "{not-json");
        expect(loadAgentState("proj-1", storage)).toBeNull();
        clearAgentState("proj-1", storage);
    });

    it("无 storage 时安全降级，不抛错", () => {
        expect(saveAgentState("p", createEmptyAgentState(), undefined)).toBe(false);
        expect(loadAgentState("p", undefined)).toBeNull();
    });
});

describe("创作阶段", () => {
    it("setCreationPhase 幂等且不产生多余对象", () => {
        const state = createEmptyAgentState("idle");
        expect(setCreationPhase(state, "idle")).toBe(state);
        expect(setCreationPhase(state, "planning").phase).toBe("planning");
    });
});
