import { expect, test } from "bun:test";
import { resolve } from "node:path";

for (const fixture of ["workspace-sidebar-history", "creation-sidebar-route"]) {
    test(`首页侧栏真实组件与历史路由：${fixture}`, () => {
        const result = Bun.spawnSync([process.execPath, "test", `./test/fixtures/${fixture}.harness.tsx`], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("0 fail");
    }, 25000);
}
