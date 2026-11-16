import { useUserStore } from "@/stores/use-user-store";

/** Skill library data is only available after the administrator session is loaded. */
export function hasSkillLibraryAccess(state = useUserStore.getState()) {
    return state.hydrated && state.user?.role === "admin";
}

export function useSkillLibraryAccess() {
    return useUserStore(hasSkillLibraryAccess);
}

export function skillLibraryUserId() {
    const state = useUserStore.getState();
    return hasSkillLibraryAccess(state) ? state.user!.id : null;
}

let permissionRevision = 0;
useUserStore.subscribe((state, previous) => {
    if (state.hydrated !== previous.hydrated || state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role) permissionRevision += 1;
});

export function captureSkillLibraryAccess() {
    const userId = skillLibraryUserId();
    return userId ? { userId, revision: permissionRevision } : null;
}

export function isSkillLibraryAccessCurrent(access: ReturnType<typeof captureSkillLibraryAccess>) {
    return Boolean(access && access.userId === skillLibraryUserId() && access.revision === permissionRevision);
}
