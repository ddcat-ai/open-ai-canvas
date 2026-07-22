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

type UserStore = {
    hydrated: boolean;
    user: LocalUser | null;
    setUser: (user: LocalUser | null) => void;
    setHydrated: (hydrated: boolean) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    hydrated: false,
    user: null,
    setUser: (user) => set({ user }),
    setHydrated: (hydrated) => set({ hydrated }),
    clearSession: () => set({ user: null }),
}));
