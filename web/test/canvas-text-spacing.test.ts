import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-content.tsx"), "utf8");

test("text nodes use compact, consistent spacing in edit and view states", () => {
    expect(source).toContain("Math.round(fontSize * 1.5)");
    expect(source).not.toContain("Math.round(fontSize * 1.65)");
    expect(source).toContain("overflow-hidden pt-8");
    expect(source).toContain("bg-transparent px-3 pb-3 pt-0 font-mono");
    expect(source).toContain("bg-transparent px-3 pb-3 font-mono");
});

test("text node dimensions remain owned by the existing node defaults", () => {
    const constants = readFileSync(resolve(import.meta.dir, "../src/constant/canvas.ts"), "utf8");
    expect(constants).toContain('width: 250');
    expect(constants).toContain('height: 250');
});
