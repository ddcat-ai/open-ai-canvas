import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("引用菜单留在放大编辑弹窗内并可选择资产", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-mention-modal.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 65000);
