export const modelTagColors = [
    { value: "purple", label: "紫色" },
    { value: "blue", label: "蓝色" },
    { value: "green", label: "绿色" },
    { value: "gold", label: "金色" },
    { value: "orange", label: "橙色" },
    { value: "pink", label: "粉色" },
] as const;

export type ModelTag = { text: string; color: typeof modelTagColors[number]["value"] };
