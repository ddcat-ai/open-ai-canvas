import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("移动父块内的原生卡片跟随、菜单收起与订阅清理", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/popover-anchor-align.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
