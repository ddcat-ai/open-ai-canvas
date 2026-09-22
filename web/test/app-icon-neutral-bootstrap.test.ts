import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readProjectFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// 首屏必须品牌中性：静态的 /logo.svg 会让自定义品牌部署在标签页上先闪一下内置 logo，
// 而 favicon 本来就由 use-appearance-store 在解析出外观后写入。空 data URL 只是占位，
// 避免浏览器去请求 /favicon.ico（那是一条 404）。
describe("app icon bootstrap", () => {
    const indexHtml = readProjectFile("index.html");
    const appearanceStore = readProjectFile("src/stores/use-appearance-store.ts");

    test("index.html declares a neutral placeholder icon instead of the built-in brand", () => {
        expect(indexHtml).toContain('<link rel="icon" href="data:," />');
        expect(indexHtml).not.toContain('<link rel="icon" href="/logo.svg"');
    });

    test("the appearance store remains the single writer of the favicon", () => {
        expect(appearanceStore).toContain('link[rel~="icon"]');
        expect(appearanceStore).toContain("favicon.href = appearanceLogoURL(");
    });
});
