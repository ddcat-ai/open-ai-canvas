import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实 React 图片审批多字段更新不会覆盖已选宽高比", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-image-approval.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
});
