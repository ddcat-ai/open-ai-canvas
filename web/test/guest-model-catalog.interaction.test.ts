import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("游客可浏览模型，登录后才请求报价，退出后恢复参考价格", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/guest-model-catalog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
}, 25000);
