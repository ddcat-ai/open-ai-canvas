import type { ThemePack } from "./types";

const packs = new Map<string, ThemePack>();

/** 主题包在自己的 index.ts 里调用；同一 id 重复登记时以后一次为准。 */
export function registerThemePack(pack: ThemePack) {
    packs.set(pack.id, pack);
}

export function themePackFor(skinId: string | null | undefined): ThemePack | undefined {
    return skinId ? packs.get(skinId) : undefined;
}

export function registeredThemePacks(): ThemePack[] {
    return [...packs.values()];
}
