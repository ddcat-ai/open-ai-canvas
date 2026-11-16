import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("模型选择器区分目录加载、失败重试及缓存模型", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/model-picker-catalog-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
}, 35000);
