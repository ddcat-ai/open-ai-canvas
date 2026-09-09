import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(import.meta.dir, "../package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = manifest.dependencies["@tiptap/core"];
const isTiptap = (name: string) => name.startsWith("@tiptap/");

describe("Tiptap dependency alignment", () => {
    test("pins direct dependencies and matching Bun/npm and pnpm overrides", () => {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        for (const [name, specifier] of Object.entries(manifest.dependencies)) {
            if (isTiptap(name)) expect(specifier).toBe(version);
        }
        const overrides = Object.fromEntries(Object.entries(manifest.overrides).filter(([name]) => isTiptap(name)));
        expect(manifest.pnpm.overrides).toEqual(overrides);
        for (const specifier of Object.values(overrides)) expect(specifier).toBe(version);
    });

    test("resolves the entire installed Tiptap dependency graph to the core version", () => {
        const visited = new Set<string>();
        function check(parent: string, name: string) {
            const path = createRequire(parent).resolve(`${name}/package.json`);
            if (visited.has(path)) return;
            visited.add(path);
            const dependency = JSON.parse(readFileSync(path, "utf8"));
            expect(`${name}@${dependency.version}`).toBe(`${name}@${version}`);
            expect(manifest.overrides[name]).toBe(version);
            const children = { ...dependency.dependencies, ...dependency.peerDependencies, ...dependency.optionalDependencies };
            for (const child of Object.keys(children).filter(isTiptap)) check(path, child);
        }
        for (const name of Object.keys(manifest.dependencies).filter(isTiptap)) check(manifestPath, name);
        expect(visited.size).toBeGreaterThan(Object.keys(manifest.dependencies).filter(isTiptap).length);
    });
});
