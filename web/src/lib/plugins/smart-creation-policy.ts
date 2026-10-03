import type { PluginInstallation, PluginManifest, PluginManifestV2, PluginPermission, RegisteredPlugin, SmartCreationContribution } from "./plugin-types";

/** 后端返回的已生效智能创作插件策略（与 /plugins/smart-creation 响应一致）。 */
export type SmartCreationRemotePolicy = {
    id: string;
    name: string;
    version: string;
    permissions: PluginPermission[];
    smartCreation: SmartCreationContribution;
};

export type ResolvedSmartCreationPlugin = {
    plugin: RegisteredPlugin;
    installation: PluginInstallation;
    /** 已合并远端策略的 manifest：宿主运行时按它创建规划器与执行参数。 */
    manifest: PluginManifest | PluginManifestV2;
    contribution: SmartCreationContribution;
    source: "remote" | "builtin";
};

/**
 * 选出当前可用的智能创作插件。后端返回的策略是插件包里的最新声明，优先生效；
 * 远端尚未加载或请求失败时退回本地注册的内置声明，保证入口可用。
 * 远端策略只替换声明式内容，权限仍以本地注册的插件为准，远端无法借此提权。
 */
export function resolveSmartCreationPlugin(input: {
    plugins: readonly RegisteredPlugin[];
    installations: readonly PluginInstallation[];
    effectiveEnabled: Readonly<Record<string, boolean | undefined>>;
    remote?: readonly SmartCreationRemotePolicy[];
}): ResolvedSmartCreationPlugin | undefined {
    const remoteById = new Map((input.remote || []).map((policy) => [policy.id, policy]));
    for (const plugin of input.plugins) {
        if (!plugin.createSmartCreationAgent || !plugin.manifest.contributes.smartCreation) continue;
        const installation = input.installations.find((item) => item.manifest.id === plugin.manifest.id);
        if (!installation) continue;
        const remote = remoteById.get(plugin.manifest.id);
        // 后端只返回当前用户已生效的插件；远端已加载时以它为准，本地状态兜底仅用于远端未加载的时段。
        const enabled = input.remote ? Boolean(remote) : input.effectiveEnabled[plugin.manifest.id] ?? installation.enabled;
        if (!enabled) continue;
        const contribution = remote?.smartCreation ?? plugin.manifest.contributes.smartCreation;
        const manifest = { ...plugin.manifest, contributes: { ...plugin.manifest.contributes, smartCreation: contribution } } as PluginManifest | PluginManifestV2;
        return { plugin, installation, manifest, contribution, source: remote ? "remote" : "builtin" };
    }
    return undefined;
}
