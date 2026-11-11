import { expect, test } from "bun:test";
import { resolve } from "node:path";

// React 首次导入会缓存 DOM 能力，隔离交互测试，避免污染其他页面的事件环境和模块 mock。
test("视觉风格自由组合、详情与创建草稿在独立 DOM 中通过", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/style-composition.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
    expect(output).toContain("9 pass");
}, 60000);
