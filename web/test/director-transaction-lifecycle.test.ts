import { describe, expect, test } from "bun:test";

import { createDirectorTransaction, installDirectorTerminalListeners, type DirectorListenerTarget } from "../src/lib/canvas/director/director-gesture-transaction";

type Recorded = { commits: Array<[number, number]>; restores: number[]; active: boolean[]; terminated: number };

function harness(initial = 0) {
    const log: Recorded = { commits: [], restores: [], active: [], terminated: 0 };
    let value = initial;
    const transaction = createDirectorTransaction<number>({
        read: () => value,
        restore: (snapshot) => {
            value = snapshot;
            log.restores.push(snapshot);
        },
        commit: (from, to) => log.commits.push([from, to]),
        setActive: (next) => log.active.push(next),
        terminateDrag: () => {
            log.terminated += 1;
        },
    });
    return {
        log,
        transaction,
        set: (next: number) => {
            value = next;
        },
        get: () => value,
    };
}

function fakeTarget() {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const target: DirectorListenerTarget = {
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
    return { target, emit: (type: string, event: Partial<Event> = {}) => (listeners.get(type) || []).forEach((listener) => listener(event as Event)), count: () => [...listeners.values()].reduce((sum, items) => sum + items.length, 0) };
}

describe("终止监听的安装生命周期（#1 回归）", () => {
    test("监听先安装、手势后开始，终止事件仍然生效", () => {
        const { log, transaction, set } = harness(5);
        const win = fakeTarget();
        const doc = fakeTarget();
        // 关键顺序：先安装监听，此时并没有活跃手势。
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        expect(win.count() + doc.count()).toBeGreaterThan(0);
        transaction.begin();
        set(9);
        win.emit("pointerup");
        expect(log.commits).toEqual([[5, 9]]);
    });

    test("Escape 取消并恢复快照", () => {
        const { log, transaction, set, get } = harness(1);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(42);
        win.emit("keydown", { key: "Escape" } as unknown as Event);
        expect(log.commits).toEqual([]);
        expect(get()).toBe(1);
        expect(log.terminated).toBe(1);
    });

    test("window blur 保留当前可见值并只 commit 一次（#305 验收：失焦不回原点）", () => {
        const { log, transaction, set, get } = harness(2);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(77);
        win.emit("blur");
        expect(log.commits).toEqual([[2, 77]]);
        expect(get()).toBe(77);
        expect(log.restores).toEqual([]);
        // 失焦后再来终态事件不得二次提交。
        win.emit("blur");
        win.emit("pointerup");
        expect(log.commits).toEqual([[2, 77]]);
    });

    test("document hidden 保留当前可见值并只 commit 一次", () => {
        const { log, transaction, set, get } = harness(3);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => true });
        transaction.begin();
        set(88);
        doc.emit("visibilitychange");
        expect(log.commits).toEqual([[3, 88]]);
        expect(get()).toBe(88);
        expect(log.restores).toEqual([]);
        doc.emit("visibilitychange");
        expect(log.commits).toEqual([[3, 88]]);
    });

    test("pointercancel 仍然取消并恢复快照", () => {
        const { log, transaction, set, get } = harness(2);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(77);
        win.emit("pointercancel");
        expect(log.commits).toEqual([]);
        expect(get()).toBe(2);
        expect(log.restores).toEqual([2]);
    });

    test("可见性事件在未隐藏时既不提交也不取消", () => {
        const { log, transaction, set } = harness(4);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(6);
        doc.emit("visibilitychange");
        expect(transaction.active()).toBe(true);
        expect(log.commits).toEqual([]);
        win.emit("pointerup");
        expect(log.commits).toEqual([[4, 6]]);
    });

    test("disposer 摘除全部监听", () => {
        const { log, transaction, set } = harness(0);
        const win = fakeTarget();
        const doc = fakeTarget();
        const dispose = installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        dispose();
        expect(win.count() + doc.count()).toBe(0);
        transaction.begin();
        set(3);
        win.emit("pointerup");
        expect(log.commits).toEqual([]);
    });
});

describe("终态幂等与陈旧 base 防护（#4 回归）", () => {
    test("正常结束恰好提交一次，重复终止不再提交", () => {
        const { log, transaction, set } = harness(1);
        transaction.begin();
        set(2);
        transaction.end("commit");
        transaction.end("commit");
        transaction.end("cancel");
        expect(log.commits).toEqual([[1, 2]]);
        expect(log.restores).toEqual([]);
        expect(log.active).toEqual([true, false]);
    });

    test("取消后不提交，且不会残留可被后续消费的 base", () => {
        const { log, transaction, set, get } = harness(10);
        transaction.begin();
        set(20);
        transaction.end("cancel");
        expect(get()).toBe(10);
        // 取消后的 end 不能拿旧 base 再提交一次。
        transaction.end("commit");
        expect(log.commits).toEqual([]);
        expect(transaction.active()).toBe(false);
    });

    test("未开始手势时的终止是空操作，不会误提交普通点击", () => {
        const { log, transaction } = harness(7);
        transaction.end("commit");
        transaction.end("cancel");
        expect(log.commits).toEqual([]);
        expect(log.restores).toEqual([]);
        expect(log.active).toEqual([]);
    });

    test("终态后可以重新开始新手势，base 取新快照而非旧值", () => {
        const { log, transaction, set } = harness(1);
        transaction.begin();
        set(2);
        transaction.end("commit");
        set(50);
        transaction.begin();
        set(60);
        transaction.end("commit");
        expect(log.commits).toEqual([
            [1, 2],
            [50, 60],
        ]);
    });

    test("取消后新手势的 base 是恢复后的值", () => {
        const { log, transaction, set } = harness(5);
        transaction.begin();
        set(99);
        transaction.end("cancel");
        transaction.begin();
        set(8);
        transaction.end("commit");
        expect(log.commits).toEqual([[5, 8]]);
    });

    test("read 返回 null 时不进入手势，终止也不提交", () => {
        const log: Array<[number, number]> = [];
        const transaction = createDirectorTransaction<number>({
            read: () => null,
            restore: () => undefined,
            commit: (from, to) => log.push([from, to]),
            setActive: () => undefined,
        });
        transaction.begin();
        expect(transaction.active()).toBe(false);
        transaction.end("commit");
        expect(log).toEqual([]);
    });

    test("提交路径不触发第三方拖拽终止，取消路径才触发", () => {
        const committed = harness(0);
        committed.transaction.begin();
        committed.transaction.end("commit");
        expect(committed.log.terminated).toBe(0);
        const cancelled = harness(0);
        cancelled.transaction.begin();
        cancelled.transaction.end("cancel");
        expect(cancelled.log.terminated).toBe(1);
    });
});
