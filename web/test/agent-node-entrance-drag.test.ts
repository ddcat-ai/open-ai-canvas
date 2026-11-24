import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-agent-focus.css"), "utf8");

test("Agent 入场不占用拖拽位移，不缩放节点边界，也不延迟隐藏节点", () => {
    const keyframes = css.slice(css.indexOf("@keyframes canvas-agent-node-enter"), css.indexOf("@media", css.indexOf("@keyframes canvas-agent-node-enter")));
    expect(keyframes).not.toMatch(/\b(?:translate|transform|scale)\s*:/);
    expect(keyframes).not.toMatch(/opacity:\s*0\s*[;}]/);
    const rule = css.match(/\[data-node-id\]\[data-agent-enter="true"\]\s*\{([^}]+)\}/)?.[1] || "";
    expect(rule).toContain("canvas-agent-node-enter");
    expect(rule).not.toMatch(/animation-delay|\bboth\b|\bforwards\b/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*data-agent-enter="true"[\s\S]*animation: none/);
});
