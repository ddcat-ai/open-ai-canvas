import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const entry = ["../../src/services/external-asset-sources.ts", "../../src/lib/plugins/builtin/eagle.ts"].map((relative) => `export * from ${JSON.stringify(fileURLToPath(new URL(relative.replace("../../", "../"), import.meta.url)))};`).join("\n");
const result = await Bun.build({
    entrypoints: ["connector-test-entry"],
    target: "browser",
    format: "cjs",
    plugins: [
        {
            name: "connector-boundaries",
            setup(build) {
                build.onResolve({ filter: /^connector-test-entry$/ }, () => ({ path: "entry", namespace: "fixture" }));
                build.onLoad({ filter: /^entry$/, namespace: "fixture" }, () => ({ contents: entry, loader: "ts" }));
                build.onResolve({ filter: /(?:plugin-registry|plugin-storage|use-plugin-store|user-scope|eagle-runtime)$/ }, ({ path, kind }) => {
                    if (path.endsWith("eagle-runtime")) expect(kind).toBe("dynamic-import");
                    return { path, namespace: "fixture" };
                });
                build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
                    loader: "js",
                    contents: path.endsWith("plugin-registry")
                        ? "export const registerPlugin = globalThis.registerPlugin; export const getRegisteredPlugin = globalThis.getRegisteredPlugin;"
                        : path.endsWith("plugin-storage")
                          ? "export const pluginStorageFor = () => ({});"
                          : path.endsWith("use-plugin-store")
                            ? "export const usePluginStore = { getState: () => globalThis.state }; export const isPluginEffectivelyEnabled = (id, fallback) => globalThis.state.pluginStates[id]?.effectiveEnabled ?? globalThis.state.installations.find(x => x.manifest.id === id)?.enabled ?? fallback ?? false;"
                            : path.endsWith("user-scope")
                              ? "export const getActiveUserScope = () => globalThis.scope;"
                              : "globalThis.runtimeLoads++; export const createEagleAssetSource = (_base, assertEnabled) => ({ list: async () => { assertEnabled(); globalThis.calls.push('list'); return []; }, uploadAssetToFolder: async () => { assertEnabled(); globalThis.calls.push('upload'); return {id:'external-id'}; } });",
                }));
            },
        },
    ],
});
if (!result.success) throw new AggregateError(result.logs, "connector test compilation failed");
const code = await result.outputs[0].text();

function harness() {
    const plugins = new Map<string, any>();
    const module = { exports: {} as typeof import("../src/services/external-asset-sources") & typeof import("../src/lib/plugins/builtin/eagle") };
    const context = {
        module,
        exports: module.exports,
        scope: "owner",
        runtimeLoads: 0,
        calls: [] as string[],
        state: { installations: [] as any[], pluginStates: {} as Record<string, { effectiveEnabled: boolean }> },
        DOMException,
        registerPlugin: (plugin: any) => plugins.set(plugin.manifest.id, plugin),
        getRegisteredPlugin: (id: string) => plugins.get(id),
        console,
    };
    runInNewContext(code, context);
    const installation = { manifest: module.exports.eagleAssetPlugin.manifest, enabled: false, config: {} as Record<string, unknown> };
    context.state.installations.push(installation);
    const asset = { id: "a", kind: "image", title: "image", data: { dataUrl: "image.png", mimeType: "image/png" } } as any;
    return { api: module.exports, context, installation, asset };
}

test("Eagle metadata and disabled providers do not load the runtime or perform operations", async () => {
    const h = harness();
    expect(h.context.runtimeLoads).toBe(0);
    expect(h.api.createHostedAssetSources(h.context.state.installations)).toHaveLength(0);
    const provider = h.api.createEagleAssetSource();
    expect(h.context.runtimeLoads).toBe(0);
    await expect(provider.list!({})).rejects.toThrow("未启用");
    expect(h.context.runtimeLoads).toBe(0);
    expect(h.context.calls).toEqual([]);
    h.installation.enabled = true;
    await provider.list!({});
    expect(h.context.runtimeLoads).toBe(1);
    expect(h.context.calls).toEqual(["list"]);
    h.context.state.pluginStates[h.installation.manifest.id] = { effectiveEnabled: false };
    await expect(provider.list!({})).rejects.toThrow("未启用");
    expect(h.context.calls).toEqual(["list"]);
});

test("automatic Eagle uploads require an explicit saved preference", async () => {
    const h = harness();
    h.installation.enabled = true;
    expect(h.api.eagleAssetPlugin.manifest.configuration?.fields.find((field) => field.name === "autoUploadGenerated")?.default).toBe(false);
    for (const value of [undefined, false, "false"]) {
        h.installation.config.autoUploadGenerated = value;
        expect((await h.api.uploadGeneratedAssetToConfiguredSources(h.asset)).uploaded).toHaveLength(0);
        expect(h.context.runtimeLoads).toBe(0);
    }
    for (const value of [true, "true"]) {
        h.installation.config.autoUploadGenerated = value;
        const result = await h.api.uploadGeneratedAssetToConfiguredSources(h.asset);
        expect(result.uploaded).toHaveLength(1);
        expect(result.failures).toHaveLength(0);
        expect(h.installation.config.autoUploadGenerated).toBe(value);
    }
    expect(h.context.calls).toEqual(["upload", "upload"]);
    h.installation.enabled = false;
    expect((await h.api.uploadGeneratedAssetToConfiguredSources(h.asset)).uploaded).toHaveLength(0);
    expect(h.context.calls).toEqual(["upload", "upload"]);
});

test("a connector opened under another account cannot import or write", async () => {
    const h = harness();
    h.installation.enabled = true;
    const provider = h.api.createEagleAssetSource();
    h.context.scope = "other";
    await expect(provider.list!({})).rejects.toThrow("账号已切换");
    expect(h.context.runtimeLoads).toBe(0);
});

test("skill editor and RunningHub settings use executable dynamic-import boundaries", async () => {
    for (const [source, heavy] of [
        ["pages/skills/skill-workbench-route.tsx", "./workbench"],
        ["pages/settings/index.tsx", "./runninghub-settings-pane"],
    ]) {
        const kinds: string[] = [];
        const built = await Bun.build({
            entrypoints: [fileURLToPath(new URL(`../src/${source}`, import.meta.url))],
            target: "browser",
            plugins: [
                {
                    name: "inspect-import-boundary",
                    setup(build) {
                        build.onResolve({ filter: /.*/ }, ({ path, kind }) => {
                            if (path === fileURLToPath(new URL(`../src/${source}`, import.meta.url))) return;
                            if (path === heavy) kinds.push(kind);
                            return { path, external: true };
                        });
                    },
                },
            ],
        });
        expect(built.success).toBe(true);
        expect(kinds).toEqual(["dynamic-import"]);
    }
});
