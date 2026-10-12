import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../src/components/canvas/canvas-viewport.tsx", import.meta.url)).text();

test("画布可显式获得焦点，但不额外进入 Tab 导航顺序", () => {
    expect(source).toMatch(/ref=\{containerRef\}\s+tabIndex=\{-1\}/);
});

test("空白点击在框选阻止默认行为之前接回焦点，节点和浮层不抢焦点", () => {
    const handler = source.slice(source.indexOf("const handlePointerDown ="), source.indexOf("const handlePointerMove ="));
    const ignore = handler.indexOf("target?.closest(CANVAS_POINTER_IGNORE_SELECTOR)");
    const focus = handler.indexOf("event.currentTarget.focus({ preventScroll: true })");
    const preventDefault = handler.indexOf("event.preventDefault()");
    expect(ignore).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(ignore);
    expect(preventDefault).toBeGreaterThan(focus);
    expect(handler).toContain("isBackgroundClick && (event.button === 0 || event.button === 1)");
    expect(handler).toContain('!target?.closest("[data-node-id],[data-connection-id]")');
});

test("播放器与浮层里的空格不触发画布手型工具", () => {
    const keydown = source.slice(source.indexOf("const handleKeyDown ="), source.indexOf("const handleKeyUp ="));
    expect(keydown).toContain("event.target.closest(CANVAS_POINTER_IGNORE_SELECTOR)");
    expect(keydown.indexOf("CANVAS_POINTER_IGNORE_SELECTOR")).toBeLessThan(keydown.indexOf("event.preventDefault()"));
});
