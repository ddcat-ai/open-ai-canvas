import { expect, test } from "bun:test";

test("模型行只保留选中高亮，价格使用独立的彩色标签", async () => {
    const [component, styles, workspace] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text(),
    ]);
    expect(component).not.toContain("previewedModel");
    expect(component).not.toContain("onMouseEnter");
    expect(styles).not.toMatch(/canvas-model-picker-(?:brand|option)(?:\[[^\]]*\])?:hover/);
    expect(workspace).not.toContain(".canvas-model-picker-brand.is-active");
    expect(styles).toContain('.canvas-model-picker-brand[aria-pressed="true"]');
    expect(styles).toContain('.canvas-model-picker-option[aria-selected="true"]');
    expect(styles).toContain(".canvas-model-picker-option:focus-visible");
    const price = styles.match(/\.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(price).toContain("color: var(--model-price-ink)");
    expect(price).toContain("font-weight: 650");
    expect(price).not.toContain("background:");
    expect(styles).toContain(".dark .model-picker-price");
    const badge = styles.match(/\.canvas-model-picker-option \.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(badge).toContain("border-radius: var(--r-sm)");
    expect(badge).toContain("background: color-mix");
    expect(badge).toContain("padding: 2px 5px");
    expect(price).toContain("--model-price-ink: #946900");
    expect(component).toContain('<Coins className="model-picker-price-icon" aria-hidden="true" />');
    expect(styles).toContain("width: min(800px, calc(100vw - 24px))");
});

test("每次打开菜单都展开当前选中模型所属目录，无有效选中时显示一级目录", async () => {
    const component = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    const opening = component.match(/const setPickerOpen = \(nextOpen: boolean\) => \{([\s\S]*?)\n    \};/)?.[1] || "";
    expect(opening).toContain("setActiveGroupKey(optionGroups.find((group) => group.models.some((item) => item.models.includes(current)))?.key ?? null)");
    expect(opening).not.toContain("setActiveGroupKey(null)");
});

test("选择模型保留菜单及行内焦点，仍可通过 Escape 和外部点击关闭", async () => {
    const component = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    const selection = component.match(/onClick=\{\(\) => \{\s*if \(!model\) return;([\s\S]*?)\}\}/)?.[1] || "";
    expect(selection).toContain("onChange(model)");
    expect(selection).not.toContain("setOpen(false)");
    expect(selection).not.toContain("focus()");
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain('window.addEventListener("pointerdown", closeOnOutsidePointer, true)');
});

test("ModelPicker 样式独立加载，并保留模型列表的视口边界", async () => {
    const [application, globals, pickerStyles] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/model-picker.css";');
    expect(globals).not.toContain("canvas-model-picker");
    expect(pickerStyles).toContain(".canvas-model-picker-menu {");
    const menu = pickerStyles.match(/\.canvas-model-picker-menu \{([\s\S]*?)\}/)?.[1] || "";
    expect(menu).toContain("max-height: min(460px, calc(100dvh - 24px), calc(var(--canvas-model-picker-available-height) - 24px));");
    expect(menu).toContain("display: flex;");
    expect(menu).toContain("flex-direction: column;");

    const creationMenu = pickerStyles.match(/\.creation-model-picker-menu \{([\s\S]*?)\}/)?.[1] || "";
    expect(creationMenu).toContain("overflow-y: auto;");
    // 菜单约束集中在共享规则，两列各自滚动，不再依赖重复的 creation 样式覆盖。
    const modelList = pickerStyles.match(/\.canvas-model-picker-menu\.is-model-list \{([\s\S]*?)\}/)?.[1] || "";
    expect(modelList).toContain("overflow: hidden;");
    const brandRail = pickerStyles.match(/\.canvas-model-picker-menu\.is-model-list \.canvas-model-picker-brand-rail \{([\s\S]*?)\}/)?.[1] || "";
    const modelPane = pickerStyles.match(/\.canvas-model-picker-model-pane \{([\s\S]*?)\}/)?.[1] || "";
    for (const pane of [brandRail, modelPane]) {
        expect(pane).toContain("min-height: 0;");
        expect(pane).toContain("overflow-y: auto;");
    }
    expect(pickerStyles).not.toContain(".app-user-workspace .creation-model-picker-menu {");
    expect(pickerStyles).not.toContain(".creation-model-picker-surface .creation-model-picker-menu {");
});
