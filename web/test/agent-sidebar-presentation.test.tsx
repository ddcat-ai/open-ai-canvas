import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Agent 侧栏真实 DOM：入口、草稿、工作状态与审批边界", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-sidebar-presentation.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 35000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 40000);
