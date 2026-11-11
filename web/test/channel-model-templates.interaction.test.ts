import { expect, test } from "bun:test";
import { resolve } from "node:path";

// ReactDOM 必须在 DOM 安装后加载，避免其他 SSR 测试缓存输入事件探测结果。
test("真实渠道模型编辑器的模板、金额门禁、协议建议与保存交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/channel-model-templates.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("28 pass");
    expect(output).toContain("0 fail");
}, 50000);
