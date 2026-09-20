import { expect, test } from "bun:test";

test("Agent 对话和设置复用创作页模型选择器，并且只展示文本模型", async () => {
    const panel = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url)).text();
    const settings = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-settings.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    const pickerCss = await Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text();

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
    expect(twoPane).toContain("align-items: start");
    expect(twoPane).not.toContain("min-height: 300px");
});
