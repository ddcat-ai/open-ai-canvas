import { App } from "antd";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminReferences, type AdminReferenceData, type LocalUser } from "@/services/api/auth";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type AdminContextValue = {
    references: AdminReferenceData;
    referencesLoading: boolean;
    reloadReferences: () => Promise<void>;
    updateUserReference: (user: LocalUser) => void;
};

const emptyReferences: AdminReferenceData = { users: [], channels: [] };
const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [references, setReferences] = useState<AdminReferenceData>(emptyReferences);
    const [referencesLoading, setReferencesLoading] = useState(true);

    const reloadReferences = useCallback(async () => {
        setReferencesLoading(true);
        try {
            setReferences(await getAdminReferences());
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-load-admin-base-data"));
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
            users: current.users.map((item) => (item.id === user.id ? { id: user.id, username: user.username, displayName: user.displayName } : item)),
        }));
    }, []);

    const value = useMemo(() => ({ references, referencesLoading, reloadReferences, updateUserReference }), [references, referencesLoading, reloadReferences, updateUserReference]);
    return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext() {
    const value = useContext(AdminContext);
    if (!value) throw new Error(t("admin:useadmincontext-must-be-used-within-adminprovider"));
    return value;
}
