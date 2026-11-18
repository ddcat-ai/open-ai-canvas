import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("章节改名保留章节选择、刷新引用并在失败后允许重试", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-chapter-rename.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("0 fail");
}, 60000);
