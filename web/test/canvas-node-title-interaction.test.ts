import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const canvasStylesSource = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

describe("canvas node title interaction", () => {
    test("keeps the toolbar hover bridge from intercepting the external title", () => {
        const hoverBridge = canvasStylesSource.match(/\.canvas-node-toolbar::after\s*\{([\s\S]*?)\}/)?.[1] || "";

        expect(hoverBridge).toContain("pointer-events: none;");
    });
});
