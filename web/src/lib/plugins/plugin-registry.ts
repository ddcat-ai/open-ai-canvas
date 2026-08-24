import { t } from "@/i18n";
import type { PluginManifest, RegisteredPlugin } from "./plugin-types";

const registeredPlugins = new Map<string, RegisteredPlugin>();

function assertManifest(manifest: PluginManifest) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error(t("lib:plugin-ids-must-use-kebab-case"));
    if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) throw new Error(t("lib:the-plugin-manifest-is-missing-a-name-version-or-api-version"));
    if (!manifest.surfaces.length) throw new Error(t("lib:a-plugin-must-declare-at-least-one-surface-type"));
    if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error(t("lib:plugin-permissions-must-not-duplicate-each-other"));
}

export function registerPlugin(plugin: RegisteredPlugin) {
    assertManifest(plugin.manifest);
    const existing = registeredPlugins.get(plugin.manifest.id);
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        throw new Error(t("lib:another-version-of-plugin-param-is-already-registered", { id: plugin.manifest.id }));
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
