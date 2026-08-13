export async function loadOrStoreGenerationArtifact<TArtifact>(dependencies: {
    effectKey: string;
    read: (effectKey: string) => Promise<TArtifact | null>;
    materialize: () => Promise<TArtifact>;
    write: (effectKey: string, artifact: TArtifact) => Promise<void>;
}): Promise<TArtifact> {
    const existing = await dependencies.read(dependencies.effectKey);
    if (existing) return existing;
    const materialized = await dependencies.materialize();
    await dependencies.write(dependencies.effectKey, materialized);
    return (await dependencies.read(dependencies.effectKey)) ?? materialized;
}

export function generationArtifactStorageKey(
    effectKey: string,
    mediaType: "image" | "video" | "audio",
    scope = "local",
): string {
    return `generation-${mediaType}:${scope}:${encodeURIComponent(effectKey)}`;
}
