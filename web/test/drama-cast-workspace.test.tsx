import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 隔离 React 首次导入时的 DOM 能力与 API spy，避免影响其他页面测试。
test("短剧设定工作区、跨季关联和风格提示词通过真实组件交互回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-cast-workspace.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("14 pass");
    expect(output).toContain("0 fail");
}, 60000);
