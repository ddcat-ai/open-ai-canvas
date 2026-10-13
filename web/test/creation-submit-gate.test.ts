import { expect, test } from "bun:test";

import { createCreationSubmitGate } from "../src/pages/create/creation-submit-gate";

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
