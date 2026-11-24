import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("项目图片复用在独立 DOM 中完成分页、单集读取和失败重试", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-project-images.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
