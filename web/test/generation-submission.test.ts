import { expect, test } from "bun:test";
import { createGenerationSubmissionStore, isGenerationSubmissionUnconfirmed } from "../src/services/generation-submission";
import { ApiError } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";

const task = (id: string) => ({ id, status: "running" }) as GenerationTask;
function fixture() {
    let scope = "alice";
    const saved = new Map<string, string>();
    const accepted = new Map<string, GenerationTask>();
    const dependencies = {
        getScope: () => scope,
        getStorage: (user: string) => ({
            getItem: async (key: string) => saved.get(`${user}:${key}`) || null,
            setItem: async (key: string, value: string) => {
                saved.set(`${user}:${key}`, value);
            },
            removeItem: async (key: string) => {
                saved.delete(`${user}:${key}`);
            },
        }),
        findTask: async (key: string) => accepted.get(key) || null,
    };
    return {
        saved,
        accepted,
        dependencies,
        store: createGenerationSubmissionStore(dependencies),
        switchUser: () => {
            scope = "bob";
        },
    };
}

test("创建回执丢失后，刷新页面仍按原 key 找回唯一任务，不重复 POST", async () => {
    const f = fixture();
    let sends = 0;
    await f.store.prepare("op", ["op"]);
    try {
        await f.store.submit("op", "op", async () => {
            sends++;
            f.accepted.set("op", task("original"));
            throw new ApiError("gateway", { status: 502 });
        });
    } catch (error) {
        expect(isGenerationSubmissionUnconfirmed(error)).toBe(true);
    }
    expect(await f.store.hasPending("op")).toBe(true);
    const reloaded = createGenerationSubmissionStore(f.dependencies);
    expect((await reloaded.recover("op")).map((item) => item.id)).toEqual(["original"]);
    expect(sends).toBe(1);
    expect(await reloaded.hasPending("op")).toBe(false);
    expect([...f.saved.values()].join("")).not.toContain("gateway");
});

test("尚未接收的请求复用原提交闭包；同时新视频仍可独立创建", async () => {
    const f = fixture();
    let sends = 0;
    await f.store.prepare("first", ["first"]);
    await expect(
        f.store.submit("first", "first", async () => {
            if (++sends === 1) throw new ApiError("offline", { retryable: true });
            return task("first-task");
        }),
    ).rejects.toThrow("提交状态待确认");
    await f.store.prepare("second", ["second"]);
    expect((await f.store.submit("second", "second", async () => task("second-task"))).id).toBe("second-task");
    expect((await f.store.recover("first"))[0].id).toBe("first-task");
    expect(sends).toBe(2);
});

test("刷新后未查到任务且没有原请求，不猜测参数创建收费任务", async () => {
    const f = fixture();
    await f.store.prepare("op", ["op"]);
    const reloaded = createGenerationSubmissionStore(f.dependencies);
    await expect(reloaded.recover("op")).rejects.toThrow("提交状态待确认");
    expect(await reloaded.hasPending("op")).toBe(true);
});

test("另一浏览器没有本地索引时按历史消息的原 key 找回任务", async () => {
    const f = fixture();
    f.accepted.set("old:batch:0", task("first"));
    f.accepted.set("old:batch:1", task("second"));
    const results = await f.store.recover("old", { keys: ["old:batch:0", "old:batch:1"] });
    expect(results.map((item) => item.id)).toEqual(["first", "second"]);
    expect(await f.store.hasPending("old")).toBe(false);
});

test("补回索引仍查不到任务时保留未知，不因为 GET null 新建任务", async () => {
    const f = fixture();
    await expect(f.store.recover("missing", { keys: ["missing"] })).rejects.toThrow("提交状态待确认");
    expect(await f.store.hasPending("missing")).toBe(true);
});

test("已有索引优先于历史推导，明确拒绝的空批次返回可重试错误", async () => {
    const f = fixture();
    await f.store.prepare("rejected", ["rejected"]);
    await expect(
        f.store.submit("rejected", "rejected", async () => {
            throw new ApiError("余额不足", { status: 400 });
        }),
    ).rejects.toThrow("余额不足");
    await expect(f.store.recover("rejected", { keys: ["wrong-key"] })).rejects.toMatchObject({ reason: "generation_submission_rejected", retryable: false });
    expect(await f.store.hasPending("rejected")).toBe(false);
});

test("批量回执部分丢失，已确认项不重投，未确认项继续保留", async () => {
    const f = fixture();
    await f.store.prepare("batch", ["batch:0", "batch:1"]);
    f.accepted.set("batch:0", task("done"));
    await f.store.submit("batch", "batch:0", async () => task("done"));
    const seen: string[] = [];
    await expect(f.store.recover("batch", { onTaskUpdate: (value) => seen.push(value.id) })).rejects.toThrow("提交状态待确认");
    expect(seen).toEqual(["done"]);
    f.accepted.set("batch:1", task("late"));
    expect((await f.store.recover("batch")).map((value) => value.id)).toEqual(["done", "late"]);
});

test("明确业务拒绝保留原报错，不标记为未知提交", async () => {
    const f = fixture();
    await f.store.prepare("op", ["op"]);
    await expect(
        f.store.submit("op", "op", async () => {
            throw new ApiError("余额不足", { status: 400 });
        }),
    ).rejects.toThrow("余额不足");
    expect(await f.store.hasPending("op")).toBe(false);
});

test("后端明确限流拒绝保留重试语义，不掩盖原业务错误", async () => {
    const f = fixture();
    await f.store.prepare("rate", ["rate"]);
    const error = new ApiError("请求过于频繁", { status: 429, reason: "rate_limited" });
    await expect(
        f.store.submit("rate", "rate", async () => {
            throw error;
        }),
    ).rejects.toBe(error);
    expect(await f.store.hasPending("rate")).toBe(false);
});

test("同 key 先明确拒绝再重试丢回执，重新进入待确认并能找回已创建任务", async () => {
    const f = fixture();
    await f.store.prepare("retry", ["retry"]);
    await expect(
        f.store.submit("retry", "retry", async () => {
            throw new ApiError("账务待核对", { status: 400 });
        }),
    ).rejects.toThrow("账务待核对");
    await f.store.prepare("retry", ["retry"]);
    await expect(
        f.store.submit("retry", "retry", async () => {
            f.accepted.set("retry", task("accepted-after-review"));
            throw new ApiError("gateway", { status: 502 });
        }),
    ).rejects.toThrow("提交状态待确认");
    expect(await f.store.hasPending("retry")).toBe(true);
    expect((await f.store.recover("retry"))[0].id).toBe("accepted-after-review");
});

test("已经确认的相同操作再次调用只查原任务，不被不同参数的新请求覆盖", async () => {
    const f = fixture();
    await f.store.prepare("confirmed", ["confirmed"]);
    f.accepted.set("confirmed", task("accepted"));
    await f.store.submit("confirmed", "confirmed", async () => task("accepted"));
    let reposted = false;
    expect(
        (
            await f.store.submit("confirmed", "confirmed", async () => {
                reposted = true;
                return task("wrong");
            })
        ).id,
    ).toBe("accepted");
    expect(reposted).toBe(false);
});

test("持久化失败时不发收费请求，账号切换后不恢复其它账号请求", async () => {
    const f = fixture();
    let sends = 0;
    const broken = createGenerationSubmissionStore({
        ...f.dependencies,
        getStorage: () => ({
            ...f.dependencies.getStorage("alice"),
            setItem: async () => {
                throw new Error("storage full");
            },
        }),
    });
    await expect(broken.prepare("op", ["op"])).rejects.toThrow("storage full");
    await f.store.prepare("alice-op", ["alice-op"]);
    f.switchUser();
    await expect(
        f.store.submit("alice-op", "alice-op", async () => {
            sends++;
            return task("no");
        }),
    ).rejects.toThrow();
    expect(sends).toBe(0);
});
