import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const stylesSource = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

describe("canvas cross-browser positioning", () => {
    test("uses standard transforms for the committed raster layer", () => {
        const rasterLayer = stylesSource.match(/\.canvas-world-raster-layer\s*\{[\s\S]*?\}/)?.[0] || "";
        expect(rasterLayer).toContain("transform: scale(var(--canvas-committed-scale))");
        expect(rasterLayer).toContain("transform-origin: 0 0");
        expect(rasterLayer).not.toContain("zoom:");
    });
});
