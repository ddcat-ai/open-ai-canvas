import { expect, test } from "bun:test";

// React 的 DOM 能力在模块加载时确定，与其他测试隔离执行。
test("分镜布局切换保留原操作", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-storyboard-layout.harness.tsx"], { cwd: `${import.meta.dir}/..`, timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
}, 30000);
