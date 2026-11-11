import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("previs canvas exports exercise the real hook in an isolated DOM", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-previs-export-behavior.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("29 pass");
    expect(output).toContain("0 fail");
}, 35000);

test("previs screenshot and prompt controls execute in the real workbench in an isolated DOM", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-previs-workbench-export.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("12 pass");
    expect(output).toContain("0 fail");
}, 35000);
