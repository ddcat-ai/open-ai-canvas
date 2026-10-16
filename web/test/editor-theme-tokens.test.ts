import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import postcss from "postcss";

test("剪辑页与插件消费的颜色变量均由应用主题定义", async () => {
    const pluginDirectory = new URL("../src/lib/plugins/builtin/editor/", import.meta.url);
    const pluginFiles = (await readdir(pluginDirectory)).filter((name) => /\.(tsx|css)$/.test(name));
    const sources = await Promise.all([Bun.file(new URL("../src/pages/projects/detail/editor.tsx", import.meta.url)).text(), ...pluginFiles.map((name) => Bun.file(new URL(name, pluginDirectory)).text())]);
    const globals = await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text();
    const defined = new Set<string>();
    postcss.parse(globals).walkDecls((declaration) => {
        if (declaration.prop.startsWith("--")) defined.add(declaration.prop);
    });
    const consumed = new Set(sources.flatMap((source) => [...source.matchAll(/var\((--(?:director|previs)-[\w-]+)/g)].map((match) => match[1])));

    expect(consumed.size).toBeGreaterThan(0);
    expect([...consumed].filter((token) => !defined.has(token))).toEqual([]);
});
