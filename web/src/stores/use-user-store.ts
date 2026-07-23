import { create } from "zustand";

export type LocalUser = {
    id: string;
    username: string;
    email?: string;
    displayName: string;
    avatarUrl?: string;
    identityProvider?: string;
    identityId?: string;
    identityUsername?: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    lastLoginAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RuntimeLimits = {
    activeTaskLimit: number;
    resourceUploadMB: number;
    sessionUploadMB: number;
};

type UserStore = {
    hydrated: boolean;
    user: LocalUser | null;
    runtimeLimits: RuntimeLimits;
    setUser: (user: LocalUser | null) => void;
    setRuntimeLimits: (limits?: RuntimeLimits) => void;
    setHydrated: (hydrated: boolean) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    hydrated: false,
    user: null,
    runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, sessionUploadMB: 32 },
    setUser: (user) => set({ user }),
    setRuntimeLimits: (runtimeLimits) => set({ runtimeLimits: runtimeLimits || { activeTaskLimit: 5, resourceUploadMB: 50, sessionUploadMB: 32 } }),
    setHydrated: (hydrated) => set({ hydrated }),
    clearSession: () => set({ user: null, runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, sessionUploadMB: 32 } }),
}));
