import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实画布右键菜单的事件顺序与拖动回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-context-menu.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
});
