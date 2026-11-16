import { useEffectiveSkin } from "@/stores/use-appearance-preferences-store";

import { themePackFor } from "./registry";

/** 个人选定的主题优先，否则使用站点主题。 */
export function useThemePack() {
    return themePackFor(useEffectiveSkin().id);
}
