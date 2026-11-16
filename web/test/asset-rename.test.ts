import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("素材改名通过真实弹窗验证媒体保留及服务端失败", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/asset-rename.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    expect(run.exitCode, new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr)).toBe(0);
}, 60_000);
