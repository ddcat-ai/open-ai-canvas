import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("共享媒体表单在隔离 DOM 中验证真实控件交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shared-media-tool-form.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
});
