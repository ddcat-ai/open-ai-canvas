import { useEffect, useState } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { AppModal } from "@/components/ui/product/app-modal";
import type { CreationHistorySync, HistoryConflictBackup, HistorySyncStatus } from "@/services/creation-history-sync";

export function CreationHistoryConflicts({ session, status, busy }: { session: CreationHistorySync | null; status: HistorySyncStatus; busy: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [backups, setBackups] = useState<HistoryConflictBackup[]>([]);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    useEffect(() => {
        if (!open || !session) return;
        try {
            setBackups(session.conflictBackups());
        } catch {
            setOpen(false);
            setBackups([]);
        }
    }, [open, session, status]);

    async function resolve(item: HistoryConflictBackup, action: "keep" | "restore") {
        if (!session || working || (action === "restore" && busy)) return;
        setWorking(true);
        setError("");
        setNotice("");
        try {
            await session.resolveConflict(item.key, action, t("create.historySync.restoredTitle", { title: item.local.title }));
            setBackups(session.conflictBackups());
            setNotice(t(action === "restore" ? "create.historySync.restoredNotice" : "create.historySync.keptNotice"));
            if (action === "restore") void session.sync();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("create.historySync.resolveFailed"));
        } finally {
            setWorking(false);
        }
    }

    if (!status.backupCount) return null;
    return (
        <>
            <button type="button" className="ml-2 underline" onClick={() => setOpen(true)}>
                {t("create.historySync.manage", { count: status.backupCount })}
            </button>
            <AppModal open={open} title={t("create.historySync.backupsTitle")} onCancel={() => setOpen(false)} footer={null} width={680}>
                <p className="mb-4 text-sm text-foreground/60">{t("create.historySync.backupsDescription")}</p>
                <Button
                    className="mb-4"
                    onClick={() => {
                        try {
                            const backup = session?.conflictBackup();
                            if (!backup) return;
                            const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = "conversation-conflicts.json";
                            link.click();
                            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : t("create.historySync.resolveFailed"));
                        }
                    }}
                >
                    {t("create.historySync.backup")}
                </Button>
                {error ? (
                    <p role="alert" className="mb-3 text-sm text-foreground">
                        {error}
                    </p>
                ) : null}
                {notice ? (
                    <p role="status" className="mb-3 text-sm text-foreground/60">
                        {notice}
                    </p>
                ) : null}
                <div className="max-h-[55vh] space-y-4 overflow-y-auto" data-canvas-wheel-scroll>
                    {backups.map((item) => (
                        <section key={item.key} className="rounded-lg border border-border p-4">
                            <h3 className="break-words font-medium">{item.local.title}</h3>
                            <p className="mt-1 text-xs text-foreground/60">
                                <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time> · {t(item.resolvedAt ? "create.historySync.resolved" : "create.historySync.unresolved")}
                            </p>
                            <details className="my-3 text-sm">
                                <summary className="cursor-pointer">{t("create.historySync.preview", { count: item.local.messages.length })}</summary>
                                <div className="mt-2 space-y-2">
                                    {item.local.messages.map((message) => (
                                        <div key={message.id} className="whitespace-pre-wrap break-words border-l border-border pl-3">
                                            <span className="text-xs text-foreground/60">{message.role}</span>
                                            <p>{message.content || t("create.historySync.mediaMessage")}</p>
                                        </div>
                                    ))}
                                </div>
                            </details>
                            <div className="flex flex-wrap gap-2">
                                {!item.resolvedAt ? (
                                    <Button disabled={working} onClick={() => void resolve(item, "keep")}>
                                        {t("create.historySync.keep")}
                                    </Button>
                                ) : null}
                                <Button disabled={working || busy || Boolean(item.restoredConversationId)} onClick={() => void resolve(item, "restore")}>
                                    {t(item.restoredConversationId ? "create.historySync.restored" : "create.historySync.restore")}
                                </Button>
                            </div>
                        </section>
                    ))}
                </div>
            </AppModal>
        </>
    );
}
