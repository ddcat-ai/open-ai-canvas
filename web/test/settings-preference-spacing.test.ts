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
    expect(source).toContain('t("settings.preferences.imageCount")');
    expect(source).toContain("settings-preference-heading");
});

test("wallet tabs and preference blocks keep a visible gap from neighboring surfaces", () => {
    const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    // 标签栏自身不留上下外边距：上方间距来自页头底部 12px 内边距，下方来自内容区 12px 外边距。
    const rule = (selector: string) => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
    expect(rule(".workspace-wallet-header")).toContain("padding: 20px 56px 12px 24px;");
    expect(rule(".workspace-wallet-tabs")).toContain("margin: 0 24px;");
    expect(rule(".workspace-wallet-content")).toContain("margin: 12px 24px 20px;");
    expect(rule(".settings-preference-heading")).toContain("margin-bottom: var(--space-5);");
    expect(css).toContain(".app-user-workspace.settings-page .settings-preference-block {\n    padding: 20px 20px 12px;");
});
