import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("系统更新真实页面的来源保存、混合配置、失败保护与异步检测轮询", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "./test/fixtures/system-update-sources.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        env: process.env,
        timeout: 45000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
    expect(output).toContain("5 pass");
}, 50000);
