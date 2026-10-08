import { getPublicAppearance, type PublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } from "@/stores/use-appearance-store";

const APPEARANCE_BOOTSTRAP_TIMEOUT_MS = 4_000;
let refreshing: Promise<PublicAppearance | undefined> | undefined;

// A failed refresh must keep the last saved identity rather than restore defaults.
export function refreshPublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const previous = useAppearanceStore.getState().appearance;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
        try {
            const appearance = await fetchAppearance(controller.signal);
            if (useAppearanceStore.getState().appearance !== previous) return undefined;
            return commitPublicAppearance(appearance);
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    })().finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export async function resolvePublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
    try {
        return await fetchAppearance(controller.signal);
    } catch {
        return DEFAULT_PUBLIC_APPEARANCE;
    } finally {
        clearTimeout(timer);
    }
}

export async function bootstrapAppearance(fetchAppearance?: (signal: AbortSignal) => Promise<PublicAppearance>) {
    return commitPublicAppearance(await resolvePublicAppearance(fetchAppearance));
}
