import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("人机验证加载失败、超时及过期可以恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/auth-turnstile.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
