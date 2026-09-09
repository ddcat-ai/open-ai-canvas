import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(new URL("../src/pages/plugins/index.tsx", import.meta.url), "utf8");

describe("plugin category sections (#428)", () => {
    test("limits rendered sections to the selected category, not just matching plugins", () => {
        const sections = source.slice(source.indexOf("const pluginSections ="), source.indexOf("const selectCategory ="));
        expect(sections).toContain('categoryFilter === "all" || section.key === categoryFilter');
        expect(sections).toContain("[categoryFilter, filteredPlugins]");
    });
});
