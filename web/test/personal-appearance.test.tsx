import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 偏好 store 必须在 DOM 安装后首次导入，并与其他套件隔离浏览器全局和持久化状态。
test("ordinary users select themes and private avatars with isolated account preferences", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/personal-appearance.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("5 pass");
    expect(output).toContain("0 fail");
}, 30000);
