import { getPublicAppearance, type PublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE } from "@/stores/use-appearance-store";

const APPEARANCE_BOOTSTRAP_TIMEOUT_MS = 4_000;

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
