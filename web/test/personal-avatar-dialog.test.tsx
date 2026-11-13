import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 弹窗与媒体预览的浏览器全局只存在于子进程，不污染后续 API 或 SSR 套件。
test("the personal avatar dialog validates materials and previews uploads in strict mode", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/personal-avatar-dialog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("2 pass");
    expect(output).toContain("0 fail");
}, 30000);
