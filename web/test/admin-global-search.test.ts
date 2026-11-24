import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("后台全局搜索点击结果跳转，键盘选择与无结果状态正常", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/admin-global-search.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
