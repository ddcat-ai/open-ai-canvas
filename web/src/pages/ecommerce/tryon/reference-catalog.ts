import { poseLibraryFileUrl, type PoseLibraryPose } from "@/services/api/pose-library";

export const REFERENCE_ANGLES = [
    { id: "front", label: "正面", instruction: "相机正面平视，身体朝向与动作按图中呈现" },
    { id: "above", label: "俯视", instruction: "从上方俯拍，保留俯视透视和肢体缩短关系" },
    { id: "below", label: "仰视", instruction: "从下方仰拍，保留低机位透视与身体比例关系" },
    { id: "side", label: "侧面", instruction: "相机位于人物侧面，按侧面轮廓、肢体遮挡和朝向复刻" },
    { id: "diagonal", label: "斜侧", instruction: "相机位于45度斜侧，保留肩胯旋转和近大远小的透视" },
    { id: "back", label: "背面", instruction: "相机位于人物背后，保留背部朝向与肢体遮挡" },
] as const;
export type ReferenceAngle = (typeof REFERENCE_ANGLES)[number]["id"];
export type ReferenceKind = "pose" | "garment";
export type ReferenceView = { thumbnail: string; image: string; width: number; height: number; itemId?: string };
export type ReferenceEntry = { id: string; kind: ReferenceKind; title: string; category: string; tags: string[]; instruction: string; source: string; views: Partial<Record<ReferenceAngle, ReferenceView>> };
export type ReferenceSelection = { entry: ReferenceEntry; angle: ReferenceAngle };
export function libraryReferenceEntry(pose: PoseLibraryPose, kind: ReferenceKind): ReferenceEntry {
    const views: ReferenceEntry["views"] = {};
    for (const item of pose.items) {
        const angle = REFERENCE_ANGLES.find((entry) => entry.label === item.angle)?.id || "front";
        if (views[angle]) continue;
        views[angle] = { itemId: item.id, thumbnail: poseLibraryFileUrl(item), image: poseLibraryFileUrl(item, "image"), width: item.width, height: item.height };
    }
    return { id: pose.key, kind, title: pose.name, category: pose.category, tags: [pose.code, pose.system], source: pose.sourceKey, instruction: "请根据参考图识别实际内容", views };
}
export const referenceSelectionKey = ({ entry, angle }: ReferenceSelection) => `${entry.id}:${angle}`;
export function referenceView(entry: ReferenceEntry, angle: ReferenceAngle) {
    const view = entry.views[angle];
    if (!view) throw new Error("素材没有提供此角度，请选择其他角度");
    return view;
}
export const referenceImageUrl = (entry: ReferenceEntry, angle: ReferenceAngle = "front") => referenceView(entry, angle).thumbnail;
const searchText = (text: string) =>
    text
        .toLocaleLowerCase()
        .replace(/回眸|回望/g, "回头")
        .replace(/叉腰/g, "扶腰")
        .replace(/托脸/g, "托腮")
        .replace(/举手|举臂|抬手|上举/g, "举臂")
        .replace(/坐下|坐着|侧坐|正坐/g, "坐姿")
        .replace(/站立/g, "站姿")
        .replace(/躺下|躺姿/g, "卧")
        .replace(/毛衣/g, "针织");
export function searchReferences(entries: ReferenceEntry[], query: string, category: string) {
    const words = searchText(query.trim()).split(/\s+/).filter(Boolean);
    return entries.filter((entry) => (!category || entry.category === category) && words.every((word) => searchText([entry.id, entry.title, entry.category, entry.instruction, ...entry.tags].join(" ")).includes(word)));
}
