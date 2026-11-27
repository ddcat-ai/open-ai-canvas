import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("管理员创作模型预览独立 DOM 交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/admin-creation-model-catalog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
