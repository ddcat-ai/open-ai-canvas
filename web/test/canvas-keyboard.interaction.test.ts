import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("画布 Esc 优先关闭可见浮层，隐藏浮层不拦截取消选择和退出专注", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-keyboard.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
