import type { Plugin } from "vite";

export function resilientPreload(): Plugin {
    return {
        name: "canvas-resilient-preload",
        apply: "build",
        enforce: "post",
        transform(code, id) {
            if (id !== "\0vite/preload-helper.js") return;
            const entry = "function preload(baseModule, deps, importerUrl) {";
            if (!code.includes(entry)) throw new Error("Vite preload helper changed; update the bounded preload adapter");
            return {
                code:
                    'import { warmPreloadResources } from "@/lib/module-preload";\n' +
                    code.replace(
                        entry,
                        "async function preload(baseModule, deps, importerUrl) {\n" +
                            "try {\n" +
                            "await warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n" +
                            "} catch (error) { return handlePreloadError(error); }\n",
                    ),
                map: null,
            };
        },
    };
}
