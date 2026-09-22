import { createContext, useContext, useState, type ReactNode } from "react";

export type AdminDensity = "compact" | "comfortable";

export function normalizeAdminDensity(value: string | null): AdminDensity {
    return value === "comfortable" ? "comfortable" : "compact";
}

export function adminDensityStorageKey(userId: string) {
    return `admin-console:${encodeURIComponent(userId)}:density`;
}

const AdminDensityContext = createContext<{ density: AdminDensity; toggleDensity: () => void }>({ density: "compact", toggleDensity: () => {} });

export function AdminDensityProvider({ userId, children }: { userId?: string; children: ReactNode }) {
    const [density, setDensity] = useState<AdminDensity>(() => {
        if (!userId || typeof window === "undefined") return "compact";
        try {
            return normalizeAdminDensity(window.localStorage.getItem(adminDensityStorageKey(userId)));
        } catch (error) {
            console.warn("无法读取后台密度偏好，使用紧凑布局", error);
            return "compact";
        }
    });

    const toggleDensity = () => {
        const next = density === "compact" ? "comfortable" : "compact";
        setDensity(next);
        if (!userId) return;
        try {
            window.localStorage.setItem(adminDensityStorageKey(userId), next);
        } catch (error) {
            console.warn("后台密度已切换，但无法保存偏好", error);
        }
    };

    return <AdminDensityContext.Provider value={{ density, toggleDensity }}>{children}</AdminDensityContext.Provider>;
}

export function useAdminDensity() {
    return useContext(AdminDensityContext);
}
