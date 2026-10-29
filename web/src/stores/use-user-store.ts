import { create } from "zustand";

import { DEFAULT_DRAWING_ENGINE, type CanvasDrawingEngineSetting } from "@/lib/canvas/canvas-drawing-engine";
import type { PublicUserGroup } from "@/services/api/user-groups";

export type LocalUser = {
    id: string;
    username: string;
    email?: string;
    phone?: string;
    emailVerifiedAt?: string;
    phoneVerifiedAt?: string;
    displayName: string;
    avatarUrl?: string;
    avatarMode?: "custom" | "default" | "";
    avatarPreset?: string;
    identityProvider?: string;
    identityId?: string;
    identityUsername?: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    userGroup?: string;
    lastLoginAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RuntimeLimits = {
    activeTaskLimit: number;
    resourceUploadMB: number;
    recycleBinRetentionDays?: number;
};

export type FeatureAvailability = {
    welcomeEnabled: boolean;
    shortDramaEnabled: boolean;
    taskCenterEnabled: boolean;
    creditsEnabled: boolean;
    customChannelsEnabled: boolean;
    frontendModelsEnabled: boolean;
    pluginCenterEnabled: boolean;
    systemPluginsVisibleToUsers: boolean;
    inspirationSourcesVisible: boolean;
    imageWorkbenchEnabled: boolean;
    videoWorkbenchEnabled: boolean;
    configured?: boolean;
    updatedBy?: string;
    updatedAt?: string;
};

export const defaultFeatureAvailability: FeatureAvailability = {
    welcomeEnabled: true,
    shortDramaEnabled: true,
    taskCenterEnabled: true,
    creditsEnabled: true,
    customChannelsEnabled: true,
    frontendModelsEnabled: false,
    pluginCenterEnabled: true,
    systemPluginsVisibleToUsers: true,
    inspirationSourcesVisible: true,
    imageWorkbenchEnabled: false,
    videoWorkbenchEnabled: false,
};

type UserStore = {
    hydrated: boolean;
    user: LocalUser | null;
    runtimeLimits: RuntimeLimits;
    drawingEngine: CanvasDrawingEngineSetting;
    features: FeatureAvailability;
    referralAvailable: boolean;
    /** 当前账号分组的展示信息（徽章、折扣）；由会话接口下发。 */
    userGroup: PublicUserGroup | null;
    setUser: (user: LocalUser | null) => void;
    setRuntimeLimits: (limits?: RuntimeLimits) => void;
    setDrawingEngine: (setting?: CanvasDrawingEngineSetting) => void;
    setFeatures: (features?: FeatureAvailability) => void;
    setReferralAvailable: (available?: boolean) => void;
    setUserGroup: (group?: PublicUserGroup | null) => void;
    setHydrated: (hydrated: boolean) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    hydrated: false,
    user: null,
    runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 },
    drawingEngine: { defaultEngine: DEFAULT_DRAWING_ENGINE },
    features: defaultFeatureAvailability,
    referralAvailable: false,
    userGroup: null,
    setUser: (user) => set({ user }),
    setRuntimeLimits: (runtimeLimits) => set({ runtimeLimits: runtimeLimits || { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 } }),
    setDrawingEngine: (drawingEngine) => set({ drawingEngine: drawingEngine || { defaultEngine: DEFAULT_DRAWING_ENGINE } }),
    setFeatures: (features) => set({ features: features ? { ...defaultFeatureAvailability, ...features } : defaultFeatureAvailability }),
    setReferralAvailable: (available) => set({ referralAvailable: Boolean(available) }),
    setUserGroup: (userGroup) => set({ userGroup: userGroup || null }),
    setHydrated: (hydrated) => set({ hydrated }),
    clearSession: () => set({ user: null, runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 }, drawingEngine: { defaultEngine: DEFAULT_DRAWING_ENGINE }, features: defaultFeatureAvailability, referralAvailable: false, userGroup: null }),
}));
