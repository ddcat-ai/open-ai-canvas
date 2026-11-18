import { useUserStore } from "@/stores/use-user-store";

/** Skill usage requires a loaded, active account; content management is administrator-only. */
export function hasSkillLibraryAccess(state = useUserStore.getState()) {
    return state.hydrated && Boolean(state.user?.id) && state.user?.status === "active";
}

export function useSkillLibraryAccess() {
    return useUserStore(hasSkillLibraryAccess);
}

export function hasSkillAdministrationAccess(state = useUserStore.getState()) {
    return hasSkillLibraryAccess(state) && state.user?.role === "admin";
}

export function useSkillAdministrationAccess() {
    return useUserStore(hasSkillAdministrationAccess);
}

export function skillLibraryUserId() {
    const state = useUserStore.getState();
    return hasSkillLibraryAccess(state) ? state.user!.id : null;
}

let permissionRevision = 0;
useUserStore.subscribe((state, previous) => {
    if (state.hydrated !== previous.hydrated || state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role || state.user?.status !== previous.user?.status) permissionRevision += 1;
});

export function captureSkillLibraryAccess() {
    const userId = skillLibraryUserId();
    return userId ? { userId, revision: permissionRevision } : null;
}

export function isSkillLibraryAccessCurrent(access: ReturnType<typeof captureSkillLibraryAccess>) {
    return Boolean(access && access.userId === skillLibraryUserId() && access.revision === permissionRevision);
}
