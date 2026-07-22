import { useUserStore } from "@/stores/use-user-store";
import { AdminProvider } from "./admin-context";
import { AdminShell } from "./components/admin-shell";

export default function AdminPage() {
    const actor = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    if (!hydrated) return null;
    if (actor?.role !== "admin") {
        return (
            <main className="min-h-dvh bg-background px-6 py-10 text-foreground">
                <div className="mx-auto max-w-3xl rounded-lg border border-border bg-background p-6">
                    <h1 className="text-2xl font-semibold">无权限</h1>
                    <p className="mt-2 text-sm text-foreground/55">当前账号不是管理员，无法访问后台。</p>
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
