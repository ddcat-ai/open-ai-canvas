import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("ChatGPT 真实个人设置组件：默认关闭、断开连接和用户切换隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/chatgpt-plan.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
