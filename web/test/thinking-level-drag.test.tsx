import { expect, test } from "bun:test";
import { resolve } from "node:path";

// React caches DOM event support at import time; keep the range event test in its own DOM runtime.
test("thinking slider follows continuous dragging and commits once on release", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/thinking-level-drag.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
});
