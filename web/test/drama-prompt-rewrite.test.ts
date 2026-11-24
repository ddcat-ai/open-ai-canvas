import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("短剧提示词 AI 修改通过真实组件与任务入口回归", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-prompt-rewrite.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    expect(run.exitCode, new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr)).toBe(0);
}, 60_000);
