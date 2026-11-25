import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("插件中心与管理后台在插件清单 permissions 为 null 时正常渲染而不崩溃", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/plugin-center-null-permissions.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 60000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
