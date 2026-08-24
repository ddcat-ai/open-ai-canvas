import { useUserStore } from "@/stores/use-user-store";
import { AdminProvider } from "./admin-context";
import { AdminShell } from "./components/admin-shell";
import { useTranslation } from "react-i18next";

export default function AdminPage() {
    const { t } = useTranslation("canvas");
    const actor = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    if (!hydrated) return null;
    if (actor?.role !== "admin") {
        return (
            <main className="app-workspace-page min-h-dvh px-6 py-10 text-foreground">
                <div className="mx-auto max-w-3xl rounded-lg border border-border bg-[var(--workspace-surface)] p-6">
                    <h1 className="text-2xl font-semibold">{t("admin:no-permission")}</h1>
                    <p className="mt-2 text-sm text-foreground/55">{t("admin:this-account-is-not-an-administrator-and-cannot-access-the-console")}</p>
                </div>
            </main>
        );
    }

    return (
        <AdminProvider>
            <AdminShell />
        </AdminProvider>
    );
}
