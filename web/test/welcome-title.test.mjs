import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("welcome entry loads configured appearance", async () => {
    let calls = 0;
    const imports = [];
    const main = source("../src/main.tsx")
        .replace(/^import .*;\n/gm, "")
        .replace(/import\.meta\.env\.DEV/g, "false")
        .replace(/import\(/g, "loadModule(");
    vm.runInNewContext(main, {
        window: { location: { pathname: "/welcome" } },
        installChunkRecovery() {},
        isIsolatedDirectorRepro: () => false,
        bootstrapAppearance: async () => { calls++; },
        loadModule: async (name) => { imports.push(name); },
    });
    await Promise.resolve();
    assert.equal(calls, 1, "welcome entry must bootstrap appearance");
    assert.deepEqual(imports, ["./welcome-application"]);
});

test("welcome effects preserve configured SEO title", () => {
    const page = source("../src/pages/welcome/index.tsx");
    // Run the actual mount effects with inert motion/scroll listeners.
    const effects = [...page.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n    \}, \[([^\]]*)\]\);/g)].filter((match) => match[2] === "");
    assert.ok(effects.length > 0);
    for (const title of ["Custom SEO Title", "Custom Site Name"]) {
        const document = { title };
        for (const [, body] of effects) {
            vm.runInNewContext(`(() => {${body}\n})()`, {
                document,
                window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
                storyRef: { current: null }, restorePickerFocus: { current: false },
                setReduced() {}, setLook() {}, getWelcomeLook() {},
            });
        }
        assert.equal(document.title, title, "welcome must preserve appearance metadata title");
    }
});
