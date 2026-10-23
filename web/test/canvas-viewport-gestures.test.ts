import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("画布连续平移按手势起点归属，跨面板和 Portal 不间断", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-viewport-gestures.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
