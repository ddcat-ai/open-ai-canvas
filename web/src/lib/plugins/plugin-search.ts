import type { PluginManifest } from "./plugin-types";

export function pluginMatchesSearch(manifest: PluginManifest, query: string) {
    const queryPieces = query.toLowerCase().match(/[a-z0-9._/-]+|\p{Script=Han}+/gu) ?? [];
    if (!queryPieces.length) return true;
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    const tokens = queryPieces.flatMap((piece) => {
        if (!/^\p{Script=Han}+$/u.test(piece)) return [piece];
        const words = Array.from(segmenter.segment(piece))
            .filter((part) => part.isWordLike)
            .map((part) => part.segment);
        return words.length ? words : [piece];
    });
    if (!tokens.length) return true;

    const providers = manifest.contributes?.providers || [];
    const searchableValues = [
        manifest.id,
        manifest.name,
        manifest.description,
        manifest.author,
        ...providers.flatMap((provider) => [provider.id, provider.label, ...(provider.capabilities || []), provider.create?.path, provider.poll?.path, provider.cancel?.path]),
    ]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase());

    return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}
