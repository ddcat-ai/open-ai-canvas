import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 外层期限需覆盖隔离进程的 30 秒上限及启动、回收时间，避免默认 5 秒提前终止。
test("共享媒体表单在隔离 DOM 中验证真实控件交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shared-media-tool-form.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
