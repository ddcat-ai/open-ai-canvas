import { PLUGIN_API_VERSION, type PluginManifest, type RegisteredPlugin } from "./plugin-types";
import { registerPluginCanvasNodes, unregisterNodeDefinitions } from "@/lib/canvas/node-registry";

const registeredPlugins = new Map<string, RegisteredPlugin>();

function assertManifest(manifest: PluginManifest) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error("插件 ID 必须使用 kebab-case");
    if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) throw new Error("插件清单缺少名称、版本或 API 版本");
    if (manifest.apiVersion !== PLUGIN_API_VERSION) throw new Error(`不支持的插件 API 版本：${manifest.apiVersion}`);
    if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error("插件权限不能重复");
    if (!manifest.contributes || Object.values(manifest.contributes).every((value) => !value || value.length === 0)) {
        throw new Error("插件至少需要声明一种贡献能力");
    }
}

export function registerPlugin(plugin: RegisteredPlugin) {
    assertManifest(plugin.manifest);
    const actionIds = new Set<string>();
    for (const action of plugin.agentActions || []) {
        if (!action.id.trim() || !action.description.trim() || actionIds.has(action.id) || typeof action.buildOperations !== "function") throw new Error("插件 Agent 动作需要唯一 ID、说明和操作构建器");
        actionIds.add(action.id);
    }
    const existing = registeredPlugins.get(plugin.manifest.id);
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        throw new Error(`插件 ${plugin.manifest.id} 已注册其他版本`);
    }
    if (plugin.manifest.contributes.canvasNodes?.length) {
        registerPluginCanvasNodes(plugin.manifest.id, plugin.manifest.contributes.canvasNodes);
    }
    registeredPlugins.set(plugin.manifest.id, plugin);
}

export function unregisterPlugin(pluginId: string) {
    unregisterNodeDefinitions(pluginId);
    registeredPlugins.delete(pluginId);
}

export function getRegisteredPlugin(pluginId: string) {
    return registeredPlugins.get(pluginId);
}

export function listRegisteredPlugins() {
    return [...registeredPlugins.values()];
}

export function listRegisteredManifests(): PluginManifest[] {
    return listRegisteredPlugins().map(({ manifest }) => manifest);
}
