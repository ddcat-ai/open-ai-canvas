import { expect, test } from "bun:test";

async function pickerSources() {
    const [component, styles] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);
    return { component, styles };
}

test("模型选择器按钮按名称自适应宽度，不再固定宽度截断", async () => {
    const { component, styles } = await pickerSources();

    // 触发器上的名称不再使用省略号截断：模型标识普遍很长
    // （如 004系列/minimax_h3(8图3音频)），截断后无法分辨同系列模型。
    const triggerName = component.match(/className="canvas-model-picker-name[^"]*"/)?.[0] || "";
    expect(triggerName).not.toContain("truncate");

    // 非 fullWidth 的按钮改为按内容撑开，替代原先的 min-w-36。
    expect(component).toContain('fullWidth ? "w-full" : "canvas-model-picker-fit"');
    expect(component).not.toContain('fullWidth ? "w-full" : "min-w-36 max-w-full"');

    // 自适应类必须真的存在，否则类名只是装饰。
    const fit = styles.match(/\.canvas-composer-model-picker\.canvas-model-picker-fit \{([^}]+)\}/)?.[1] || "";
    expect(fit).toContain("width: fit-content");
    expect(fit).toContain("max-width:");
});

test("模型选择器各布局位置都不再用固定宽度压掉模型名", async () => {
    const { styles } = await pickerSources();

    // 这些位置曾经把宽度写死（launchpad 232px / 窄屏 194px、150px / chat-composer
    // 196px、180px、152px、136px），长模型名一律被截断。现在统一按内容自适应。
    // 只查 width 本身：max-width 保留上限是刻意设计，不属于"压掉名称"。
    const fixedWidths = styles.match(/\.canvas-composer-model-picker[^{]*\{[^}]*[^-]width:\s*min\([^)]*\)/g) || [];
    expect(fixedWidths).toEqual([]);
    expect(styles).not.toContain("width: min(232px, 60cqw)");

    // launchpad（创作页生成任务栏）必须保留自适应覆盖，且不能被 !important 固定宽度压回。
    const launchpad = styles.match(/\.app-user-workspace \.creation-launchpad \.creation-model-picker\.canvas-composer-model-picker \{[^}]*width[^}]*\}/)?.[0] || "";
    expect(launchpad).toContain("fit-content");
});

test("模型选择器弹窗内左侧列表与右侧卡片名称均完整展示，不被省略号截断或被『系统模型』覆盖", async () => {
    const { component, styles } = await pickerSources();

    // 弹窗内左侧品牌列表项允许换行，不被 white-space: nowrap 与 ellipsis 截断
    expect(styles).not.toContain(".canvas-model-picker-brand-copy strong { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }");

    // 弹窗右侧模型选项名称允许换行，不被 white-space: nowrap 截断
    expect(styles).not.toContain(".canvas-model-picker-option-name { flex: 1 1 10rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(styles).toContain(".canvas-model-picker-option-name {\n    flex: 1 1 10rem;\n    min-width: 0;\n    white-space: normal;\n    overflow-wrap: anywhere;\n    word-break: break-word;\n    line-height: 1.35;\n}");

    // 右侧模型选项不应把直连系统模型的标题短路覆盖成无意义的通用字「系统模型」
    expect(component).toContain('modelGroup.label !== "系统模型"');
});
