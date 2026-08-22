import type { PluginManifest, RegisteredPlugin } from "./plugin-types";

const registeredPlugins = new Map<string, RegisteredPlugin>();

function assertManifest(manifest: PluginManifest) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error("插件 ID 必须使用 kebab-case");
    if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) throw new Error("插件清单缺少名称、版本或 API 版本");
    if (!manifest.surfaces.length) throw new Error("插件至少需要声明一种界面形态");
    if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error("插件权限不能重复");
}

export function registerPlugin(plugin: RegisteredPlugin) {
    assertManifest(plugin.manifest);
    const existing = registeredPlugins.get(plugin.manifest.id);
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        throw new Error(`插件 ${plugin.manifest.id} 已注册其他版本`);
    }
    registeredPlugins.set(plugin.manifest.id, plugin);
}

export function unregisterPlugin(pluginId: string) {
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
