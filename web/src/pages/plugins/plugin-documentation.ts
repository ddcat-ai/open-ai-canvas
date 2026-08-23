import type { PluginManifest } from "@/lib/plugins/plugin-types";

const permissionLabels: Record<string, string> = {
    "canvas.read": "读取画布",
    "canvas.write": "修改画布",
    "asset.read": "读取素材",
    "asset.search": "搜索素材",
    "asset.import": "导入素材",
    "asset.upload": "上传素材",
    "generation.run": "调用生成",
    "external.open": "打开外部详情",
};

export function getPluginDocumentation(manifest: PluginManifest) {
    const documentation = manifest.protocol?.documentation?.trim();
    if (documentation) return documentation;
    if (manifest.documentation?.trim()) return manifest.documentation.trim();

    const capabilities = manifest.permissions.map((permission) => permissionLabels[permission] || permission);
    return [
        `# ${manifest.name}`,
        "",
        manifest.description || "该插件没有提供简介。",
        "",
        "## 插件信息",
        "",
        `- 作者：${manifest.author || "未声明"}`,
        `- 版本：${manifest.version}`,
        `- 能力：${capabilities.join("、") || "未声明"}`,
        "",
        manifest.kind === "protocol"
            ? "> 此请求协议没有提供接入文档。请联系插件作者补充 `metadata.documentation`，不要仅凭清单字段推测上游接口。"
            : "> 该插件当前没有单独的使用文档。",
    ].join("\n");
}
