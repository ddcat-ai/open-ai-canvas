import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("分集资产核查通过真实组件的数据切换、筛选和定位回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/project-asset-audit.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("5 pass");
    expect(output).toContain("0 fail");
}, 60000);
