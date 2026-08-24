import type { TFunction } from "i18next";

import type { PluginManifest } from "@/lib/plugins/plugin-types";

export function getPluginDocumentation(manifest: PluginManifest, t: TFunction) {
    const documentation = manifest.protocol?.documentation?.trim();
    if (documentation) return documentation;
    if (manifest.documentation?.trim()) return manifest.documentation.trim();

    const permissionLabels: Record<string, string> = {
        "canvas.read": t("plugins:read-canvas"),
        "canvas.write": t("plugins:modify-canvas"),
        "asset.read": t("plugins:reading-assets"),
        "asset.search": t("plugins:search-assets"),
        "asset.import": t("plugins:import-assets"),
        "asset.upload": t("plugins:upload-assets"),
        "generation.run": t("plugins:invoke-generation"),
        "external.open": t("plugins:open-external-details"),
    };
    const capabilities = manifest.permissions.map((permission) => permissionLabels[permission] || permission);
    const notDeclared = t("plugins:not-declared");
    return [
        `# ${manifest.name}`,
        "",
        manifest.description || t("plugins:plugin-description-missing"),
        "",
        `## ${t("plugins:plugin-information")}`,
        "",
        t("plugins:plugin-author-line", { value: manifest.author || notDeclared }),
        t("plugins:plugin-version-line", { value: manifest.version }),
        t("plugins:plugin-capabilities-line", { value: capabilities.join(t("plugins:list-separator")) || notDeclared }),
        "",
        manifest.kind === "protocol"
            ? t("plugins:protocol-documentation-missing")
            : t("plugins:plugin-documentation-missing"),
    ].join("\n");
}
