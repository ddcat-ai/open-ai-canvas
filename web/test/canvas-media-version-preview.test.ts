import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("版本历史完整预览、双击放大、滚轮和关闭返回保留选择", () => {
    // rc-util 在 test 环境将每个 portal 的 id 固定为 test-id，双弹窗的 Esc 栈会碰撞。
    // 子进程使用开发环境的真实 React.useId；测试断言与产品事件实现不变。
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/canvas-media-version-preview.fixture.tsx", import.meta.url))], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, NODE_ENV: "development" },
        encoding: "utf8",
        timeout: 30000,
    });
    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: expect.stringContaining("version preview: passed") });
}, 35000);
