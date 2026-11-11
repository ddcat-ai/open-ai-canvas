import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("工作台真实提交与报价共用适配规格，并一致省略不支持的音轨", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/workbench-video-submission.fixture.tsx", import.meta.url))], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 30000 });
    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: expect.stringContaining("workbench video submission: passed") });
});
