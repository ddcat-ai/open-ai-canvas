import { expect, test } from "bun:test";
import { resolve } from "node:path";

// React caches DOM feature detection; isolate this fixture from SSR suites.
test("open prompt recovers rejected composition without stale input", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-open-prompt-sync.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 15000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("9 pass");
    expect(output).toContain("0 fail");
    expect(result.exitCode).toBe(0);
});
