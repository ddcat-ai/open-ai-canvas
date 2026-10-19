import { expect, test } from "bun:test";

import { createCreationSubmitGate, createCreationSubmitGateRelease, withCreationSubmitGate } from "../src/pages/create/creation-submit-gate";

test("creation submit gate rejects a second submit until the first submit releases it", () => {
    const gate = createCreationSubmitGate();

    const token = gate.tryAcquire();
    expect(token).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();

    gate.release(token!);

    expect(gate.tryAcquire()).not.toBeNull();
});

test("释放令牌只对持有者生效，并发提交不会互相解锁", () => {
    const gate = createCreationSubmitGate();

    const first = gate.tryAcquire();
    expect(first).not.toBeNull();
    // 第二个提交拿不到锁；它释放自己的“空令牌”不该解开第一个提交。
    const second = gate.tryAcquire();
    expect(second).toBeNull();
    gate.release(second as unknown as symbol);
    expect(gate.tryAcquire()).toBeNull();

    // 持有者释放后才轮得到下一次提交。
    gate.release(first!);
    const third = gate.tryAcquire();
    expect(third).not.toBeNull();
    // 已释放过的旧令牌不能解开新持有者的锁。
    gate.release(first!);
    expect(gate.tryAcquire()).toBeNull();
});

test("普通创作提交闸门只允许一个异步任务，并在失败后释放", async () => {
    const gate = createCreationSubmitGate();
    let started = 0;
    let releaseTask!: () => void;
    const task = () => {
        started += 1;
        return new Promise<void>((resolve) => {
            releaseTask = resolve;
        });
    };

    const first = withCreationSubmitGate(gate, task);
    const second = await withCreationSubmitGate(gate, task);
    expect(second.accepted).toBe(false);
    expect(started).toBe(1);

    releaseTask();
    expect((await first).accepted).toBe(true);
    expect((await withCreationSubmitGate(gate, async () => undefined)).accepted).toBe(true);
});
test("普通任务交接后释放提交闸门，旧任务收尾不能解锁下一条任务", () => {
    const gate = createCreationSubmitGate();

    const first = gate.tryAcquire();
    expect(first).not.toBeNull();
    const releaseFirst = createCreationSubmitGateRelease(gate, first!);
    releaseFirst();

    expect(gate.tryAcquire()).not.toBeNull();
    releaseFirst();
    expect(gate.tryAcquire()).toBeNull();
});

test("提交失败后释放令牌，可继续提交下一轮", async () => {
    const gate = createCreationSubmitGate();
    await expect(
        withCreationSubmitGate(gate, async () => {
            throw new Error("提交失败");
        }),
    ).rejects.toThrow("提交失败");
    expect(await withCreationSubmitGate(gate, async () => "下一轮")).toEqual({ accepted: true, value: "下一轮" });
});

test("智能规划完成后可释放闸门，旧轮生图收尾不阻塞或解锁下一轮规划", async () => {
    const gate = createCreationSubmitGate();
    let finishImages!: () => void;
    let releasePlanning: (() => void) | undefined;
    const images = new Promise<void>((resolve) => {
        finishImages = resolve;
    });
    const first = withCreationSubmitGate(gate, async (release) => {
        releasePlanning = release;
        await images;
    });
    expect(typeof releasePlanning).toBe("function");
    releasePlanning!();
    const next = gate.tryAcquire();
    expect(next).not.toBeNull();
    finishImages();
    await first;
    expect(gate.tryAcquire()).toBeNull();
    gate.release(next!);
    expect((await withCreationSubmitGate(gate, async () => undefined)).accepted).toBe(true);
});
