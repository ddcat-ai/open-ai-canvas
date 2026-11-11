import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Jianying export checks media then hands streaming downloads to the browser", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/jianying-export.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
