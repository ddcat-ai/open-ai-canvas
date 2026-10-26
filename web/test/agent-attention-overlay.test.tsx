import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Agent 收起态提醒复用真实授权、审批和问答交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-attention-overlay.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 20_000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
});
