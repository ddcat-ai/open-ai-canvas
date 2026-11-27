import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("创作结果和输入区真实组件支持点击引用及拖放", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-reference-drop.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("2 pass");
    expect(output).toContain("0 fail");
}, 25000);
