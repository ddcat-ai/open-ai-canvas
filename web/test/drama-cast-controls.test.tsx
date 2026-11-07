import { expect, test } from "bun:test";
import { resolve } from "node:path";

// React 在首次导入时缓存 DOM 事件能力；隔离环境保证输入与浮层测试不受其他用例的全局 DOM 影响。
test("短剧角色、参考与画布采用在独立 DOM 中通过全部交互用例", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-cast-controls.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("18 pass");
    expect(output).toContain("0 fail");
}, 60000);
