import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("API-created canvas without sessions can persist, edit and reopen", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/canvas-remote-persistence.fixture.ts", import.meta.url))], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 30000 });
    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: expect.stringContaining("remote persistence: passed") });
}, 35000);
