import { expect, test } from "bun:test";
import { zhCN as canvasAZh } from "../src/i18n/messages/areas/canvasA/zh-CN";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../src/components/canvas/canvas-workspace-overlays.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

test("connection menu omits the header and provides descriptions for every option", () => {
    expect(component).not.toContain("引用当前节点");
    expect(component).not.toContain(">创建下一步</span>");
    expect(component).not.toContain("ChevronRight");
    expect(component).not.toContain("absolute inset-x-8 top-0 h-px");
    const list = component.slice(component.indexOf("const CONNECTION_CREATE_OPTIONS"), component.indexOf("export function CanvasConnectionCreateMenu("));
    const options = list.match(/\{ type: CanvasNodeType\.\w+, title: "[^"]+", description: "[^"]+"/g) || [];
    expect(options).toHaveLength(9);
    expect(list).toContain('title: "批量创作表"');
    expect(list).toContain("type: CanvasNodeType.BatchTable");
    expect(component).toContain("onCreate(option.type)");
});

test("add-node submenu uses a four-column medium-size grid", () => {
    const menu = readFileSync(new URL("../src/components/canvas/canvas-create-menu.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../src/components/canvas/canvas-context-menu.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    expect(menu).toContain('aria-label={t("canvasA.createMenu.nodesGroup")} className="mt-1 grid grid-cols-4 gap-0.5"');
    expect(canvasAZh.createMenu.nodesGroup).toBe("创作节点");
    expect(menu).toContain("size-9 shrink-0");
    expect(context).toContain('w-[360px]');
    expect(styles).toContain("--canvas-create-node-height: calc(var(--space-16) + var(--space-3))");
});

test("hover never changes row height; descriptions live in a fixed-height detail area", () => {
    const option = component.slice(component.indexOf("function ConnectionCreateOption("), component.indexOf("function clamp("));
    expect(option).not.toContain("motion.button");
    // 行高固定、行内不再渲染说明，悬停只换高亮。
    expect(option).toContain("flex h-10 w-full");
    expect(option).not.toContain("description}</span>");
    expect(css).not.toContain(".canvas-connection-create-description");
    const detailRule = css.match(/\.canvas-connection-create-detail \{([^}]+)\}/)?.[1] || "";
    expect(detailRule).toContain("height:");
    expect(detailRule).toContain("flex-shrink: 0");
    expect(css).toContain("-webkit-line-clamp: 2");
    expect(component).toContain('className="canvas-connection-create-detail" aria-hidden="true"');
    expect(component).toContain("previous?.x === event.clientX && previous.y === event.clientY");
    expect(component).not.toContain("SpotlightSurface");
    expect(css).toContain('.canvas-connection-create-detail[data-motion="reduced"]');
    expect(component).toContain('aria-disabled={Boolean(disabledReason)}');
    expect(component).toContain("if (!disabledReason) onClick()");
    expect(component).toContain('event.key === "Escape"');
});
