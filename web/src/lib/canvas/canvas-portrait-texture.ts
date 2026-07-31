export type PortraitTextureSettings = {
    personSceneFusion: "light" | "natural" | "deep";
    lightingFusion: "soft" | "natural" | "atmosphere";
    skin: "clear" | "natural" | "real";
    texture: "soft" | "natural" | "grain";
    sharpness: "soft" | "standard" | "high";
};

export type PortraitTextureSettingKey = keyof PortraitTextureSettings;

type PortraitTextureOption = {
    value: string;
    label: string;
    prompt: string;
};

export type PortraitTextureGroup = {
    key: PortraitTextureSettingKey;
    label: string;
    options: readonly PortraitTextureOption[];
};

export const DEFAULT_PORTRAIT_TEXTURE_SETTINGS: PortraitTextureSettings = {
    personSceneFusion: "deep",
    lightingFusion: "natural",
    skin: "natural",
    texture: "natural",
    sharpness: "standard",
};

export const PORTRAIT_TEXTURE_GROUPS: readonly PortraitTextureGroup[] = [
    {
        key: "personSceneFusion",
        label: "人景融合",
        options: [
            { value: "light", label: "轻度对齐", prompt: "轻度对齐人物与场景，仅修正明显边缘和空间关系" },
            { value: "natural", label: "自然融合", prompt: "自然融合人物与场景，统一边缘、色调和空间关系" },
            { value: "deep", label: "深度融合", prompt: "深度融合人物与场景，细致统一边缘、环境色和空间层次" },
        ],
    },
    {
        key: "lightingFusion",
        label: "光影融合",
        options: [
            { value: "soft", label: "柔和补光", prompt: "使用柔和补光，减弱生硬阴影并保留自然明暗" },
            { value: "natural", label: "自然匹配", prompt: "让人物光向、色温与场景光线自然匹配" },
            { value: "atmosphere", label: "氛围强化", prompt: "强化环境光与氛围光，保持光影方向合理" },
        ],
    },
    {
        key: "skin",
        label: "皮肤",
        options: [
            { value: "clear", label: "清透修饰", prompt: "清透修饰皮肤，适度均匀肤色且不过度磨皮" },
            { value: "natural", label: "自然肤质", prompt: "保留自然肤质、毛孔和真实肤色过渡" },
            { value: "real", label: "真实肌理", prompt: "强化真实皮肤肌理和细微质感，避免塑料感" },
        ],
    },
    {
        key: "texture",
        label: "纹理",
        options: [
            { value: "soft", label: "柔和纹理", prompt: "使用柔和细腻的整体纹理，减少粗糙噪点" },
            { value: "natural", label: "自然纹理", prompt: "保持服装、头发、皮肤和场景材质的自然纹理" },
            { value: "grain", label: "颗粒质感", prompt: "增加克制的颗粒质感和材质层次" },
        ],
    },
    {
        key: "sharpness",
        label: "锐度",
        options: [
            { value: "soft", label: "柔焦", prompt: "使用轻柔焦效果，保持主体轮廓可辨" },
            { value: "standard", label: "标准清晰", prompt: "保持标准清晰度，细节自然且不过度锐化" },
            { value: "high", label: "高清锐化", prompt: "提升关键细节清晰度，避免锐化光晕和噪点" },
        ],
    },
] as const;

export function normalizePortraitTextureSettings(value: unknown): PortraitTextureSettings {
    const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
        personSceneFusion: normalizeSetting("personSceneFusion", candidate.personSceneFusion),
        lightingFusion: normalizeSetting("lightingFusion", candidate.lightingFusion),
        skin: normalizeSetting("skin", candidate.skin),
        texture: normalizeSetting("texture", candidate.texture),
        sharpness: normalizeSetting("sharpness", candidate.sharpness),
    };
}

export function buildPortraitTexturePrompt(userPrompt: string, value: unknown) {
    const settings = normalizePortraitTextureSettings(value);
    const instructions = PORTRAIT_TEXTURE_GROUPS.map((group) => {
        const selected = group.options.find((option) => option.value === settings[group.key]);
        return `${group.label}（${selected?.label || "默认"}）：${selected?.prompt || "保持自然"}`;
    });

    return [
        userPrompt.trim(),
        "请基于参考图片进行人物质感调节，只优化下列视觉属性：",
        ...instructions.map((instruction) => `- ${instruction}`),
        "必须保持原人物身份、五官、发型、服装、姿势、构图、场景和画面比例；不得新增或删除主体，不得添加文字、水印或标志。",
    ].filter(Boolean).join("\n");
}

function normalizeSetting<Key extends PortraitTextureSettingKey>(key: Key, value: unknown): PortraitTextureSettings[Key] {
    const group = PORTRAIT_TEXTURE_GROUPS.find((item) => item.key === key);
    return group?.options.some((option) => option.value === value)
        ? value as PortraitTextureSettings[Key]
        : DEFAULT_PORTRAIT_TEXTURE_SETTINGS[key];
}
