import { describe, expect, test } from "bun:test";

import {
    previsCaptureInitial,
    previsCaptureUsable,
    previsLoadIdentity,
    previsLoadInitial,
    installPrevisContextListeners,
    reducePrevisCapture,
    reducePrevisLoad,
    removePrevisFailedLoad,
    releasePrevisCapture,
    resolvePrevisDisplay,
    restorePrevisCapture,
    upsertPrevisFailedLoad,
    type PrevisCanvasTarget,
    type PrevisFailedLoads,
} from "../src/lib/canvas/previs/previs-recovery";

function fakeCanvas() {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const target: PrevisCanvasTarget = {
        addEventListener: (type, listener) => {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        removeEventListener: (type, listener) => {
            listeners.set(
                type,
                (listeners.get(type) || []).filter((item) => item !== listener),
            );
        },
    };
    return {
        target,
        emit: (type: string, event: Partial<Event> = {}) => (listeners.get(type) || []).forEach((listener) => listener(event as Event)),
        count: () => [...listeners.values()].reduce((sum, items) => sum + items.length, 0),
    };
}

describe("加载状态机：error -> retry -> ready（D3 回归）", () => {
    test("初始为 loading", () => {
        expect(previsLoadInitial).toEqual({ phase: "loading", generation: 0 });
    });

    test("失败后可 retry，retry 递增 generation 并回到 loading", () => {
        const failed = reducePrevisLoad(previsLoadInitial, { type: "failed", generation: 0 });
        expect(failed.phase).toBe("error");
        const retried = reducePrevisLoad(failed, { type: "retry" });
        expect(retried).toEqual({ phase: "loading", generation: 1 });
        const ready = reducePrevisLoad(retried, { type: "loaded", generation: 1 });
        expect(ready).toEqual({ phase: "ready", generation: 1 });
    });

    test("旧 generation 的晚到成功回调被忽略", () => {
        const retried = reducePrevisLoad(reducePrevisLoad(previsLoadInitial, { type: "failed", generation: 0 }), { type: "retry" });
        expect(reducePrevisLoad(retried, { type: "loaded", generation: 0 })).toBe(retried);
    });

    test("旧 generation 的晚到失败回调不会污染新一代", () => {
        const retried = reducePrevisLoad(previsLoadInitial, { type: "retry" });
        const ready = reducePrevisLoad(retried, { type: "loaded", generation: 1 });
        expect(reducePrevisLoad(ready, { type: "failed", generation: 0 })).toBe(ready);
        expect(ready.phase).toBe("ready");
    });

    test("start 不改变 generation，只回到 loading", () => {
        const ready = reducePrevisLoad(previsLoadInitial, { type: "loaded", generation: 0 });
        expect(reducePrevisLoad(ready, { type: "start" })).toEqual({ phase: "loading", generation: 0 });
    });

    test("连续 retry 单调递增，旧回调始终被拒", () => {
        let state = previsLoadInitial;
        for (let index = 0; index < 3; index += 1) state = reducePrevisLoad(state, { type: "retry" });
        expect(state.generation).toBe(3);
        [0, 1, 2].forEach((generation) => expect(reducePrevisLoad(state, { type: "loaded", generation })).toBe(state));
        expect(reducePrevisLoad(state, { type: "loaded", generation: 3 }).phase).toBe("ready");
    });
});

describe("WebGL 上下文监听（D2 回归）", () => {
    test("lost 必须 preventDefault，否则浏览器不补发 restored", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        installPrevisContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        let prevented = 0;
        canvas.emit("webglcontextlost", {
            preventDefault: () => {
                prevented += 1;
            },
        } as unknown as Event);
        expect(prevented).toBe(1);
        expect(events).toEqual(["lost"]);
    });

    test("restored 会回调恢复处理", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        installPrevisContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        canvas.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        canvas.emit("webglcontextrestored");
        expect(events).toEqual(["lost", "restored"]);
    });

    test("disposer 精确摘除全部监听", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        const dispose = installPrevisContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        expect(canvas.count()).toBe(2);
        dispose();
        expect(canvas.count()).toBe(0);
        canvas.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        canvas.emit("webglcontextrestored");
        expect(events).toEqual([]);
    });

    test("重复安装/摘除不互相干扰（renderer 重建场景）", () => {
        const first = fakeCanvas();
        const second = fakeCanvas();
        const events: string[] = [];
        const disposeFirst = installPrevisContextListeners(first.target, { onLost: () => events.push("first-lost"), onRestored: () => undefined });
        disposeFirst();
        installPrevisContextListeners(second.target, { onLost: () => events.push("second-lost"), onRestored: () => undefined });
        first.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        second.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        expect(events).toEqual(["second-lost"]);
    });
});

describe("失败登记表不残留陈旧条目（#4 回归）", () => {
    const retryA = () => undefined;
    const retryB = () => undefined;

    test("error 登记 -> unmounted 注销 -> 空表", () => {
        const registered = upsertPrevisFailedLoad({}, "a", "error", retryA);
        expect(Object.keys(registered)).toEqual(["a"]);
        expect(upsertPrevisFailedLoad(registered, "a", "unmounted", retryA)).toEqual({});
    });

    test("retry 回到 loading 会移除该条目", () => {
        const registered = upsertPrevisFailedLoad({}, "a", "error", retryA);
        expect(upsertPrevisFailedLoad(registered, "a", "loading", retryA)).toEqual({});
    });

    test("ready 也会移除", () => {
        const registered = upsertPrevisFailedLoad({}, "a", "error", retryA);
        expect(upsertPrevisFailedLoad(registered, "a", "ready", retryA)).toEqual({});
    });

    test("注销一个对象不影响相邻对象", () => {
        let table: PrevisFailedLoads = {};
        table = upsertPrevisFailedLoad(table, "a", "error", retryA);
        table = upsertPrevisFailedLoad(table, "b", "error", retryB);
        expect(Object.keys(table).sort()).toEqual(["a", "b"]);
        const afterUnmount = upsertPrevisFailedLoad(table, "a", "unmounted", retryA);
        expect(Object.keys(afterUnmount)).toEqual(["b"]);
        expect(afterUnmount.b).toBe(retryB);
    });

    test("重复 error 不产生新引用（避免无谓重渲染）", () => {
        const registered = upsertPrevisFailedLoad({}, "a", "error", retryA);
        expect(upsertPrevisFailedLoad(registered, "a", "error", retryA)).toBe(registered);
    });

    test("removePrevisFailedLoad 对不存在的 id 是同引用空操作", () => {
        const table = upsertPrevisFailedLoad({}, "a", "error", retryA);
        expect(removePrevisFailedLoad(table, "missing")).toBe(table);
        expect(removePrevisFailedLoad(table, "a")).toEqual({});
    });
});

describe("capture 可用性随上下文丢失/恢复（#7 回归）", () => {
    test("未登记时不可用", () => {
        expect(previsCaptureUsable(previsCaptureInitial)).toBe(false);
    });

    test("登记后可用；lost 期间立即不可用", () => {
        const registered = reducePrevisCapture(previsCaptureInitial, "register");
        expect(previsCaptureUsable(registered)).toBe(true);
        const lost = reducePrevisCapture(registered, "lost");
        expect(previsCaptureUsable(lost)).toBe(false);
    });

    test("restored 之后必须重新登记才可用", () => {
        const lost = reducePrevisCapture(reducePrevisCapture(previsCaptureInitial, "register"), "lost");
        const restored = reducePrevisCapture(lost, "restored");
        expect(restored.contextLost).toBe(false);
        expect(previsCaptureUsable(restored)).toBe(false);
        expect(previsCaptureUsable(reducePrevisCapture(restored, "register"))).toBe(true);
    });

    test("reset（手动重建）回到不可用初态", () => {
        const registered = reducePrevisCapture(previsCaptureInitial, "register");
        expect(reducePrevisCapture(registered, "reset")).toEqual(previsCaptureInitial);
    });

    test("restorePrevisCapture 走完整序列后 registered=true / contextLost=false（#7 生产接线回归）", () => {
        // 用生产 handler 调用的同一个 helper 驱动真实 reducer，
        // 避免「reducer 单测过、生产漏掉 register」这种脱节。
        let state = reducePrevisCapture(reducePrevisCapture(previsCaptureInitial, "register"), "lost");
        expect(previsCaptureUsable(state)).toBe(false);
        const contexts: string[] = [];
        let invalidated = 0;
        restorePrevisCapture<string>({
            readContext: () => "renderer-after-restore",
            onAvailability: (event) => {
                state = reducePrevisCapture(state, event);
            },
            onRegister: (context) => {
                contexts.push(context);
                state = reducePrevisCapture(state, "register");
            },
            invalidate: () => {
                invalidated += 1;
            },
        });
        expect(contexts).toEqual(["renderer-after-restore"]);
        expect(state).toEqual({ registered: true, contextLost: false });
        expect(previsCaptureUsable(state)).toBe(true);
        expect(invalidated).toBe(1);
    });

    test("序列顺序固定：先复位可用性，再登记，最后重绘", () => {
        const order: string[] = [];
        restorePrevisCapture<string>({
            readContext: () => "ctx",
            onAvailability: () => order.push("availability"),
            onRegister: () => order.push("register"),
            invalidate: () => order.push("invalidate"),
        });
        expect(order).toEqual(["availability", "register", "invalidate"]);
    });

    test("只走 availability 而漏掉 register 时仍不可用（说明缺陷形态）", () => {
        let state = reducePrevisCapture(reducePrevisCapture(previsCaptureInitial, "register"), "lost");
        state = reducePrevisCapture(state, "restored");
        expect(state.contextLost).toBe(false);
        expect(previsCaptureUsable(state)).toBe(false);
    });

    test("readContext 在登记时被求值一次，拿到的是恢复后的新引用", () => {
        let reads = 0;
        const seen: string[] = [];
        restorePrevisCapture<string>({
            readContext: () => {
                reads += 1;
                return `ctx-${reads}`;
            },
            onAvailability: () => undefined,
            onRegister: (context) => seen.push(context),
        });
        expect(reads).toBe(1);
        expect(seen).toEqual(["ctx-1"]);
    });
});

describe("capture 释放路径（子树卸载 / boundary 捕获）", () => {
    /** 与生产接线同构：captureContext ref + capture reducer，只是不挂 React。 */
    function harness() {
        let context: string | null = null;
        let state = previsCaptureInitial;
        return {
            usable: () => previsCaptureUsable(state) && context !== null,
            context: () => context,
            register: (next: string) => {
                context = next;
                state = reducePrevisCapture(state, "register");
            },
            release: () =>
                releasePrevisCapture({
                    clearContext: () => {
                        context = null;
                    },
                    onAvailability: (event) => {
                        state = reducePrevisCapture(state, event);
                    },
                }),
            state: () => state,
        };
    }

    test("release 后 context 被清空且 capture 不可用", () => {
        const h = harness();
        h.register("renderer-1");
        expect(h.usable()).toBe(true);
        h.release();
        expect(h.context()).toBeNull();
        expect(h.state()).toEqual(previsCaptureInitial);
        expect(h.usable()).toBe(false);
    });

    test("release 之后仍能由新 renderer 重新 register（重试路径不被堵死）", () => {
        const h = harness();
        h.register("renderer-1");
        h.release();
        h.register("renderer-2");
        expect(h.context()).toBe("renderer-2");
        expect(h.usable()).toBe(true);
    });

    test("重复 release 幂等，且 reset 在初态返回同一引用（避免无限 render）", () => {
        const h = harness();
        h.register("renderer-1");
        h.release();
        const first = h.state();
        h.release();
        expect(h.state()).toBe(first);
        expect(h.usable()).toBe(false);
    });

    test("上下文丢失期间 release 同样归零，不残留 contextLost", () => {
        const h = harness();
        h.register("renderer-1");
        const lost = reducePrevisCapture(h.state(), "lost");
        expect(previsCaptureUsable(lost)).toBe(false);
        h.release();
        expect(h.state()).toEqual(previsCaptureInitial);
        expect(h.context()).toBeNull();
    });
});

describe("展示身份在 render 阶段屏蔽旧资源（#2 回归）", () => {
    test("identity 由 generation 与解析输入共同决定", () => {
        const base = { generation: 0, url: "a.glb", storageKey: "k", kind: "model" };
        expect(previsLoadIdentity(base)).toBe(previsLoadIdentity({ ...base }));
        expect(previsLoadIdentity({ ...base, generation: 1 })).not.toBe(previsLoadIdentity(base));
        expect(previsLoadIdentity({ ...base, url: "b.glb" })).not.toBe(previsLoadIdentity(base));
        expect(previsLoadIdentity({ ...base, storageKey: "k2" })).not.toBe(previsLoadIdentity(base));
        expect(previsLoadIdentity({ ...base, kind: "actor" })).not.toBe(previsLoadIdentity(base));
    });

    test("换 URL 的那一次 render 立刻不再交出旧资源", () => {
        const oldIdentity = previsLoadIdentity({ generation: 0, url: "old.glb" });
        const loaded = { identity: oldIdentity, value: "old-model" };
        // 仍是同一 identity：正常展示。
        expect(resolvePrevisDisplay(loaded, oldIdentity)).toBe("old-model");
        // URL 变化后的第一次 render：identity 不匹配，立即当作无资源（此时 cleanup 还没 dispose）。
        expect(resolvePrevisDisplay(loaded, previsLoadIdentity({ generation: 0, url: "new.glb" }))).toBeNull();
    });

    test("retry 递增 generation 后旧资源同样被屏蔽", () => {
        const loaded = { identity: previsLoadIdentity({ generation: 0, url: "a.glb" }), value: "gen0" };
        expect(resolvePrevisDisplay(loaded, previsLoadIdentity({ generation: 1, url: "a.glb" }))).toBeNull();
    });

    test("空状态安全", () => {
        expect(resolvePrevisDisplay(null, previsLoadIdentity({ generation: 0 }))).toBeNull();
    });
});
