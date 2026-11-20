import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("短剧资产引用按名称展示并保留参考图协议", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-prompt-mentions.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 20000);
