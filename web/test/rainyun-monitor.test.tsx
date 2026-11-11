import { expect, test } from "bun:test";
import { resolve } from "node:path";

// DOM、请求 adapter 和布局外壳 mock 只在子进程生效，不污染其他专项。
test("雨云监控真实卡片、实时图表、配置表单及共享 API 合同", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "./test/fixtures/rainyun-monitor.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
    expect(output).toMatch(/[1-9]\d* pass/);
}, 65000);
