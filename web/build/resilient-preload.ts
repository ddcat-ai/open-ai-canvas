import type { Plugin } from "vite";

export function resilientPreload(): Plugin {
    return {
        name: "canvas-resilient-preload",
        apply: "build",
        enforce: "post",
        transform(code, id) {
            if (id !== "\0vite/preload-helper.js") return;
            const entry = /function\s+preload\s*\(\s*baseModule\s*,\s*deps\s*,\s*importerUrl\s*\)\s*\{/;
            const seenCheck = /if\s*\(\s*dep\s+in\s+seen\s*\)\s*return\s*;/;
            const cssBlock = /if\s*\(\s*isCss\s*\)\s*return\s+new Promise\s*\(\s*\(\s*res\s*,\s*rej\s*\)\s*=>\s*\{\s*(?:link\.addEventListener\(\s*["']load["']\s*,\s*res\s*\);\s*)?link\.addEventListener\(\s*["']error["']\s*,\s*\(\s*\)\s*=>\s*rej\([^;\n]*\)\s*\);\s*\}\s*\)\s*;/;
            if (!entry.test(code)) {
                throw new Error("Vite preload helper changed; update the resource preload adapter");
            }
            let transformedCode = code.replace(
                entry,
                "async function preload(baseModule, deps, importerUrl) {\n" +
                    "try {\n" +
                    "await warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n" +
                    "} catch (error) { return handlePreloadError(error); }\n",
            );
            if (seenCheck.test(transformedCode)) {
                transformedCode = transformedCode.replace(seenCheck, "if (dep in seen) return seen[dep] === true ? undefined : seen[dep];");
            }
            if (cssBlock.test(transformedCode)) {
                transformedCode = transformedCode.replace(
                    cssBlock,
                    'if (isCss) return (seen[dep] = new Promise((res, rej) => {\n\t\t\t\tlink.addEventListener("load", res);\n\t\t\t\tlink.addEventListener("error", () => { delete seen[dep]; link.remove(); rej(new PageResourceError(dep, "页面样式加载失败")); });\n\t\t\t}));',
                );
            }
            return {
                code: 'import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";\n' + transformedCode,
                map: null,
            };
        },
    };
}
