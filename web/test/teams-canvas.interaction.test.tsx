import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("team space search, navigation and asset sharing work in an isolated DOM", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/teams-canvas-interaction.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("2 pass");
}, 35000);
