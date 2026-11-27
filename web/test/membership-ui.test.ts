import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("membership administration and wallet checkout", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/membership.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("2 pass");
}, 30000);
