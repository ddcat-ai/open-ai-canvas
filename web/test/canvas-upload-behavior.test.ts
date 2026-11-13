import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("canvas upload, asset import and video controls execute in an isolated DOM", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-upload-behavior.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("11 pass");
    expect(output).toContain("0 fail");
}, 35000);
