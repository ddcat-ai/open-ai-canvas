import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getPublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, useAppearanceStore } from "@/stores/use-appearance-store";

export function SiteNoticeBar() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const [dismissed, setDismissed] = useState("");
    const fingerprint = JSON.stringify([appearance.noticeText, appearance.noticeLinkText, appearance.noticeLinkUrl]);
    useEffect(() => {
        const controller = new AbortController();
        const refresh = async () => {
            if (document.visibilityState !== "visible") return;
            try {
                const next = await getPublicAppearance(controller.signal);
                if (!controller.signal.aborted) commitPublicAppearance(next);
            } catch {
                /* Keep the last confirmed site content during network failures. */
            }
        };
        const timer = window.setInterval(() => void refresh(), 60_000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, []);
    if (!appearance.noticeEnabled || !appearance.noticeText || dismissed === fingerprint) return null;
    return (
        <aside aria-label="站点通知" role="status" className="flex shrink-0 items-start gap-3 border-b border-border bg-surface px-4 py-2 text-sm text-foreground">
            <Bell className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {appearance.noticeText}
                {appearance.noticeLinkUrl && appearance.noticeLinkText ? (
                    <a className="ml-3 underline underline-offset-4" href={appearance.noticeLinkUrl}>
                        {appearance.noticeLinkText}
                    </a>
                ) : null}
            </div>
            <button type="button" aria-label="关闭本次通知" className="shrink-0 rounded p-1 hover:bg-foreground/10 focus-visible:outline" onClick={() => setDismissed(fingerprint)}>
                <X className="size-4" />
            </button>
        </aside>
    );
}
