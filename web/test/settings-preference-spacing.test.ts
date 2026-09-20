import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("settings page drops the page header copy and audio preference blocks", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/pages/settings/index.tsx"), "utf8");
    expect(source).not.toContain("创作偏好");
    expect(source).not.toContain("配置默认模型、生成参数和素材存储。");
    expect(source).not.toContain("音频默认值");
    expect(source).not.toContain("音频指令");
    expect(source).not.toContain("默认音频指令");
    expect(source).toContain("默认生图张数");
    expect(source).toContain("settings-preference-heading");
});

test("wallet tabs and preference blocks keep a visible gap from neighboring surfaces", () => {
    const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    expect(css).toContain(".workspace-wallet-tabs {");
    expect(css).toContain("margin: 12px 24px 0;");
    expect(css).toContain("margin: 16px 24px 24px;");
    expect(css).toContain(".settings-preference-heading { margin-bottom: var(--space-5); }");
    expect(css).toContain(".app-user-workspace.settings-page .settings-preference-block {\n    padding: 20px 20px 12px;");
});
