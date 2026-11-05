import { useEffect, useRef } from "react";

import type { ArkPortraitOverview } from "@/services/api/ark-portraits";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { useAssetStore } from "@/stores/use-asset-store";

/**
 * 方舟审核通过后，服务端直接把素材库条目移入「方舟认证」分类并写入 arkCertification。
 * 本机 store 若仍缓存旧版本，之后的编辑会与服务端版本冲突；概览里认证状态变化时按 ID 刷新本机副本。
 */
export function useArkLibraryReconcile(overview: ArkPortraitOverview | undefined) {
    const signatures = useRef(new Map<string, string>());
    useEffect(() => {
        if (!overview) return;
        const stale: string[] = [];
        for (const group of overview.groups) {
            for (const asset of group.assets) {
                if (!asset.libraryAssetId) continue;
                const signature = `${asset.status}:${asset.inLibrary}`;
                if (signatures.current.get(asset.id) === signature) continue;
                signatures.current.set(asset.id, signature);
                const local = useAssetStore.getState().assets.find((item) => item.id === asset.libraryAssetId);
                if (!local) continue;
                const certified = asset.status === "active" && asset.inLibrary;
                if (Boolean(local.arkCertification) !== certified) stale.push(asset.libraryAssetId);
            }
        }
        if (stale.length) void refreshArkLibraryAssets(stale);
    }, [overview]);
}

/** 服务端改写过的素材按 ID 刷新本机副本；失败不影响当前操作，下次同步时仍会校验版本。 */
export async function refreshArkLibraryAssets(ids: string[]) {
    const present = ids.filter((id) => useAssetStore.getState().assets.some((asset) => asset.id === id));
    if (!present.length) return;
    try {
        await loadAssetsForUse(present, { refresh: true });
    } catch {
        // 素材可能已被删除或尚未登录；不打断方舟素材操作。
    }
}
