import { expect, test } from "bun:test";

test("ModelPicker 样式独立加载，并保留模型列表的视口边界", async () => {
    const [application, globals, pickerStyles] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/model-picker.css";');
    expect(globals).not.toContain("canvas-model-picker");
    expect(pickerStyles).toContain(".canvas-model-picker-menu {");
    expect(pickerStyles).toContain("max-height: min(420px, calc(100vh - 32px));");

    const creationMenu = pickerStyles.match(/\.creation-model-picker-menu \{([\s\S]*?)\}/)?.[1] || "";
    expect(creationMenu).toContain("max-height: min(460px, calc(100vh - 24px));");
    expect(creationMenu).toContain("overflow-y: auto;");
    expect(pickerStyles).toContain(".app-user-workspace .creation-model-picker-menu.is-brand-list");
    expect(pickerStyles).toContain(".creation-model-picker-surface .creation-model-picker-menu.is-model-list");
    expect(pickerStyles).toContain(".creation-model-picker-surface .creation-model-picker-menu.is-brand-list");

    const modelList = pickerStyles.match(/\.creation-model-picker-surface \.creation-model-picker-menu\.is-model-list \{([\s\S]*?)\}/)?.[1] || "";
    expect(modelList).toContain("max-height: min(460px, calc(100vh - 24px)) !important;");
    expect(modelList).toContain("overflow-y: auto !important;");
    expect(pickerStyles).not.toContain(".app-user-workspace .creation-model-picker-menu {");
    expect(pickerStyles).not.toContain(".creation-model-picker-surface .creation-model-picker-menu {");
});
