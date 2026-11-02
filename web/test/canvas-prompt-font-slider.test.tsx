import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("font slider isolates browser storage and respects the configured size limit", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-prompt-font-slider.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
});
