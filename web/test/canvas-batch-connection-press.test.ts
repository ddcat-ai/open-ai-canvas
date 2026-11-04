import { expect, test } from "bun:test";
import { resolve } from "node:path";

// React DOM 的环境检测需要先装好 DOM，所以批量连接按下 / 松手回归在独立进程里跑，
// 见 fixtures/canvas-batch-connection-press.harness.tsx。用 Bun.spawn 读输出并等退出码。
test("批量连接：高亮的目标在任何位置都能连上，连不上说明原因，其余行为不变", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/canvas-batch-connection-press.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 240000, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exitCode, stdout + stderr).toBe(0);
}, 250000);
