import { translate } from "@/i18n";
import { useCallback, useRef, useState } from "react";
import { App } from "antd";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { CanvasNodeData, Position } from "@/types/canvas";
import type { TimelineDirectMedia } from "@/types/timeline";

type UseCanvasTimelineAssetInsertOptions = {
    linkedProjectId?: string;
    refetchLinkedProject: () => Promise<unknown>;
    handleAssetsInsert: (payloads: InsertAssetPayload[]) => Promise<CanvasNodeData[]>;
    handleProjectAssetsInsert: (payloads: InsertAssetPayload[], position?: Position) => Promise<CanvasNodeData[]>;
    openAssetsAtPosition: (position?: Position) => void;
};

function payloadToTimelineMedia(payload: InsertAssetPayload): TimelineDirectMedia | null {
    const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (payload.kind === "video") {
        return {
            id: payload.assetId || `asset-${randomSuffix}`,
            kind: "video",
            title: payload.title,
            storageKey: payload.storageKey,
            url: payload.url,
            width: payload.width,
            height: payload.height,
            durationMs: payload.durationMs,
            bytes: payload.bytes,
            mimeType: payload.mimeType,
        };
    }
    if (payload.kind === "audio") {
        return { id: payload.assetId || `asset-${randomSuffix}`, kind: "audio", title: payload.title, storageKey: payload.storageKey, url: payload.url, durationMs: payload.durationMs, bytes: payload.bytes, mimeType: payload.mimeType };
    }
    return null;
}

export function useCanvasTimelineAssetInsert({
    linkedProjectId,
    refetchLinkedProject,
    handleAssetsInsert,
    handleProjectAssetsInsert,
    openAssetsAtPosition,
}: UseCanvasTimelineAssetInsertOptions) {
    const { message } = App.useApp();
    // 时间线弹窗内新增素材的回填通道：素材库/上传创建节点后由弹窗通过 ref 加入草稿。
    const timelineAddNodeRef = useRef<((node: CanvasNodeData) => void) | null>(null);
    // 时间线作用域直连媒体入轨通道：素材库/项目资产/本地上传不落画布，仅加入时间线草稿。
    const timelineMediaAddRef = useRef<((media: TimelineDirectMedia) => void) | null>(null);
    // 素材库与项目资产弹窗的插入作用域：时间线弹窗内打开时为 timeline，其余为 canvas。
    const [assetInsertScope, setAssetInsertScope] = useState<"canvas" | "timeline">("canvas");
    const [projectAssetScope, setProjectAssetScope] = useState<"canvas" | "timeline">("canvas");
    const [projectAssetOpen, setProjectAssetOpen] = useState(false);
    const [projectAssetInitialCategory, setProjectAssetInitialCategory] = useState("all");
    const [projectAssetInitialFolderId, setProjectAssetInitialFolderId] = useState("all");
    const [projectAssetInsertPosition, setProjectAssetInsertPosition] = useState<Position | undefined>();

    const handleLibraryAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[]) => {
            if (assetInsertScope === "timeline") {
                const media = payloads.map(payloadToTimelineMedia).filter((item): item is TimelineDirectMedia => Boolean(item));
                if (media.length !== payloads.length) throw new Error(translate("canvasPage.timelineInsert.unsupportedMedia"));
                media.forEach((item) => timelineMediaAddRef.current?.(item));
                return;
            }
            const created = await handleAssetsInsert(payloads);
            created.forEach((node) => timelineAddNodeRef.current?.(node));
        },
        [assetInsertScope, handleAssetsInsert],
    );

    const handleTimelineProjectAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[]) => {
            if (projectAssetScope === "timeline") {
                let inserted = 0;
                for (const payload of payloads) {
                    const media = payloadToTimelineMedia(payload);
                    if (media) {
                        timelineMediaAddRef.current?.(media);
                        inserted += 1;
                    }
                }
                if (inserted < payloads.length) message.info(translate("canvasPage.timelineInsert.partialInserted"));
                return;
            }
            const created = await handleProjectAssetsInsert(payloads, projectAssetInsertPosition);
            created.forEach((node) => timelineAddNodeRef.current?.(node));
        },
        [handleProjectAssetsInsert, message, projectAssetInsertPosition, projectAssetScope],
    );

    const openProjectAssets = useCallback(
        (initialCategory = "all", position?: Position, scope: "canvas" | "timeline" = "canvas", initialFolderId = "all") => {
            setProjectAssetScope(scope);
            setProjectAssetInitialCategory(initialCategory);
            setProjectAssetInitialFolderId(initialFolderId);
            setProjectAssetInsertPosition(position);
            setProjectAssetOpen(true);
            // 资产与项目实时同步：打开弹窗前刷新关联短剧项目资产，避免缓存导致资产列表空白/过期。
            if (linkedProjectId) void refetchLinkedProject();
        },
        [linkedProjectId, refetchLinkedProject],
    );

    const openCanvasAssetLibrary = useCallback(
        (position?: Position) => {
            setAssetInsertScope("canvas");
            openAssetsAtPosition(position);
        },
        [openAssetsAtPosition],
    );
    const openTimelineAssetLibrary = useCallback(() => {
        setAssetInsertScope("timeline");
        openAssetsAtPosition();
    }, [openAssetsAtPosition]);
    const closeProjectAssets = useCallback(() => {
        setProjectAssetOpen(false);
        setProjectAssetInsertPosition(undefined);
        setProjectAssetInitialFolderId("all");
    }, []);

    return {
        timelineAddNodeRef,
        timelineMediaAddRef,
        assetInsertScope,
        projectAssetScope,
        projectAssetOpen,
        projectAssetInitialCategory,
        projectAssetInitialFolderId,
        projectAssetInsertPosition,
        handleLibraryAssetsInsert,
        handleTimelineProjectAssetsInsert,
        openProjectAssets,
        openCanvasAssetLibrary,
        openTimelineAssetLibrary,
        closeProjectAssets,
    };
}
