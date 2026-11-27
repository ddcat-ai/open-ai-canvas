import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("媒体上传会话与音频分离取消在隔离环境中执行", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/media-operation-lifecycle.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
