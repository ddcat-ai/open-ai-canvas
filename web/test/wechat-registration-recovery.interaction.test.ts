import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("微信注册成功回执后的会话恢复不会重放注册或消耗新凭据", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/wechat-registration-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
