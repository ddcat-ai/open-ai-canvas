import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实工作区面板跨设备发现、接续与账号隔离", { timeout: 30000 }, () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/cloud-agent-panel-sync.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("16 pass");
    expect(output).toContain("0 fail");
});
