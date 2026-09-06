import { describe, expect, test } from "bun:test";

import { IMMERSIVE_TOOLBAR_HIDE_DELAY_MS, createImmersiveToolbarAutoHideController, type ImmersiveToolbarScheduler } from "../src/lib/canvas/immersive-toolbar-auto-hide";

type TimerHandle = ReturnType<typeof setTimeout>;

function createTestScheduler() {
    let nextId = 0;
    const timers = new Map<TimerHandle, { callback: () => void; delayMs: number }>();
    const scheduler: ImmersiveToolbarScheduler = {
        schedule(callback, delayMs) {
            const handle = ++nextId as TimerHandle;
            timers.set(handle, { callback, delayMs });
            return handle;
        },
        cancel(handle) {
            timers.delete(handle);
        },
    };
    return {
        scheduler,
        pendingCount: () => timers.size,
        pendingDelays: () => [...timers.values()].map((timer) => timer.delayMs),
        runAll() {
            const pending = [...timers.values()];
            timers.clear();
            for (const timer of pending) timer.callback();
        },
    };
}

describe("immersive canvas toolbar auto hide", () => {
    test("hides after the focus-mode idle delay and reveals on activity", () => {
        const testScheduler = createTestScheduler();
        const visibility: boolean[] = [];
        let idleCount = 0;
        const controller = createImmersiveToolbarAutoHideController({
            scheduler: testScheduler.scheduler,
            onVisibilityChange: (visible) => visibility.push(visible),
            onIdle: () => (idleCount += 1),
        });

        controller.setEnabled(true);
        expect(testScheduler.pendingDelays()).toEqual([IMMERSIVE_TOOLBAR_HIDE_DELAY_MS]);
        testScheduler.runAll();
        expect(controller.isVisible()).toBe(false);
        expect(visibility).toEqual([false]);
        expect(idleCount).toBe(1);

        controller.reveal();
        expect(controller.isVisible()).toBe(true);
        expect(visibility).toEqual([false, true]);
        expect(testScheduler.pendingCount()).toBe(1);
    });

    test("restarts the idle window whenever the canvas is used", () => {
        const testScheduler = createTestScheduler();
        const controller = createImmersiveToolbarAutoHideController({
            scheduler: testScheduler.scheduler,
            onVisibilityChange: () => undefined,
        });

        controller.setEnabled(true);
        controller.reveal();
        controller.reveal();
        expect(testScheduler.pendingCount()).toBe(1);

        testScheduler.runAll();
        expect(controller.isVisible()).toBe(false);
    });

    test("keeps controls visible while a toolbar surface is active", () => {
        const testScheduler = createTestScheduler();
        const visibility: boolean[] = [];
        const controller = createImmersiveToolbarAutoHideController({
            scheduler: testScheduler.scheduler,
            onVisibilityChange: (visible) => visibility.push(visible),
        });

        controller.setEnabled(true);
        controller.setSuspended(true);
        expect(testScheduler.pendingCount()).toBe(0);
        testScheduler.runAll();
        expect(controller.isVisible()).toBe(true);

        controller.setSuspended(false);
        expect(testScheduler.pendingCount()).toBe(1);
        testScheduler.runAll();
        expect(controller.isVisible()).toBe(false);
        expect(visibility).toEqual([false]);
    });

    test("disabling immersive mode cancels hiding and restores visibility", () => {
        const testScheduler = createTestScheduler();
        const visibility: boolean[] = [];
        const controller = createImmersiveToolbarAutoHideController({
            scheduler: testScheduler.scheduler,
            onVisibilityChange: (visible) => visibility.push(visible),
        });

        controller.setEnabled(true);
        testScheduler.runAll();
        controller.setEnabled(false);
        expect(controller.isVisible()).toBe(true);
        expect(testScheduler.pendingCount()).toBe(0);
        expect(visibility).toEqual([false, true]);
    });
});
