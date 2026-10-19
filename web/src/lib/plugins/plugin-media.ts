export type PluginImageReference = {
    title?: string;
    url?: string;
    dataUrl?: string;
    storageKey?: string;
    mimeType?: string;
};

export type PluginImageResolveResult = {
    dataUrl: string;
    mimeType: string;
};

export type PluginImageResolveDependencies = {
    resolveDataUrl: (reference: PluginImageReference) => Promise<string>;
    resolveDisplayUrl: (storageKey: string) => Promise<string>;
};

/**
 * 浏览器读取 CDN/对象存储图片可能受跨域策略影响；展示签名地址是
 * 同一资源的第二条合法路径，优先保留 data URL，失败时再交给模型上游读取。
 */
export async function resolvePluginImageReference(reference: PluginImageReference, dependencies: PluginImageResolveDependencies): Promise<PluginImageResolveResult> {
    const mimeType = reference.mimeType?.trim() || "image/png";
    try {
        const dataUrl = await dependencies.resolveDataUrl(reference);
        if (dataUrl) return { dataUrl, mimeType };
    } catch (error) {
        const fallback = await displayUrlFallback(reference, dependencies);
        if (fallback) return { dataUrl: fallback, mimeType };
        throw new Error(`参考图“${reference.title?.trim() || "未命名"}”读取失败，请重新上传后重试：${error instanceof Error ? error.message : "无法读取图片"}`);
    }

    const fallback = await displayUrlFallback(reference, dependencies);
    if (fallback) return { dataUrl: fallback, mimeType };
    throw new Error(`参考图“${reference.title?.trim() || "未命名"}”读取失败，请重新上传后重试`);
}

async function displayUrlFallback(reference: PluginImageReference, dependencies: PluginImageResolveDependencies) {
    if (reference.storageKey?.startsWith("resource:")) {
        const displayUrl = await dependencies.resolveDisplayUrl(reference.storageKey).catch(() => "");
        if (/^https?:\/\//i.test(displayUrl)) return displayUrl;
    }
    const directUrl = reference.url?.trim() || "";
    return /^https?:\/\//i.test(directUrl) ? directUrl : "";
}
