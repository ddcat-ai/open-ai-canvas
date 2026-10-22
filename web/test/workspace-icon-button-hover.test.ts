import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/workspace-product.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ICON_BUTTON = "button:has(> svg):not(:has(> span))";

function declarations(selectorSuffix: string) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1].includes(`.app-product-workspace ${ICON_BUTTON}${selectorSuffix}`));
    expect(rules.length).toBe(1);
    return rules[0][2];
}

// 通用图标按钮的悬浮/按压反馈不能写 transform：会覆盖按钮自身用 translateY(-50%) 等实现的居中定位，
// 例如快速创作历史列表的「更多」按钮、参考素材横向滚动按钮，悬浮时整体下坠半个按钮高度。
test("图标按钮悬浮上移不覆盖按钮自身的 transform", () => {
    const hover = declarations(":not(:disabled):hover");
    expect(hover).not.toMatch(/(^|[\s;])transform\s*:/);
    expect(hover).toMatch(/translate:\s*0 -1px/);
});

test("图标按钮按压缩放不覆盖按钮自身的 transform", () => {
    const active = declarations(":not(:disabled):active");
    expect(active).not.toMatch(/(^|[\s;])transform\s*:/);
    expect(active).toMatch(/scale:\s*\.92/);
});

test("图标按钮的 translate/scale 仍有过渡，项目页头仍取消上移", () => {
    expect(declarations(":not(.ant-btn-icon-only)")).toMatch(/translate var\(--product-fast\)[\s\S]*scale var\(--product-fast\)/);
    const header = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].includes(".project-workspace-header button:has(> svg):not(:disabled):hover"));
    expect(header?.[2] ?? "").toMatch(/translate:\s*none\s*!important/);
    expect(header?.[2] ?? "").toMatch(/scale:\s*none\s*!important/);
});
