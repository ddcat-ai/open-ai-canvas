import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("shared list controls preserve search, pagination and pending switch interactions", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/list-controls.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
}, 35000);
