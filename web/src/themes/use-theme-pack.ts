import { useAppearanceStore } from "@/stores/use-appearance-store";

import { themePackFor } from "./registry";

/** 当前后台启用的皮肤对应的主题包；没有对应主题包（例如经典皮肤）时返回 undefined。 */
export function useThemePack() {
    const skinId = useAppearanceStore((state) => state.appearance.skinId);
    return themePackFor(skinId);
}
