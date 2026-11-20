import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("批量上传锁定队列、失败重试与新批次状态", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/asset-batch-upload.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("0 fail");
}, 35000);
