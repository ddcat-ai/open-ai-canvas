import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实分组协议弹窗与保存刷新链路", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/channel-model-protocol-groups.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 65000);
