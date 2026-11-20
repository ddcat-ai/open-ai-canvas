import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("MCP 真实设置组件：安装、授权、密钥变更及账号隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/mcp-settings.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
