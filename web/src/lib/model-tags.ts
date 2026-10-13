export const modelTagColors = [
    { value: "purple", label: "紫色" },
    { value: "blue", label: "蓝色" },
    { value: "green", label: "绿色" },
    { value: "gold", label: "金色" },
    { value: "orange", label: "橙色" },
    { value: "pink", label: "粉色" },
] as const;

export type ModelTag = { text: string; color: typeof modelTagColors[number]["value"] };

export function videoReferenceCapabilityTag(references?: { maxImages?: number; maxVideos?: number; maxAudios?: number }): ModelTag | undefined {
    if (!references) return undefined;
    const counts = [
        ["图", references.maxImages],
        ["视", references.maxVideos],
        ["音", references.maxAudios],
    ] as const;
    const text = counts
        .filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count > 0)
        .map(([label, count]) => `${label}×${count}`)
        .join(" · ");
    return text ? { text, color: "green" } : undefined;
}
