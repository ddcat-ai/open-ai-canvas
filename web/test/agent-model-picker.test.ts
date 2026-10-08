import { expect, test } from "bun:test";

test("Agent 对话和设置复用创作页模型选择器，并且只展示文本模型", async () => {
    // 面板拆分为主组件、展示组件与事件归约三个模块，源码约束覆盖整个模块组。
    const panel = (await Promise.all(["canvas-cloud-agent-panel.tsx", "canvas-cloud-agent-panel-parts.tsx", "canvas-cloud-agent-events.ts"].map((file) => Bun.file(new URL(`../src/components/canvas/${file}`, import.meta.url)).text()))).join("\n");
    const settings = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-settings.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    const pickerCss = await Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text();
    const sharedPickerCss = await Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text();

    expect(panel).toContain('capability="text"');
    expect(panel).toContain('variant="creation"');
    expect(panel).toContain('popoverClassName="agent-model-picker-popover"');
    expect(panel).toContain('selectableModelsByCapability(config, "text")');
    expect(panel).toContain('placeholder="选择文本模型"');

    expect(settings).toContain('capability="text"');
    expect(settings).toContain('variant="creation"');
    expect(settings).toContain('popoverClassName="agent-model-picker-popover"');
    expect(settings).toContain('placeholder="选择文本模型"');

    expect(css).toContain(".agent-model-picker-popover");
    expect(css).toContain("z-index: calc(var(--z-modal-overlay) + 1000)");

    const twoPane = pickerCss.match(/\.creation-model-picker-menu\.is-model-list \.canvas-model-picker-two-pane \{[^}]+\}/)?.[0] || "";
    expect(twoPane).toContain("min-height: 0");
    // 两列按可用高度伸展，分别滚动；顶部对齐会让长列表重新撑出视口。
    const sharedTwoPane = sharedPickerCss.match(/\.canvas-model-picker-two-pane \{[^}]+\}/)?.[0] || "";
    expect(sharedTwoPane).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(sharedTwoPane).toContain("overflow: hidden");
    expect(twoPane).not.toContain("min-height: 300px");
});
