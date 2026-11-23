import type { Plugin } from "vite";

export function resilientPreload(): Plugin {
    return {
        name: "canvas-resilient-preload",
        apply: "build",
        enforce: "post",
        transform(code, id) {
            if (id !== "\0vite/preload-helper.js") return;
            const entry = "function preload(baseModule, deps, importerUrl) {";
            const seenCheck = "if (dep in seen) return;";
            const cssLoad = 'if (isCss) return new Promise((res, rej) => {';
            const cssError = [
                'link.addEventListener("load", res);\n\t\t\t\tlink.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));\n\t\t\t});',
                'link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));\n\t\t\t});',
            ].find((part) => code.includes(part));
            if ([entry, seenCheck, cssLoad].some((part) => !code.includes(part)) || !cssError) {
                throw new Error("Vite preload helper changed; update the resource preload adapter");
            }
            return {
                code:
                    'import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";\n' +
                    code
                        .replace(
                            entry,
                            "async function preload(baseModule, deps, importerUrl) {\n" +
                                "try {\n" +
                                "await warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n" +
                                "} catch (error) { return handlePreloadError(error); }\n",
                        )
                        // When two imports need the same CSS, both wait for it. A failed link can be recreated on retry.
                        .replace(seenCheck, "if (dep in seen) return seen[dep] === true ? undefined : seen[dep];")
                        .replace(cssLoad, "if (isCss) return (seen[dep] = new Promise((res, rej) => {")
                        .replace(cssError, 'link.addEventListener("error", () => { delete seen[dep]; link.remove(); rej(new PageResourceError(dep, "页面样式加载失败")); });\n\t\t\t}));'),
                map: null,
            };
        },
    };
}
