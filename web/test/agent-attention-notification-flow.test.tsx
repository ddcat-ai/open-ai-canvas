import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Agent 提醒流程按待处理键去重并跟随权限、页面与面板状态", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-attention-notification-flow.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 20_000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
});
