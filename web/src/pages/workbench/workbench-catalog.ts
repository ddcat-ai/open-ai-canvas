import type { WorkbenchKind, WorkbenchReferenceSlot } from "@/services/api/workbench";

export const workbenchCategories = [
    { value: "recommended", label: "推荐" },
    { value: "people", label: "人物" },
    { value: "ecommerce", label: "电商" },
    { value: "product", label: "商品" },
    { value: "drama-character", label: "短剧角色" },
    { value: "drama-scene", label: "短剧场景" },
    { value: "storyboard", label: "短剧分镜" },
    { value: "short-video", label: "短视频" },
    { value: "scene", label: "场景" },
    { value: "enhancement", label: "增强" },
];

export function workbenchCategoryLabel(id: string) {
    return workbenchCategories.find((category) => category.value === id)?.label || id;
}

export function workbenchModeOptions(kind: WorkbenchKind) {
    return kind === "image"
        ? [
              { value: "image", label: "图片生成" },
              { value: "image_edit", label: "图片编辑" },
          ]
        : [{ value: "video", label: "视频生成" }];
}

export const workbenchMediaLabel = (kind: string) => (kind === "image" ? "图片" : kind === "video" ? "视频" : "音频");

/** 用户可读的输入约束文案，避免在下拉标签里堆叠过长说明。 */
export function workbenchSlotRequirement(slot: WorkbenchReferenceSlot) {
    const media = slot.mediaTypes.map(workbenchMediaLabel).join(" / ");
    if (slot.required || slot.minCount > 0) return `${media} · 必填 ${slot.minCount}-${slot.maxCount} 个`;
    return `${media} · 可选，最多 ${slot.maxCount} 个`;
}
