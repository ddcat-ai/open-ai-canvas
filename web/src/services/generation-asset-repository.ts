export type GenerationAssetRecord = {
    id: string;
    metadata?: Record<string, unknown>;
};

export async function insertOrReturnGenerationAsset<TAsset extends GenerationAssetRecord>(dependencies: {
    effectKey: string;
    assetId: string;
    createAsset: () => TAsset;
    updateAssets: (updater: (assets: TAsset[]) => TAsset[]) => void;
    readAssets: () => TAsset[];
    persistAssets: (assets: TAsset[]) => Promise<void>;
}): Promise<string> {
    let resolvedId = dependencies.assetId;
    dependencies.updateAssets((assets) => {
        const existing = assets.find((asset) => asset.metadata?.generationEffectKey === dependencies.effectKey);
        if (existing) {
            resolvedId = existing.id;
            return assets;
        }
        if (assets.some((asset) => asset.id === dependencies.assetId)) {
            throw new Error("生成素材幂等键冲突");
        }
        return [dependencies.createAsset(), ...assets];
    });
    await dependencies.persistAssets(dependencies.readAssets());
    return resolvedId;
}
