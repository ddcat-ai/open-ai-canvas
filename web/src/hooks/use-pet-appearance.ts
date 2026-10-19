import { useEffect } from "react";
import { DEFAULT_CANVAS_APPEARANCE } from "@/lib/canvas/agent-appearance";
import { DEFAULT_PET_PREFERENCE, effectivePet } from "@/lib/canvas/pet-menu";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { usePetPreference } from "@/stores/use-pet-preference";
import { useUserStore } from "@/stores/use-user-store";

/** All customer-facing pet surfaces share the current account's published choice. */
export function usePetAppearance() {
    const settings = useAppearanceStore((s) => s.appearance);
    const resolved = useAppearanceStore((s) => s.resolved);
    const scope = useUserStore((s) => s.user?.id) || "guest";
    const store = usePetPreference();
    const base = settings.canvas || DEFAULT_CANVAS_APPEARANCE;
    const catalog = settings.petCatalog || [];
    const preference = store.scope === scope ? store.preference : DEFAULT_PET_PREFERENCE;
    const available = preference.modelId === "system" || catalog.some((p) => p.id === preference.modelId && p.published);
    const modelId = available ? preference.modelId : "system";
    useEffect(() => {
        void usePetPreference.getState().load(scope);
        const refresh = () => void usePetPreference.getState().load(scope, true);
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [scope]);
    return { base, catalog, scope, store, preference, available, modelId, appearance: effectivePet(base, catalog, modelId), resolved: resolved && store.scope === scope && store.resolved };
}
