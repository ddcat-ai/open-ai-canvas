import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 真实 UI 模块在独立进程初始化，避免 SSR 初始化顺序影响其他 DOM 用例。
test("梳妆台历史使用任务详情的最新状态", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/character-dressing-history.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
