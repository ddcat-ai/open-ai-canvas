import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("relative depth confirmation and canvas nodes use the real processing flow", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-video-depth.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("0 fail");
}, 30000);
