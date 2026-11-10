import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import { App, Button } from "antd";
import { ArrowUpRight, FolderOpen, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { AgentOrb } from "@/components/ui/agent-orb";
import { canvasDraftNavigationState, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { hasRemoteUserDataSyncSession } from "@/services/user-data-sync";

/** 进入时只分配草稿 ID；明确提交创作时再建立同一画布的服务端记录。 */
export function CreationAgentEntry() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { openAuth } = useAuthEntry();
    const { message } = App.useApp();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const created = useRef<{ id: string; userId: string } | null>(null);
    const start = async () => {
        if (lock.current) return;
        if (!useUserStore.getState().user) {
            openAuth({ preferDialog: true });
            return;
        }
        lock.current = true;
        setBusy(true);
        setError("");
        const userId = useUserStore.getState().user?.id;
        try {
            if (!userId || !hasRemoteUserDataSyncSession()) throw new Error(t("create.agentEntry.sessionNotReady"));
            if (!hydrated) throw new Error(t("create.agentEntry.canvasRestoring"));
            if (created.current?.userId !== userId) created.current = null;
            if (!created.current) {
                const id = useCanvasStore.getState().createDraftProject(t("create.agentEntry.canvasTitle"));
                created.current = { id, userId };
            }
            if (useUserStore.getState().user?.id !== userId) return;
            navigate(`/canvas/${encodeURIComponent(created.current.id)}?agent=1`, { state: canvasDraftNavigationState(created.current.id) });
        } catch (cause) {
            if (useUserStore.getState().user?.id === userId) {
                const detail = cause instanceof Error ? cause.message : t("create.agentEntry.startFailed");
                setError(detail);
                message.error(detail);
            }
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    return (
        <section className="creation-agent-entry" aria-label={t("create.agentEntry.region")}>
            <div className="creation-agent-orb" aria-hidden>
                <AgentOrb size={88} />
            </div>
            <div className="creation-agent-copy">
                <span className="creation-agent-eyebrow">CANVAS AGENT</span>
                <h2>{t("create.agentEntry.title")}</h2>
                <p>{t("create.agentEntry.description")}</p>
            </div>
            <div className="creation-agent-actions">
                <Button type="primary" icon={<ArrowRight />} loading={busy} disabled={!hydrated} onClick={() => void start()}>
                    {created.current ? t("create.agentEntry.retryEnter") : t("create.agentEntry.newCanvas")}
                    <ArrowUpRight />
                </Button>
                <Button icon={<FolderOpen />} disabled={busy} onClick={() => navigate("/canvas?agent=1")}>
                    {t("create.agentEntry.continueExisting")}
                </Button>
            </div>
            {error ? (
                <p className="creation-agent-error" role="alert">
                    {error}
                </p>
            ) : null}
        </section>
    );
}
