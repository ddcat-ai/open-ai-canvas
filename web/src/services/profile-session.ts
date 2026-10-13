import { invalidateAuthSessionCache } from "@/services/api/auth";
import { getUserProfile } from "@/services/api/profile";
import { useUserStore } from "@/stores/use-user-store";

export async function loadProfileSession(userId: string | undefined, signal: AbortSignal) {
    const profile = await getUserProfile(signal);
    if (!signal.aborted && useUserStore.getState().user?.id === userId && profile.user.id === userId) {
        invalidateAuthSessionCache();
        useUserStore.getState().setUser(profile.user);
    }
    return profile;
}
