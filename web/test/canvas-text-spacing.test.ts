import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-content.tsx"), "utf8");

test("text nodes use compact, consistent spacing in edit and view states", () => {
    expect(source).toContain("Math.round(fontSize * 1.5)");
    expect(source).not.toContain("Math.round(fontSize * 1.65)");
    expect(source).toContain("overflow-hidden pb-3 pl-3 pr-0 pt-3");
    expect(source).toContain("min-h-0 min-w-0 flex-1");
    expect(source).toContain("font-sans outline-none select-text");
    expect(source).not.toContain("font-mono outline-none select-text");
});

test("text editor keeps the card content height when entering edit mode", () => {
    const textContent = source.slice(source.indexOf("function TextContent"), source.indexOf("function SkillContent"));
    expect(textContent).toContain('height: "100%"');
    expect(textContent).toContain('containerClassName="h-full min-h-0 flex-1"');
    expect(textContent).toContain("block h-full min-h-0 min-w-0 w-full flex-1");
});

test("text body exposes a direct double-click edit entry point", () => {
    const textContent = source.slice(source.indexOf("function TextContent"), source.indexOf("function SkillContent"));
    expect(textContent).toContain("onStartEditing");
    expect(textContent).toContain("onDoubleClick");
    expect(textContent).toContain("event.stopPropagation();");
});

test("view and edit states share one text representation", () => {
    const textContent = source.slice(source.indexOf("function TextContent"), source.indexOf("function SkillContent"));
    expect(textContent).toContain("const textContent = useMemo(() => canvasRichTextText(node.metadata?.richText) || node.metadata?.content || \"\", [node.metadata?.content, node.metadata?.richText]);");
    expect(textContent).toContain("value={textContent}");
    expect(textContent).toContain("{textContent || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}");
});

test("rich text edit mode derives its text from the displayed document", () => {
    const textContent = source.slice(source.indexOf("function TextContent"), source.indexOf("function SkillContent"));
    expect(textContent).toContain("canvasRichTextText(node.metadata?.richText)");
    expect(textContent).not.toContain("dangerouslySetInnerHTML");
});

test("rich text edit text keeps a blank line between displayed blocks", () => {
    const richTextSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-rich-text.ts"), "utf8");
    expect(richTextSource).toContain('{ blockSeparator: "\\n\\n" }');
});

test("text cards do not render an inline expand editor overlay", () => {
    const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
    expect(nodeSource).not.toContain("放大编辑文本");
    expect(nodeSource).not.toContain("<Maximize2");
});

test("read-only text content lets the node receive drag and double-click events", () => {
    const textContent = source.slice(source.indexOf("function TextContent"), source.indexOf("function SkillContent"));
    expect(textContent.match(/onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/g) || []).toHaveLength(1);
});

test("text node dimensions remain owned by the existing node defaults", () => {
    const constants = readFileSync(resolve(import.meta.dir, "../src/constant/canvas.ts"), "utf8");
    expect(constants).toContain('width: 250');
    expect(constants).toContain('height: 250');
});
