import { expect, test } from "bun:test";
import { getRegisteredPlugin, registerPlugin, unregisterPlugin } from "../src/lib/plugins/plugin-registry";
import { getNodeDefinition } from "../src/lib/canvas/node-registry";
import type { PluginManifest } from "../src/lib/plugins/plugin-types";

test("plugin upload caller preserves the installation promise", async () => {
    const page = await Bun.file(new URL("../src/pages/admin/plugins/plugins-page.tsx", import.meta.url)).text();
    expect(page).toContain("onUpload={upload}");
    expect(page).not.toContain("onUpload={(file) => void upload(file)}");
});

test("plugin upload guards concurrent events and exposes installation failures", async () => {
    const modal = await Bun.file(new URL("../src/pages/plugins/plugin-documentation-modals.tsx", import.meta.url)).text();
    expect(modal).toContain("if (uploadInFlight.current) return;");
    expect(modal.indexOf("uploadInFlight.current = true")).toBeLessThan(modal.indexOf("await onUpload(file)"));
    expect(modal).toContain("uploadInFlight.current = false");
    expect(modal).toContain("closable={!uploading}");
    expect(modal).toContain('message.error(error instanceof Error ? error.message : "安装插件失败")');
    expect(modal).toContain('aria-pressed={activeTab === "install"}');
    expect(modal).toContain('aria-pressed={activeTab === "guide"}');
    expect(modal).toContain("if (!navigator.clipboard) throw new Error");
    expect(modal).toContain("clearTimeout(copyTimer.current)");
});

test("copied guide manifest is accepted by the real plugin registry", async () => {
    const guide = await Bun.file(new URL("../src/pages/plugins/plugin-development-guide.md", import.meta.url)).text();
    const example = guide.match(/```json\s*([\s\S]*?)```/)?.[1].trim();
    expect(example).toBeTruthy();
    const manifest = { ...(JSON.parse(example!) as PluginManifest), id: "merge-test-manifest-example" };
    try {
        expect(() => registerPlugin({ manifest })).not.toThrow();
    } finally {
        unregisterPlugin(manifest.id);
    }
});

test("retired editor API is rejected without registering a plugin", () => {
    const manifest = {
        apiVersion: "yingce.plugin/v2",
        id: "merge-test-retired-editor",
        name: "Retired editor",
        version: "1.0.0",
        description: "Retired editor API",
        permissions: ["timeline.read"],
        contributes: { editorSlots: [{ slot: "preview-renderer" }] },
    } as unknown as PluginManifest;
    try {
        expect(() => registerPlugin({ manifest })).toThrow("不支持的插件 API 版本");
        expect(getRegisteredPlugin(manifest.id)).toBeUndefined();
    } finally {
        unregisterPlugin(manifest.id);
    }
});

test("ordinary plugin registration and removal retain canvas node ownership", () => {
    const nodeId = "merge-test-node";
    const manifest: PluginManifest = {
        apiVersion: "yingce.plugin/v1",
        id: "merge-test-node-provider",
        name: "Canvas node provider",
        version: "1.0.0",
        description: "Canvas node lifecycle",
        permissions: ["canvas.read", "canvas.write", "generation.run"],
        contributes: {
            canvasNodes: [{ id: nodeId, label: "Example", defaultTitle: "Example", defaultSize: { width: 320, height: 240 }, schema: {}, renderer: "declarative" }],
        },
    };
    try {
        registerPlugin({ manifest });
        expect(getRegisteredPlugin(manifest.id)?.manifest).toBe(manifest);
        expect(getNodeDefinition(nodeId)?.plugin?.pluginId).toBe(manifest.id);
        expect(() => registerPlugin({ manifest: { ...manifest, version: "2.0.0" } })).toThrow("已注册其他版本");
        expect(getRegisteredPlugin(manifest.id)?.manifest.version).toBe("1.0.0");
        unregisterPlugin(manifest.id);
        expect(getRegisteredPlugin(manifest.id)).toBeUndefined();
        expect(getNodeDefinition(nodeId)).toBeUndefined();
    } finally {
        unregisterPlugin(manifest.id);
    }
});

test("reduced motion preserves modal completion events", async () => {
    const css = await Bun.file(new URL("../src/pages/admin/theme/admin-chrome.css", import.meta.url)).text();
    const reducedMotion = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedMotion).toContain("animation-duration: 0.01ms !important");
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important");
    expect(reducedMotion).not.toContain("animation: none");
    expect(reducedMotion).not.toContain("transition: none");
});
