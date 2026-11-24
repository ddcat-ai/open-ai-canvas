import { useMemo, useState } from "react";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { AppModal } from "@/components/ui/product/app-modal";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory, type AssetCategory } from "@/lib/asset-category";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { getDrama, getDramaEpisode, type DramaEpisodeDetail } from "@/services/api/drama";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";

export type ReferenceImageAsset = { assetId: string; category: AssetCategory };
type Props = {
    projectId: string;
    onClose: () => void;
    onPick: (resourceId: string, name: string, asset?: ReferenceImageAsset) => Promise<unknown>;
};
const CATEGORY_LABELS = { all: "全部图片", ...ASSET_CATEGORY_LABELS };

async function pickImage(ids: string[], items: AssetLibraryPickerItem[] | undefined, onPick: Props["onPick"]) {
    const item = items?.find((image) => image.id === ids[0]);
    const resourceId = resourceIdFromStorageKey(item?.imageStorageKey);
    if (!item || !resourceId) throw new Error("请选择一张已保存的图片");
    const asset = item.remoteAssetId ? { assetId: item.remoteAssetId, category: normalizeAssetCategory(item.category) } : undefined;
    await onPick(resourceId, item.title, asset);
}

export function ProjectReferencePicker({ projectId, onClose, onPick }: Props) {
    return (
        <AssetLibraryPickerModal
            open
            projectId={projectId}
            items={[]}
            mediaKinds={["image"]}
            multiple={false}
            categoryLabels={CATEGORY_LABELS}
            title="从本项目导入"
            eyebrow="项目图片"
            confirmLabel={() => "添加到本段参考"}
            emptyDescription="上传或导入图片后，可在同一项目的其他段中复用。早期附加图片可从分集图片导入。"
            footerNote="复用同一张图片，移除本段引用不会删除项目素材"
            onClose={onClose}
            onConfirm={async (ids, items) => {
                await pickImage(ids, items, onPick);
                onClose();
            }}
        />
    );
}

/** 只汇总用户选定一集的附加图片；同一资源多次出现时保留来源信息。 */
function episodeImages(detail: DramaEpisodeDetail | undefined): AssetLibraryPickerItem[] {
    const images = new Map<string, AssetLibraryPickerItem>();
    for (const segment of detail?.segments || []) {
        for (const reference of segment.request.references) {
            if (reference.castId || !reference.resourceId) continue;
            const source = `第 ${segment.index + 1} 段${segment.title ? ` · ${segment.title}` : ""}`;
            const previous = images.get(reference.resourceId);
            if (previous) {
                previous.description = `${previous.description}；${source}`;
                continue;
            }
            images.set(reference.resourceId, {
                id: reference.resourceId,
                title: reference.name,
                category: "material",
                mediaKind: "image",
                kindLabel: "图片",
                imageStorageKey: resourceStorageKey(reference.resourceId),
                description: source,
            });
        }
    }
    return [...images.values()];
}

export function EpisodeReferencePicker({ projectId, onClose, onPick }: Props) {
    const [episodeId, setEpisodeId] = useState<string>();
    const [browsing, setBrowsing] = useState(false);
    const summary = useQuery({
        queryKey: dramaKeys.summary(projectId),
        queryFn: ({ signal }) => getDrama(projectId, signal),
        enabled: Boolean(projectId),
        refetchOnWindowFocus: false,
    });
    const detail = useQuery({
        queryKey: dramaKeys.episode(projectId, episodeId || ""),
        queryFn: ({ signal }) => getDramaEpisode(projectId, episodeId!, signal),
        enabled: Boolean(projectId && episodeId && browsing),
        refetchOnWindowFocus: false,
    });
    const items = useMemo(() => episodeImages(detail.data), [detail.data]);
    const showImages = browsing && detail.isSuccess;
    const episodes = summary.data?.episodes || [];
    return (
        <>
            <AppModal
                open={!showImages}
                title="从分集图片导入"
                okText="查看这集图片"
                cancelText="取消"
                confirmLoading={browsing && detail.isFetching}
                okButtonProps={{ disabled: !episodeId || summary.isError }}
                onOk={() => setBrowsing(true)}
                onCancel={onClose}
            >
                <p className="mb-4 text-[var(--text-secondary)]">选择一集，查看其中各段的附加图片。选入的图片会加入项目素材，供后续各段复用。</p>
                {summary.isError ? (
                    <WorkspaceErrorState compact title="分集列表读取失败" description={summary.error.message} onRetry={() => void summary.refetch()} />
                ) : (
                    <Select
                        className="w-full"
                        aria-label="选择图片来源分集"
                        showSearch={{ optionFilterProp: "label" }}
                        value={episodeId}
                        loading={summary.isPending}
                        placeholder={summary.isPending ? "正在读取分集" : episodes.length ? "选择一集" : "项目还没有分集"}
                        options={episodes.map((episode) => ({ value: episode.id, label: `第 ${episode.number} 集 · ${episode.title}` }))}
                        onChange={(value) => {
                            setEpisodeId(value);
                            setBrowsing(false);
                        }}
                    />
                )}
                {browsing && detail.isError ? <WorkspaceErrorState compact title="分集图片读取失败" description={detail.error.message} onRetry={() => void detail.refetch()} /> : null}
            </AppModal>
            <AssetLibraryPickerModal
                open={showImages}
                items={items}
                mediaKinds={["image"]}
                multiple={false}
                categoryLabels={CATEGORY_LABELS}
                title={detail.data ? `第 ${detail.data.episode.number} 集 · 附加图片` : "分集附加图片"}
                eyebrow="分集图片"
                confirmLabel={() => "添加到本段参考"}
                emptyDescription="这集各段尚未添加图片参考，可在本段上传或从素材库导入。"
                footerNote="选入后加入项目素材，保留原段引用"
                onClose={onClose}
                onConfirm={async (ids, picked) => {
                    await pickImage(ids, picked, onPick);
                    onClose();
                }}
            />
        </>
    );
}
