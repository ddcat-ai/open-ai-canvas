/**
 * 灵感目录的合成规则：内置目录是只读的，用户的增删改以「覆盖 / 隐藏 / 新增」三种形式叠在上面。
 * 三个集合都不改内置数据本身，这样外部目录重新导入后用户的改动仍然对得上 id。
 */
import { catalogIdOf, type CreationInspiration } from "./catalog";

/** 用户可以改写的字段。id 与 sourceId 是归属标识，不参与改写。 */
export type InspirationOverride = Partial<Pick<CreationInspiration, "title" | "description" | "image" | "mode" | "prompt" | "promptZh" | "category" | "tags" | "ratio">>;

export type InspirationOverlay = {
    /** 用户新建的条目，id 一定是自定义前缀。 */
    custom: CreationInspiration[];
    /** 按 id 覆盖内置条目。 */
    overrides: Record<string, InspirationOverride>;
    /** 被用户隐藏的内置条目 id。 */
    hidden: string[];
};

export const EMPTY_OVERLAY: InspirationOverlay = { custom: [], overrides: {}, hidden: [] };

/** 自定义条目的 id 前缀，用来区分「可以真删」和「只能隐藏」。 */
export const CUSTOM_ID_PREFIX = "custom:";

export function isCustomInspiration(id: string): boolean {
    return id.startsWith(CUSTOM_ID_PREFIX);
}

function withoutUndefined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

/**
 * 把用户的改动叠到内置目录上，并按用户顺序把新建条目插在最前。
 * 隐藏只对内置条目生效：新建条目直接删除，没必要留一个隐藏态。
 */
export function resolveInspirations(builtIn: CreationInspiration[], overlay: InspirationOverlay): CreationInspiration[] {
    const hidden = new Set(overlay.hidden.filter((id) => !isCustomInspiration(id)));
    const resolved = builtIn.flatMap((item) => {
        const id = catalogIdOf(item);
        if (hidden.has(id)) return [];
        const override = overlay.overrides[id];
        return [override ? { ...item, ...withoutUndefined(override) } : item];
    });
    return [...overlay.custom, ...resolved];
}

/** 当前生效条目里属于某个来源的部分，用于灵感页按来源筛选。 */
export function itemsBySource(items: CreationInspiration[], sourceId: string): CreationInspiration[] {
    return items.filter((item) => (item.sourceId ?? "original") === sourceId);
}

/**
 * 一键填入创作时优先用中文正文：外部图片提示词的原文是英文，
 * 中文界面下把英文整段塞进编辑器是坏体验，双语来源就用中文那版。
 */
export function fillablePrompt(item: CreationInspiration): string {
    return (item.promptZh || item.prompt || "").trim();
}
