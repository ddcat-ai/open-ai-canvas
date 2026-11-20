import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("节点拖拽在真实视口缩放后保持抓取点", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-drag-zoom.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    expect(run.exitCode, new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr)).toBe(0);
}, 60_000);
