import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { DramaCast, DramaSegmentReference } from "@/services/api/drama";

export const DRAMA_ASSET_KIND_LABEL = {
    character: "角色",
    scene: "环境",
    prop: "道具",
    image: "素材",
} as const;

/** 展示名称与模型参考图编号分开，改名不会改变提示词的序列化协议。 */
export function buildDramaPromptReferences(references: DramaSegmentReference[], castById: Map<string, DramaCast>): CanvasResourceReference[] {
    const names = references.map((reference) => {
        const cast = castById.get(reference.castId);
        return cast ? `${cast.name}${cast.lookName ? ` · ${cast.lookName}` : ""}` : reference.name;
    });
    return references.map((reference, index) => {
        const resourceId = reference.resourceId || castById.get(reference.castId)?.imageResourceId;
        const name = names[index];
        const kindLabel = DRAMA_ASSET_KIND_LABEL[reference.kind];
        return {
            id: `drama-ref:${reference.castId || reference.resourceId}`,
            nodeId: "",
            kind: "image",
            label: reference.label,
            displayLabel: `${reference.label} · ${name}`,
            title: `${name} · ${kindLabel} · ${reference.label}${reference.sent ? "" : "（未附图）"}`,
            storageKey: resourceId ? `resource:${resourceId}` : undefined,
            mentionToken: reference.label,
            assetKind: reference.kind,
            assetKindLabel: kindLabel,
            active: true,
        };
    });
}
