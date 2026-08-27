import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import localforage from "localforage";

import {
    DIRECTOR_ONBOARDING_KEY,
    DIRECTOR_ONBOARDING_STEPS,
    DIRECTOR_ONBOARDING_VERSION,
    advanceDirectorOnboarding,
    createDirectorOnboardingGate,
    directorOnboardingInitial,
    loadDirectorOnboardingProgress,
    parseDirectorOnboardingProgress,
    reduceDirectorOnboarding,
    resetDirectorOnboardingProgress,
    resolveDirectorOnboardingView,
    saveDirectorOnboardingProgress,
    type DirectorOnboardingAction,
    type DirectorOnboardingProgress,
    type DirectorOnboardingStorage,
} from "../src/lib/canvas/director/director-onboarding";

const ACTIVE: DirectorOnboardingProgress = directorOnboardingInitial;

function progressAt(stepId: DirectorOnboardingProgress["stepId"], status: DirectorOnboardingProgress["status"] = "active"): DirectorOnboardingProgress {
    return { version: DIRECTOR_ONBOARDING_VERSION, status, stepId };
}

/**
 * 剥掉源码里的注释再做契约断言：文档注释里出于说明目的提到的反例词
 * （比如「不是 role="dialog"」这句话本身）不该让断言把「提到」误判成「使用」。
 */
function stripComments(source: string) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 单 scope 的内存存储接缝。生产路径由 localForageStorageForScope 加 `:user:<scope>`，这里只验状态流转。 */
function memoryStorage(initial?: string) {
    const writes: string[] = [];
    let value = initial ?? null;
    const storage: DirectorOnboardingStorage = {
        getItem: async () => value,
        setItem: async (_name, next) => {
            value = next;
            writes.push(next);
        },
    };
    return {
        storage,
        writes,
        current: () => value,
    };
}

/**
 * 真实持久路径的探针：接住 localforage 的默认实例，并记录任何 localStorage 触碰。
 * 引导进度必须只走 IndexedDB —— localStorage 只允许存小型 UI 偏好。
 */
function localforageHarness(options?: { failReads?: boolean }) {
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalWindow = (globalThis as { window?: unknown }).window;
    const durable = new Map<string, string>();
    const localStorageCalls: string[] = [];

    const localStorageProbe = {
        getItem: (key: string) => {
            localStorageCalls.push(`get:${key}`);
            return null;
        },
        setItem: (key: string) => {
            localStorageCalls.push(`set:${key}`);
        },
        removeItem: (key: string) => {
            localStorageCalls.push(`remove:${key}`);
        },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageProbe } });
    localforage.getItem = (async (key: string) => {
        if (options?.failReads) throw new Error("indexeddb unavailable");
        return durable.get(key) ?? null;
    }) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        durable.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    return {
        durable,
        localStorageCalls,
        restore() {
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        },
    };
}

describe("用户隔离", () => {
    test("两个账号的进度写进各自的 scope 键，互不可见", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("pose"));
            await saveDirectorOnboardingProgress("user-b", progressAt("apply", "completed"));

            expect([...harness.durable.keys()].sort()).toEqual([`${DIRECTOR_ONBOARDING_KEY}:user:user-a`, `${DIRECTOR_ONBOARDING_KEY}:user:user-b`]);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("user-b")).toEqual(progressAt("apply", "completed"));
            // 没写过的账号拿到初始进度，而不是继承别人的已完成状态。
            expect(await loadDirectorOnboardingProgress("user-c")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("进度只走 localforage，完全不碰 localStorage", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("move"));
            await loadDirectorOnboardingProgress("user-a");
            expect(harness.localStorageCalls).toEqual([]);
        } finally {
            harness.restore();
        }
    });

    test("空 scope 一律硬失败，绝不回落到默认账号", async () => {
        await expect(loadDirectorOnboardingProgress("")).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(loadDirectorOnboardingProgress("   ")).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(saveDirectorOnboardingProgress("", ACTIVE)).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(advanceDirectorOnboarding("", ACTIVE, "next")).rejects.toThrow("缺少导演台引导的用户 scope");
    });

    test("存储层失败向上抛，不伪装成初始进度", async () => {
        const harness = localforageHarness({ failReads: true });
        try {
            await expect(loadDirectorOnboardingProgress("user-a")).rejects.toThrow("indexeddb unavailable");
        } finally {
            harness.restore();
        }
    });
});

describe("版本失效与脏数据", () => {
    test("版本不符的旧进度整条丢弃，回到第一步", () => {
        const stale = JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION - 1, status: "completed", stepId: "apply" });
        expect(parseDirectorOnboardingProgress(stale)).toEqual(ACTIVE);
    });

    test("缺失、非 JSON、非对象、字段越界的持久值都回落到初始进度", () => {
        const dirty = [
            null,
            undefined,
            "",
            "{",
            "not json",
            "[]",
            '"active"',
            "42",
            "null",
            JSON.stringify({ status: "active", stepId: "actor" }),
            JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "paused", stepId: "actor" }),
            JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "lighting" }),
            JSON.stringify({ version: "2", status: "active", stepId: "actor" }),
            JSON.stringify([{ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "actor" }]),
        ];
        for (const raw of dirty) expect(parseDirectorOnboardingProgress(raw)).toEqual(ACTIVE);
    });

    test("脏持久值经由真实读路径也只会得到初始进度", async () => {
        const harness = localforageHarness();
        try {
            harness.durable.set(`${DIRECTOR_ONBOARDING_KEY}:user:user-a`, "{ broken");
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("落盘时只写受控字段，不回写未知字段", async () => {
        const store = memoryStorage();
        await saveDirectorOnboardingProgress("user-a", { ...progressAt("move"), extra: "x" } as DirectorOnboardingProgress, store.storage);
        expect(JSON.parse(store.writes[0])).toEqual({ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "move" });
    });

    test("状态机遇到不存在的步骤时回到初始进度，而不是越界", () => {
        const bogus = { version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "lighting" } as unknown as DirectorOnboardingProgress;
        expect(reduceDirectorOnboarding(bogus, "next")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(bogus, "back")).toEqual(ACTIVE);
        expect(resolveDirectorOnboardingView(bogus)).toBeNull();
    });
});

describe("步骤流转", () => {
    test("next 依次走完六步，最后一步 next 即结束引导", () => {
        let progress = ACTIVE;
        const visited = [progress.stepId];
        for (let i = 0; i < DIRECTOR_ONBOARDING_STEPS.length - 1; i += 1) {
            progress = reduceDirectorOnboarding(progress, "next");
            visited.push(progress.stepId);
        }
        expect(visited).toEqual(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id));
        expect(progress.status).toBe("active");

        const done = reduceDirectorOnboarding(progress, "next");
        expect(done.status).toBe("completed");
        // 完成是终态：停在最后一步，且不再前进。
        expect(done.stepId).toBe(DIRECTOR_ONBOARDING_STEPS[DIRECTOR_ONBOARDING_STEPS.length - 1].id);
        expect(reduceDirectorOnboarding(done, "next")).toBe(done);
    });

    test("back 逐步回退，首步 back 原地不动且不关闭引导", () => {
        const second = reduceDirectorOnboarding(ACTIVE, "next");
        expect(reduceDirectorOnboarding(second, "back").stepId).toBe("actor");
        expect(reduceDirectorOnboarding(ACTIVE, "back")).toBe(ACTIVE);
        expect(reduceDirectorOnboarding(ACTIVE, "back").status).toBe("active");
    });

    test("dismiss 与 complete 都是终态，next/back/dismiss/complete 无法唤醒", () => {
        for (const status of ["dismissed", "completed"] as const) {
            const frozen = progressAt("move", status);
            for (const action of ["next", "back", "dismiss", "complete"] as const) {
                expect(reduceDirectorOnboarding(frozen, action)).toBe(frozen);
            }
            expect(resolveDirectorOnboardingView(frozen)).toBeNull();
        }
    });

    test("reset 是唯一能让已跳过/已完成引导复活的动作", () => {
        expect(reduceDirectorOnboarding(progressAt("apply", "dismissed"), "reset")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(progressAt("apply", "completed"), "reset")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(progressAt("pose"), "reset")).toEqual(ACTIVE);
    });

    test("dismiss 保留当前步骤，reset 之后才回到第一步", () => {
        const dismissed = reduceDirectorOnboarding(progressAt("pose"), "dismiss");
        expect(dismissed).toEqual(progressAt("pose", "dismissed"));
        expect(reduceDirectorOnboarding(dismissed, "reset").stepId).toBe("actor");
    });

    test("展示态给出 1 起数的位置与首尾标记", () => {
        const first = resolveDirectorOnboardingView(ACTIVE);
        expect(first).toEqual({ step: DIRECTOR_ONBOARDING_STEPS[0], position: 1, total: DIRECTOR_ONBOARDING_STEPS.length, isFirst: true, isLast: false });

        const last = resolveDirectorOnboardingView(progressAt("apply"));
        expect(last?.position).toBe(DIRECTOR_ONBOARDING_STEPS.length);
        expect(last?.isLast).toBe(true);
        expect(last?.isFirst).toBe(false);
    });
});

describe("推进即落盘", () => {
    test("每次有效推进都写盘，返回值与磁盘一致", async () => {
        const store = memoryStorage();
        const second = await advanceDirectorOnboarding("user-a", ACTIVE, "next", store.storage);
        expect(second.stepId).toBe("move");
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(second);

        const dismissed = await advanceDirectorOnboarding("user-a", second, "dismiss", store.storage);
        expect(dismissed.status).toBe("dismissed");
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(dismissed);
        expect(store.writes).toHaveLength(2);
    });

    test("无变化的动作不写盘", async () => {
        const store = memoryStorage();
        expect(await advanceDirectorOnboarding("user-a", ACTIVE, "back", store.storage)).toBe(ACTIVE);
        const frozen = progressAt("move", "completed");
        expect(await advanceDirectorOnboarding("user-a", frozen, "next", store.storage)).toBe(frozen);
        expect(store.writes).toEqual([]);
    });

    test("写盘失败向上抛，调用方保留旧进度", async () => {
        const failing: DirectorOnboardingStorage = {
            getItem: async () => null,
            setItem: async () => {
                throw new Error("indexeddb write failed");
            },
        };
        await expect(advanceDirectorOnboarding("user-a", ACTIVE, "next", failing)).rejects.toThrow("indexeddb write failed");
    });

    test("重启后从磁盘恢复到同一步骤", async () => {
        const harness = localforageHarness();
        try {
            const second = await advanceDirectorOnboarding("user-a", ACTIVE, "next");
            const third = await advanceDirectorOnboarding("user-a", second, "next");
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(third);
            expect(resolveDirectorOnboardingView(third)?.step.id).toBe("pose");
        } finally {
            harness.restore();
        }
    });
});

describe("scope 归一化与并发写锁", () => {
    test("回归：注入 storage 时空白 scope 依旧硬失败，不因为跳过默认 localforage 分支而漏检", async () => {
        const store = memoryStorage();
        await expect(loadDirectorOnboardingProgress("   ", store.storage)).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(saveDirectorOnboardingProgress("", ACTIVE, store.storage)).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(advanceDirectorOnboarding(" ", ACTIVE, "next", store.storage)).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(resetDirectorOnboardingProgress("\t", store.storage)).rejects.toThrow("缺少导演台引导的用户 scope");
        expect(store.writes).toEqual([]);
    });

    test("advance 对无变化的动作也无条件校验 scope，不因提前返回而漏检", async () => {
        await expect(advanceDirectorOnboarding("", ACTIVE, "back")).rejects.toThrow("缺少导演台引导的用户 scope");
        await expect(advanceDirectorOnboarding("   ", progressAt("apply", "completed"), "next")).rejects.toThrow("缺少导演台引导的用户 scope");
    });

    test("scope 前后空白归一化，与已裁剪的 scope 共用同一把生产键，互不分裂", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress(" user-a ", progressAt("pose"));
            expect([...harness.durable.keys()]).toEqual([`${DIRECTOR_ONBOARDING_KEY}:user:user-a`]);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("  user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("user-a\t")).toEqual(progressAt("pose"));
        } finally {
            harness.restore();
        }
    });

    test("resetDirectorOnboardingProgress 让已跳过/已完成的账号回到激活的第一步，并落盘", async () => {
        const store = memoryStorage(JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "completed", stepId: "apply" }));
        const result = await resetDirectorOnboardingProgress("user-a", store.storage);
        expect(result).toEqual(ACTIVE);
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(ACTIVE);
    });

    test("resetDirectorOnboardingProgress 经真实持久层也能复活已跳过的引导", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("apply", "dismissed"));
            expect(await resetDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("写锁：锁定期间的重复进入被拒绝，release 后可再次进入，release 本身幂等", () => {
        const gate = createDirectorOnboardingGate();
        expect(gate.tryEnter()).toBe(true);
        expect(gate.tryEnter()).toBe(false);
        expect(gate.tryEnter()).toBe(false);
        gate.release();
        expect(gate.tryEnter()).toBe(true);
        gate.release();
        expect(() => gate.release()).not.toThrow();
        expect(gate.tryEnter()).toBe(true);
    });

    test("同一 tick 内的重复动作只产生一次写入（复刻 hook 用写锁挡重复调用的方式）", async () => {
        const store = memoryStorage();
        const gate = createDirectorOnboardingGate();
        const progress = ACTIVE;
        const fire = (action: DirectorOnboardingAction) => {
            if (!gate.tryEnter()) return null;
            return advanceDirectorOnboarding("user-a", progress, action, store.storage).finally(() => gate.release());
        };
        const first = fire("next");
        const second = fire("next");
        expect(second).toBeNull();
        const resolved = await first;
        expect(resolved?.stepId).toBe("move");
        expect(store.writes).toHaveLength(1);
        // 锁已经 release，后续调用不再被挡。
        expect(gate.tryEnter()).toBe(true);
    });

    test("跨代隔离：release 旧一代捕获的锁，绝不能误放新一代仍在写入的锁", () => {
        // 精确复刻 hook 的接线方式：换代时把 ref 换成全新的 gate 实例（不 release 旧实例），
        // 每次调用在拿锁的同一刻把 ref 当前指向的实例捕获进局部变量，release 只作用在这份捕获上，
        // 绝不在写入收尾时重新读一次 ref（那时 ref 可能已经转向了新一代的锁）。
        let gateRef = createDirectorOnboardingGate();

        function fire() {
            const gate = gateRef; // 同步捕获调用时刻的实例，而不是稍后再读 gateRef
            const entered = gate.tryEnter();
            return { entered, release: () => gate.release() };
        }

        // 第一代发起一次写入，锁定 gen1 的 gate。
        const gen1 = fire();
        expect(gen1.entered).toBe(true);

        // scope 切换：effect 把 ref 换成全新实例，不 release 旧实例 —— gen1 的写入仍在途、仍锁着自己那把。
        gateRef = createDirectorOnboardingGate();

        // 第二代应该立刻拿到全新的锁，不受 gen1 未完成写入的影响。
        const gen2 = fire();
        expect(gen2.entered).toBe(true);

        // gen2 写入还没收尾时，gen2 的重复调用必须被自己的锁挡住。
        expect(fire().entered).toBe(false);

        // gen1 的写入这时才收尾：它释放的是自己捕获的 gen1 实例，对 gen2 的锁没有任何影响。
        gen1.release();
        expect(fire().entered).toBe(false); // gen2 依旧锁着，没有被 gen1 的 release 误放。

        // gen2 的写入收尾，释放自己的锁，之后才能再次进入。
        gen2.release();
        expect(fire().entered).toBe(true);
    });
});

describe("步骤内容契约", () => {
    test("六个步骤覆盖添加演员、移动、调姿、轨迹、CAM 与应用，顺序固定", () => {
        expect(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id)).toEqual(["actor", "move", "pose", "path", "camera", "apply"]);
    });

    test("每个步骤都有标题与可执行说明，id 不重复", () => {
        for (const step of DIRECTOR_ONBOARDING_STEPS) {
            expect(step.title.length).toBeGreaterThan(0);
            expect(step.detail.length).toBeGreaterThan(0);
        }
        expect(new Set(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id)).size).toBe(DIRECTOR_ONBOARDING_STEPS.length);
    });

    test("每一步都给出对应一级模式，覆盖摆场、姿态、动画和摄影机", () => {
        const byId = Object.fromEntries(DIRECTOR_ONBOARDING_STEPS.map((step) => [step.id, step]));
        expect(byId.actor.mode).toBe("layout");
        expect(byId.move.mode).toBe("layout");
        expect(byId.pose.mode).toBe("pose");
        expect(byId.path.mode).toBe("animate");
        expect(byId.camera.mode).toBe("camera");
        expect(byId.apply.mode).toBe("camera");
        for (const step of DIRECTOR_ONBOARDING_STEPS) {
            if (step.mode) expect(["layout", "pose", "animate", "camera"]).toContain(step.mode);
        }
    });

    test("步骤文案指向真实入口，不把浏览步骤称为任务完成", () => {
        const content = DIRECTOR_ONBOARDING_STEPS.map((step) => `${step.title} ${step.detail}`).join("\n");
        for (const label of ["快速添加", "移动工具", "姿态模式", "Transform 关键帧", "CAM", "应用到镜头"]) expect(content).toContain(label);
    });
});

/**
 * 组件契约用源码断言：web 没有 jsdom/testing-library（见 package.json），
 * 这里与 create-library-button.test.ts 同一手法 —— 守住无障碍与 token 边界，
 * 而不是假装渲染过组件。
 */
describe("引导浮层契约", () => {
    const componentPath = resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-onboarding.tsx");
    const source = readFileSync(componentPath, "utf8");
    // 契约断言只看真正的代码：文档注释里为了解释「为什么不这样做」而提到的反例词
    // （role="dialog"、getActiveUserScope、DirectorScene）不该让断言把「提到」误判成「使用」。
    const code = stripComments(source);

    test("非阻塞浮层：region 语义，不是 dialog，也没有遮罩与焦点陷阱", () => {
        expect(code).toContain("<section");
        expect(code).toContain('aria-label="导演台上手引导"');
        expect(code).not.toContain('role="dialog"');
        expect(code).not.toContain("aria-modal");
        expect(code).not.toContain("Modal");
        expect(code).not.toContain(".focus()");
    });

    test("三个动作都是原生 button，并有可见焦点环", () => {
        const buttons = code.match(/<button\b/g) || [];
        expect(buttons).toHaveLength(3);
        expect(code.match(/type="button"/g) || []).toHaveLength(3);
        expect(code).toContain("跳过引导");
        expect(code).toContain("上一步");
        expect(code).toContain("下一步");
        expect(code).toContain("结束引导");
        expect(code).not.toContain("完成引导");
        expect(code).toContain("focus-visible:[outline:var(--stroke-2)_solid_var(--control-focus-ring)]");
    });

    test("进度既有文本又有播报，装饰性圆点对读屏隐藏", () => {
        expect(code).toContain("第 ${position} 步 / 共 ${total} 步");
        expect(code).toContain('aria-live="polite"');
        expect(code).toContain("aria-hidden");
    });

    test("首步禁用上一步，末步把主按钮换成中性的结束文案", () => {
        expect(code).toContain("disabled={busy || isFirst}");
        expect(code).toContain('{isLast ? "结束引导" : "下一步"}');
    });

    test("只用既有 token，不写颜色/圆角/字号字面值", () => {
        expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(code).not.toMatch(/\b(rgba?|oklch|hsla?)\(/);
        expect(code).not.toMatch(/:\s*"\d+px"/);
        expect(code).not.toMatch(/(text|rounded|z|bg|text)-\[\d/);
        for (const token of ["var(--space-3)", "var(--r-lg)", "var(--surface)", "var(--cn-text)", "var(--cn-muted)", "var(--fs-caption)", "var(--elevation-overlay)", "var(--border-semantic)"]) {
            expect(code).toContain(token);
        }
    });

    test("scope 由调用方显式传入，组件不读当前活跃 scope，也不自己碰 localStorage", () => {
        expect(code).toContain("scope: string");
        expect(code).not.toContain("getActiveUserScope");
        expect(code).not.toMatch(/import\s*{[^}]*getActiveUserScope/);
        expect(code).not.toContain("localStorage");
        expect(code).not.toContain("localforage");
    });

    test("状态与持久化全部走 director-onboarding 模块，组件不复制状态机", () => {
        expect(code).toContain('from "@/lib/canvas/director/director-onboarding"');
        expect(code).toContain("loadDirectorOnboardingProgress");
        expect(code).toContain("advanceDirectorOnboarding");
        expect(code).toContain("resetDirectorOnboardingProgress");
        expect(code).toContain("resolveDirectorOnboardingView");
        expect(code).not.toContain("DIRECTOR_ONBOARDING_STEPS");
        expect(code).not.toContain('"dismissed"');
        expect(code).not.toContain('"completed"');
    });

    test("并发写保护走同步 gate：换代新建实例而不是 release 共享实例，释放的是调用时捕获的那把锁", () => {
        expect(code).toContain("createDirectorOnboardingGate");
        // 换代必须新建实例，绝不能对共享的旧实例调用 release —— 那会把旧一代还没收尾的写入
        // 和新一代刚建好的锁混在一起判定。
        expect(code).toContain("gateRef.current = createDirectorOnboardingGate()");
        expect(code).not.toContain("gateRef.current.release()");
        // run() 必须在拿锁的同一刻把 gateRef.current 同步捕获进局部变量，
        // tryEnter/release 都作用在这份捕获上，绝不在写入收尾时重新读取 gateRef.current。
        expect(code).toMatch(/const\s+gate\s*=\s*gateRef\.current;/);
        expect(code).toContain("gate.tryEnter()");
        expect(code).toContain("gate.release()");
    });

    test("外部重启信号在加载期间也能直接重置，并让旧读取结果失效", () => {
        expect(code).toContain("restartSignal?: number");
        expect(code).toContain("const previousRestartSignal = useRef(restartSignal)");
        expect(code).toContain("previousRestartSignal.current === restartSignal");
        expect(code).toContain("resetDirectorOnboardingProgress(normalizedScope, storage)");
        expect(code).toContain("return loadDirectorOnboardingProgress(normalizedScope, storage)");
        expect(code).not.toContain('run("reset")');

        const generationAdvance = code.indexOf("generation.current += 1", code.indexOf("const reset = useCallback"));
        const resetWrite = code.indexOf("resetDirectorOnboardingProgress(normalizedScope, storage)");
        expect(generationAdvance).toBeGreaterThan(-1);
        expect(resetWrite).toBeGreaterThan(generationAdvance);
    });

    test("模块不写场景内容，也不引入历史/撤销", () => {
        const modelSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/director/director-onboarding.ts"), "utf8");
        const modelCode = stripComments(modelSource);
        expect(modelCode).not.toContain("DirectorScene");
        expect(modelCode).not.toContain("director-scene");
        expect(modelCode).not.toMatch(/\bhistory\b/i);
        expect(modelCode).not.toContain("window.localStorage");
        expect(modelCode).toContain("localForageStorageForScope");
    });
});

describe("引导产品接线", () => {
    const projectCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8"));
    const workbenchCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8"));

    test("页面只把已认证用户 id 传给引导，不使用 guest fallback 或未定义变量", () => {
        expect(projectCode).toContain('const directorOnboardingScope = useUserStore((state) => state.user?.id?.trim() || "")');
        expect(projectCode).toContain("onboardingScope={directorOnboardingScope}");
        expect(projectCode).not.toContain("trimmedUserId");
        expect(projectCode).not.toContain("onboardingScope={canvasStorageScope}");
    });

    test("工作台渲染非模态引导，并提供可发现的重新开始入口", () => {
        expect(workbenchCode).toContain('import { CanvasDirectorOnboarding } from "@/components/canvas/director/canvas-director-onboarding"');
        expect(workbenchCode).toContain("onboardingScope: string");
        expect(workbenchCode).toContain('label="重新开始引导"');
        expect(workbenchCode).toContain("setOnboardingRestartSignal((value) => value + 1)");
        expect(workbenchCode).toContain("<CanvasDirectorOnboarding");
        expect(workbenchCode).toContain("scope={onboardingScope}");
        expect(workbenchCode).toContain("restartSignal={onboardingRestartSignal}");
        expect(workbenchCode).toContain("overflow-x-auto");
        expect(workbenchCode).toContain("overflow-y-hidden");
    });

    test("开发复现页启用独立 scope，可实际检查首次引导与重启", () => {
        const reproCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/pages/dev/director-repro-lab.tsx"), "utf8"));
        expect(reproCode).toContain('onboardingScope="director-repro-lab"');
        expect(reproCode).not.toContain('onboardingScope=""');
    });
});
