import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("author access and speech/recording lifecycle use the actual React implementations", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/optional-tools-lifecycle.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30_000 });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).toContain("0 fail");
    expect(result.exitCode).toBe(0);
}, 35_000);
