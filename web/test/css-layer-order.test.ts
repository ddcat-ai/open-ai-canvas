import { expect, test } from "bun:test";

const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const layerOrder = "@layer theme, base, components, utilities;";

test("HTML 在任何外部样式或脚本之前固定 CSS 层顺序", () => {
    const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
    expect(firstStyle).not.toBeNull();
    const css = firstStyle![1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(css.startsWith(layerOrder)).toBe(true);

    const firstLoad = html.search(/<script\b|<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["']/i);
    expect(firstLoad).toBeGreaterThan(html.indexOf(layerOrder));
});

test("入口层顺序与 Tailwind 一致，不依赖插件和全局 CSS 的加载先后", async () => {
    const tailwind = await Bun.file(new URL("../node_modules/tailwindcss/index.css", import.meta.url)).text();
    const editor = await Bun.file(new URL("../src/lib/plugins/builtin/editor/editor-shell.css", import.meta.url)).text();
    const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)![1];
    expect(tailwind.trimStart().startsWith(layerOrder)).toBe(true);
    expect(editor).toContain("@layer utilities {");

    // CSS layers retain their first declared order, even when a later chunk repeats them.
    const layersIn = (css: string) => [...new Set([...css.matchAll(/@layer\s+([^;{]+)[;{]/g)].flatMap((match) => match[1].split(",").map((name) => name.trim())))];
    expect(layersIn(editor + tailwind).indexOf("utilities")).toBeLessThan(layersIn(editor + tailwind).indexOf("base"));
    for (const chunks of [editor + tailwind, tailwind + editor]) {
        expect(layersIn(firstStyle + chunks)).toEqual(["theme", "base", "components", "utilities"]);
    }
});
