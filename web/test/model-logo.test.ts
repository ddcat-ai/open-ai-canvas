import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("模型 Logo 选择器", () => {
    test("使用 Vite 可识别的直接 glob 并包含前台模型 Logo 数据源", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/components/model-logo.tsx"), "utf8");
        const toc = JSON.parse(readFileSync(resolve(import.meta.dir, "../node_modules/@lobehub/icons/es/toc.json"), "utf8")) as Array<{ group: string; id: string }>;
        const options = toc.filter((item) => item.group === "model" || item.group === "provider" || item.group === "application");

        expect(source).toContain('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js"');
        expect(source).not.toContain("import.meta.glob?.(");
        expect(source).toContain('"Bun" in globalThis');
        expect(source).not.toContain("typeof import.meta.glob");
        expect(options.length).toBeGreaterThan(300);
        expect(options.some((item) => item.id === "OpenAI")).toBe(true);
        expect(options.some((item) => item.id === "AgnesAI")).toBe(true);
        expect(existsSync(resolve(import.meta.dir, "../node_modules/@lobehub/icons/es/OpenAI/components/Mono.js"))).toBe(true);
        expect(existsSync(resolve(import.meta.dir, "../node_modules/@lobehub/icons/es/AgnesAI/components/Mono.js"))).toBe(true);
    });
});
