import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommerceProject } from "../src/services/api/ecommerce";
import {
    clearEcommercePlanningReceipt,
    clearEcommerceWorkspace,
    createEcommerceSession,
    getEcommerceActiveProject,
    getEcommercePlanningReceipt,
    peekEcommerceWorkspace,
    readEcommerceWorkspace,
    setEcommerceActiveProject,
    setEcommercePlanningReceipt,
    subscribeEcommerceWorkspace,
    writeEcommerceWorkspace,
    type EcommerceSessionDependencies,
    type EcommerceWorkspaceCheckpoint,
} from "../src/services/ecommerce-session";

function project(id = crypto.randomUUID(), revision = 1): EcommerceProject {
    return { id, revision, name: "测试商品", status: "draft", draftJson: "{}", planJson: "{}", createdAt: "", updatedAt: "" };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function dependencies(scope: string, initial = project()) {
    const revisions: number[] = [];
    const names: string[] = [];
    let creates = 0;
    const adapter: EcommerceSessionDependencies = {
        activeScope: () => scope,
        createProject: async () => {
            creates++;
            return initial;
        },
        saveProject: async (current, draft) => {
            revisions.push(current.revision);
            names.push(draft.productName);
            return { ...current, revision: current.revision + 1, draftJson: JSON.stringify(draft) };
        },
    };
    return {
        adapter,
        revisions,
        names,
        get creates() {
            return creates;
        },
    };
}

describe("电商项目跨页面恢复", () => {
    test("已发送消息快照与下一轮输入独立，保存草稿后保留且不串项目", async () => {
        const scope = crypto.randomUUID();
        const sent = { ...emptyEcommerceDraft(), instruction: "已经发送的原需求", references: [{ resourceId: "original", role: "primary" as const }] };
        const checkpoint: EcommerceWorkspaceCheckpoint = { sessionId: "snapshot-session", project: project("snapshot-a"), draft: sent, plan: null, creationMode: "ai", autoGenerate: false, submittedDraft: sent };
        try {
            await writeEcommerceWorkspace(scope, checkpoint);
            const { submittedDraft: _, ...next } = checkpoint;
            await writeEcommerceWorkspace(scope, { ...next, draft: { ...sent, instruction: "新的输入", references: [] } });
            expect(peekEcommerceWorkspace(scope)?.submittedDraft?.instruction).toBe("已经发送的原需求");
            const cached = peekEcommerceWorkspace(scope)!;
            cached.submittedDraft!.references.length = 0;
            expect(peekEcommerceWorkspace(scope)?.submittedDraft?.references).toHaveLength(1);
            await writeEcommerceWorkspace(scope, { ...next, project: project("snapshot-b"), draft: emptyEcommerceDraft() });
            expect(peekEcommerceWorkspace(scope)?.submittedDraft).toBeUndefined();
            expect(peekEcommerceWorkspace("different-scope")).toBeNull();
        } finally {
            await clearEcommerceWorkspace(scope);
        }
    });
    test("离开再进入时共享尚未完成的新建，连续保存只创建一个项目并使用最新版本", async () => {
        const scope = crypto.randomUUID();
        const opening = deferred<EcommerceProject>();
        const started = deferred<void>();
        const server = dependencies(scope);
        let creates = 0;
        server.adapter.createProject = () => {
            creates++;
            started.resolve();
            return opening.promise;
        };
        const beforeNavigation = createEcommerceSession(scope, null, undefined, server.adapter);
        const firstDraft = { ...emptyEcommerceDraft(), productName: "提交分析前" };
        const first = beforeNavigation.save(firstDraft, null);
        firstDraft.productName = "调用后继续编辑";
        const afterNavigation = createEcommerceSession(scope, null, beforeNavigation.id, server.adapter);
        const second = afterNavigation.save({ ...emptyEcommerceDraft(), productName: "任务已提交", planningTaskId: "planning-1" }, null);
        await started.promise;
        expect(creates).toBe(1);
        opening.resolve(project());
        const [firstSaved, secondSaved] = await Promise.all([first, second]);
        expect(firstSaved.id).toBe(secondSaved.id);
        expect(server.revisions).toEqual([1, 2]);
        expect(server.names).toEqual(["提交分析前", "任务已提交"]);
        expect(afterNavigation.project?.revision).toBe(3);
        expect(beforeNavigation.project?.revision).toBe(3);
    });

    test("同一项目不同页面实例串行保存，过期 GET 不能回滚 revision", async () => {
        const scope = crypto.randomUUID();
        const current = project();
        const server = dependencies(scope, current);
        const one = createEcommerceSession(scope, current, undefined, server.adapter);
        const two = createEcommerceSession(scope, current, undefined, server.adapter);
        await Promise.all([one.save(emptyEcommerceDraft(), null), two.save(emptyEcommerceDraft(), null)]);
        two.adopt(current);
        expect(two.project?.revision).toBe(3);
        expect(server.revisions).toEqual([1, 2]);
        expect(server.creates).toBe(0);
        expect(() => two.adopt(project())).toThrow("项目已切换");
    });

    test("请求回执尚未返回时切页，原会话提交锁继续生效并通知返回页面", async () => {
        const scope = crypto.randomUUID();
        const current = project();
        const server = dependencies(scope, current);
        const first = createEcommerceSession(scope, current, undefined, server.adapter);
        const states: boolean[] = [];
        const unsubscribe = subscribeEcommerceWorkspace(scope, () => states.push(first.submitting));
        expect(first.beginSubmission()).toBe(true);
        const returned = createEcommerceSession(scope, current, undefined, server.adapter);
        expect(returned.submitting).toBe(true);
        expect(returned.beginSubmission()).toBe(false);
        first.endSubmission();
        expect(returned.submitting).toBe(false);
        expect(returned.beginSubmission()).toBe(true);
        returned.endSubmission();
        unsubscribe();
        expect(states).toEqual([true, false, true, false]);
    });

    test("保存失败不会遗失规划任务回执，也不会阻塞下一次保存", async () => {
        const scope = crypto.randomUUID();
        const current = project();
        const server = dependencies(scope, current);
        const originalSave = server.adapter.saveProject;
        let fail = true;
        server.adapter.saveProject = async (...args) => {
            if (fail) {
                fail = false;
                throw new Error("network unavailable");
            }
            return originalSave(...args);
        };
        const session = createEcommerceSession(scope, current, undefined, server.adapter);
        setEcommercePlanningReceipt(scope, current.id, "paid-task-1");
        const draft = { ...emptyEcommerceDraft(), planningTaskId: "paid-task-1" };
        await expect(session.save(draft, null)).rejects.toThrow("network unavailable");
        expect(getEcommercePlanningReceipt(scope, current.id)).toBe("paid-task-1");
        const saved = await session.save(draft, null);
        expect(saved.revision).toBe(2);
        expect(server.revisions).toEqual([1]);
        clearEcommercePlanningReceipt(scope, current.id);
        expect(getEcommercePlanningReceipt(scope, current.id)).toBeNull();
    });

    test("账号在新建响应前切换后，旧会话不会使用新登录态提交商品资料", async () => {
        const scope = crypto.randomUUID();
        let activeScope = scope;
        const opening = deferred<EcommerceProject>();
        const server = dependencies(scope);
        const started = deferred<void>();
        server.adapter.activeScope = () => activeScope;
        server.adapter.createProject = () => {
            started.resolve();
            return opening.promise;
        };
        const session = createEcommerceSession(scope, null, undefined, server.adapter);
        const pending = session.save(emptyEcommerceDraft(), null);
        await started.promise;
        activeScope = "another-account";
        opening.resolve(project());
        await expect(pending).rejects.toThrow("登录账号已切换");
        expect(server.revisions).toEqual([]);
        await expect(session.save(emptyEcommerceDraft(), null)).rejects.toThrow("登录账号已切换");
        expect(() => createEcommerceSession("guest")).toThrow("请先登录");
    });

    test("正在提交的旧页面写入任务 ID 后，返回页面同步获得同一用户检查点", async () => {
        const scope = crypto.randomUUID();
        const checkpoint: EcommerceWorkspaceCheckpoint = {
            sessionId: crypto.randomUUID(),
            draft: emptyEcommerceDraft(),
            plan: null,
            project: null,
            creationMode: "ai",
            autoGenerate: true,
        };
        await writeEcommerceWorkspace(scope, checkpoint);
        const observed: string[] = [];
        const unsubscribe = subscribeEcommerceWorkspace(scope, () => {
            observed.push(peekEcommerceWorkspace(scope)?.draft.planningTaskId || "");
        });
        const write = writeEcommerceWorkspace(scope, { ...checkpoint, draft: { ...checkpoint.draft, planningTaskId: "background-task" } });
        expect(observed).toEqual(["background-task"]);
        expect(peekEcommerceWorkspace(scope)?.autoGenerate).toBe(true);
        expect(peekEcommerceWorkspace("different-user")).toBeNull();
        const restored = await readEcommerceWorkspace(scope);
        restored!.draft.planningTaskId = "mutated-copy";
        expect(peekEcommerceWorkspace(scope)?.draft.planningTaskId).toBe("background-task");
        await write;
        unsubscribe();
        await clearEcommerceWorkspace(scope);
        expect(await readEcommerceWorkspace(scope)).toBeNull();
        expect(observed).toEqual(["background-task"]);
    });

    test("活动项目和任务回执按账号与项目隔离", () => {
        const scope = crypto.randomUUID();
        const anotherScope = crypto.randomUUID();
        setEcommerceActiveProject(scope, "project-a");
        setEcommerceActiveProject(anotherScope, "project-b");
        setEcommercePlanningReceipt(scope, "project-a", "task-a");
        expect(getEcommerceActiveProject(scope)).toBe("project-a");
        expect(getEcommerceActiveProject(anotherScope)).toBe("project-b");
        expect(getEcommercePlanningReceipt(anotherScope, "project-a")).toBeNull();
        expect(getEcommercePlanningReceipt(scope, "project-b")).toBeNull();
        setEcommerceActiveProject(scope, null);
        expect(getEcommerceActiveProject(scope)).toBeNull();
        expect(getEcommercePlanningReceipt(scope, "project-a")).toBe("task-a");
    });

    test("localStorage 配额失败时最新回执仍可同页恢复，恢复写入后可读取其他标签页更新", () => {
        const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        const values = new Map<string, string>();
        let rejectWrites = true;
        const storage = {
            getItem: (key: string) => values.get(key) || "stale-on-disk",
            setItem: (key: string, value: string) => {
                if (rejectWrites) throw new DOMException("quota", "QuotaExceededError");
                values.set(key, value);
            },
            removeItem: (key: string) => {
                if (rejectWrites) throw new DOMException("quota", "QuotaExceededError");
                values.delete(key);
            },
        };
        Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
        try {
            const scope = crypto.randomUUID();
            expect(setEcommerceActiveProject(scope, "new-project")).toBe(false);
            expect(setEcommercePlanningReceipt(scope, "new-project", "new-task")).toBe(false);
            expect(getEcommerceActiveProject(scope)).toBe("new-project");
            expect(getEcommercePlanningReceipt(scope, "new-project")).toBe("new-task");
            expect(clearEcommercePlanningReceipt(scope, "new-project")).toBe(false);
            expect(getEcommercePlanningReceipt(scope, "new-project")).toBeNull();
            rejectWrites = false;
            expect(setEcommerceActiveProject(scope, "persisted-project")).toBe(true);
            const activeKey = [...values.keys()][0]!;
            values.set(activeKey, "updated-in-another-tab");
            expect(getEcommerceActiveProject(scope)).toBe("updated-in-another-tab");
        } finally {
            if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
            else Reflect.deleteProperty(globalThis, "window");
        }
    });
});
