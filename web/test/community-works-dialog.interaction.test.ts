import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import manifest from "../package.json";

test("the publishing dialog requires consent and resubmits the selected resources", async () => {
    const cache = resolve(import.meta.dir, "../node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const dir = mkdtempSync(join(cache, "community-work-dialog-"));
    try {
        const file = join(dir, "harness.mjs");
        const build = await Bun.build({
            entrypoints: [resolve(import.meta.dir, "fixtures/community-works-dialog.harness.tsx")],
            outdir: dir,
            naming: "harness.[ext]",
            external: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).flatMap((name) => [name, name + "/*"]),
            define: { "import.meta.env": "{}" },
            target: "node",
        });
        expect(build.success, build.logs.join("\n")).toBe(true);
        const output = build.outputs.find((item) => item.path.endsWith(".js"));
        if (!output) throw new Error("Publishing dialog harness produced no JavaScript");
        await Bun.write(file, output);
        // 用 Node 验证 Ant Design 的异步表单校验，测试与清理完成后退出子进程。
        const child = Bun.spawnSync(["node", "--test", "--test-reporter=tap", "--test-force-exit", file], { timeout: 20_000 });
        const logs = new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr);
        expect(child.exitCode, logs).toBe(0);
        expect(logs).toContain("# pass 1");
    } finally {
        rmSync(dir, { recursive: true });
    }
}, 25_000);
