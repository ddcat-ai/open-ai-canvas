import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("分集卡片改名通过真实列表、弹窗与 API 回归", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-episode-rename.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(run.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 65_000);
