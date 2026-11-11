import { useCallback, useState } from "react";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { CanvasNodeData, Position } from "@/types/canvas";

export function useCanvasProjectAssetPicker({
    linkedProjectId,
    refetchLinkedProject,
    handleProjectAssetsInsert,
}: {
    linkedProjectId?: string;
    refetchLinkedProject: () => Promise<unknown>;
    handleProjectAssetsInsert: (payloads: InsertAssetPayload[], position?: Position) => Promise<CanvasNodeData[]>;
}) {
    const [projectAssetOpen, setProjectAssetOpen] = useState(false);
    const [projectAssetInitialCategory, setProjectAssetInitialCategory] = useState("all");
    const [projectAssetInitialFolderId, setProjectAssetInitialFolderId] = useState("all");
    const [projectAssetInsertPosition, setProjectAssetInsertPosition] = useState<Position | undefined>();
    const handleProjectAssetSelection = useCallback(
        async (payloads: InsertAssetPayload[]) => {
            await handleProjectAssetsInsert(payloads, projectAssetInsertPosition);
        },
        [handleProjectAssetsInsert, projectAssetInsertPosition],
    );
    const openProjectAssets = useCallback(
        (initialCategory = "all", position?: Position, initialFolderId = "all") => {
            setProjectAssetInitialCategory(initialCategory);
            setProjectAssetInitialFolderId(initialFolderId);
            setProjectAssetInsertPosition(position);
            setProjectAssetOpen(true);
            // 打开时刷新关联作品，避免选到已过期的素材列表。
            if (linkedProjectId) void refetchLinkedProject();
        },
        [linkedProjectId, refetchLinkedProject],
    );
    const closeProjectAssets = useCallback(() => {
        setProjectAssetOpen(false);
        setProjectAssetInsertPosition(undefined);
        setProjectAssetInitialFolderId("all");
    }, []);

    return { projectAssetOpen, projectAssetInitialCategory, projectAssetInitialFolderId, projectAssetInsertPosition, handleProjectAssetSelection, openProjectAssets, closeProjectAssets };
}
