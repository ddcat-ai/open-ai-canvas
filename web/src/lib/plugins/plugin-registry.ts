import type { EditorSlotKind, PluginManifest, PluginManifestV2, RegisteredPlugin } from "./plugin-types";
import { unregisterPluginSlots } from "./editor-slot-registry";
import { registerPluginCanvasNodes, unregisterNodeDefinitions } from "@/lib/canvas/node-registry";

const registeredPlugins = new Map<string, RegisteredPlugin>();

const EDITOR_SLOT_KINDS: EditorSlotKind[] = [
    "timeline-panel",
    "preview-renderer",
    "inspector",
    "asset-ingest",
    "subtitle-tool",
    "transcription-provider",
    "export-renderer",
    "ai-assistant",
];

function assertManifest(manifest: PluginManifest | PluginManifestV2) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error("插件 ID 必须使用 kebab-case");
    if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) throw new Error("插件清单缺少名称、版本或 API 版本");
    const apiVersion: string = manifest.apiVersion;
    if (apiVersion !== "yingce.plugin/v1" && apiVersion !== "yingce.plugin/v2") {
        throw new Error(`不支持的插件 API 版本：${apiVersion}`);
    }
    if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error("插件权限不能重复");
    if (manifest.apiVersion === "yingce.plugin/v2") assertManifestV2(manifest);
    else assertManifestV1Contributions(manifest.contributes);
}

function assertManifestV1Contributions(contributes: PluginManifest["contributes"]) {
    if (!contributes || Object.values(contributes).every((value) => !value || value.length === 0)) {
        throw new Error("插件至少需要声明一种贡献能力");
    }
}

function assertManifestV2(manifest: PluginManifestV2) {
    if (manifest.contributes.editorSlots?.length) {
        for (const slot of manifest.contributes.editorSlots) {
            if (!EDITOR_SLOT_KINDS.includes(slot.slot)) throw new Error(`未知的编辑器插槽类型：${slot.slot}`);
            if (slot.priority !== undefined && (typeof slot.priority !== "number" || Number.isNaN(slot.priority))) {
                throw new Error(`编辑器插槽 ${slot.slot} 的 priority 必须是数字`);
            }
        }
    }
    // 贡献检查：v1 贡献字段或 editorSlots 至少声明一项（editorSlots 是合法的 v2 独立贡献）。
    const { editorSlots, ...v1Contributions } = manifest.contributes;
    if (Object.values(v1Contributions).every((value) => !value || value.length === 0) && !editorSlots?.length) {
        throw new Error("插件至少需要声明一种贡献能力");
    }
}

export function registerPlugin(plugin: RegisteredPlugin) {
    assertManifest(plugin.manifest);
    const existing = registeredPlugins.get(plugin.manifest.id);
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        throw new Error(`插件 ${plugin.manifest.id} 已注册其他版本`);
    }
    if (plugin.manifest.apiVersion === "yingce.plugin/v2") {
        // v2：编辑器插槽声明由注册器提取存储；UI 渲染函数由插件 activate() 阶段经 registerEditorSlot 提供。
        plugin.editorSlots = plugin.manifest.contributes.editorSlots ?? [];
    }
    if (plugin.manifest.contributes.canvasNodes?.length) {
        registerPluginCanvasNodes(plugin.manifest.id, plugin.manifest.contributes.canvasNodes);
    }
    registeredPlugins.set(plugin.manifest.id, plugin);
}

export function unregisterPlugin(pluginId: string) {
    unregisterNodeDefinitions(pluginId);
    unregisterPluginSlots(pluginId);
    registeredPlugins.delete(pluginId);
}

export function getRegisteredPlugin(pluginId: string) {
    return registeredPlugins.get(pluginId);
}

export function listRegisteredPlugins() {
    return [...registeredPlugins.values()];
}

export function listRegisteredManifests(): Array<PluginManifest | PluginManifestV2> {
    return listRegisteredPlugins().map(({ manifest }) => manifest);
}
