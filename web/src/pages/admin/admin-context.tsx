import { App } from "antd";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminReferences, type AdminReferenceData, type LocalUser } from "@/services/api/auth";

type AdminContextValue = {
    references: AdminReferenceData;
    referencesLoading: boolean;
    reloadReferences: () => Promise<void>;
    updateUserReference: (user: LocalUser) => void;
};

const emptyReferences: AdminReferenceData = { users: [], channels: [] };
const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const [references, setReferences] = useState<AdminReferenceData>(emptyReferences);
    const [referencesLoading, setReferencesLoading] = useState(true);

    const reloadReferences = useCallback(async () => {
        setReferencesLoading(true);
        try {
            setReferences(await getAdminReferences());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取后台基础数据失败");
        } finally {
            setReferencesLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void reloadReferences();
    }, [reloadReferences]);

    const updateUserReference = useCallback((user: LocalUser) => {
        setReferences((current) => ({
            ...current,
            users: current.users.map((item) => item.id === user.id ? { id: user.id, username: user.username, displayName: user.displayName } : item),
        }));
    }, []);

    const value = useMemo(() => ({ references, referencesLoading, reloadReferences, updateUserReference }), [references, referencesLoading, reloadReferences, updateUserReference]);
    return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext() {
    const value = useContext(AdminContext);
    if (!value) throw new Error("useAdminContext 必须在 AdminProvider 内使用");
    return value;
}
