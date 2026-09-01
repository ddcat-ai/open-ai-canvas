import type { Asset } from "@/stores/use-asset-store";

const PRIMARY_VERSION_ID_MAX_LENGTH = 36;

export function assetForRemoteSync(asset: Asset): Asset {
    const primaryVersionId = asset.primaryVersionId?.trim();
    if (!primaryVersionId || [...primaryVersionId].length <= PRIMARY_VERSION_ID_MAX_LENGTH) return asset;

    const { primaryVersionId: _invalidPrimaryVersionId, ...remoteAsset } = asset;
    return remoteAsset as Asset;
}
