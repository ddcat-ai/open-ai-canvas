import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(new URL("../src/components/canvas/canvas-node-content.tsx", import.meta.url), "utf8");
const textContent = source.slice(source.indexOf("function TextContent("), source.indexOf("function ", source.indexOf("function TextContent(") + 1));

describe("text node selection (#429)", () => {
    test("opens the text generation panel on a node click", () => {
        const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const clickHandler = project.slice(project.indexOf("const handleSelectedNodeClick ="), project.indexOf("const handleNodeBringToFront ="));
        expect(clickHandler).toMatch(/node.type === CanvasNodeType.Text\)\s*\{\s*setDialogNodeId\(node.id\)/);
    });

    test("allows plain and rich text previews to reach node selection", () => {
        const preview = textContent.split(") : richTextHTML ? (")[1];
        expect(preview).toBeDefined();
        expect(preview).not.toContain("onMouseDown");
        expect(preview).not.toContain("onPointerDown");
        expect(preview?.match(/onWheel=/g)).toHaveLength(2);
    });

    test("keeps editing gestures isolated from canvas dragging", () => {
        const editor = textContent.split(") : richTextHTML ? (")[0];
        expect(editor).toContain("onMouseDown={(event) => event.stopPropagation()}");
        expect(editor).toContain("onPointerDown={(event) => event.stopPropagation()}");
    });
});
