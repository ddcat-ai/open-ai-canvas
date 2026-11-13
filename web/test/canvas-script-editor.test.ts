import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 在隔离 DOM 中导入真实编辑器，避免 React 事件能力被其它测试的导入顺序改变。
test("分镜表格通过全屏、编辑、列显示与助手入口交互验证", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-script-editor.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
    expect(output).toContain("0 fail");
}, 60000);
