import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实批量修改弹窗的选择、保存、模板与陈旧状态保护", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/channel-model-batch-edit.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 65000);
