import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("制作台精修跳转在真实画布 hooks 中完成首次投送与重复打开", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-previs-handoff.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("0 fail");
}, 60000);
