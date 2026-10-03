import { expect, test } from "bun:test";

import { installChunkRecovery } from "../src/lib/chunk-recovery";

test("chunk recovery tolerates a host without window event APIs", () => {
    const host = globalThis as typeof globalThis & { window?: unknown };
    const previousWindow = host.window;
    Object.defineProperty(host, "window", { configurable: true, value: {} });

    try {
        expect(() => installChunkRecovery()).not.toThrow();
    } finally {
        if (previousWindow === undefined) delete host.window;
        else Object.defineProperty(host, "window", { configurable: true, value: previousWindow });
    }
});
