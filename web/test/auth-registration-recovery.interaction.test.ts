import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("注册回执成功后只恢复会话，不重复创建账号", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/auth-registration-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
