import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { useTranslation } from "react-i18next";

export function MessageReasoning({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
    const { t } = useTranslation("canvas");
    const [open, setOpen] = useState(isStreaming);
    const [durationSeconds, setDurationSeconds] = useState<number>();
    const startedAtRef = useRef<number | undefined>(undefined);
    const autoClosedRef = useRef(false);

    useEffect(() => {
        if (!isStreaming) return;
        startedAtRef.current ??= Date.now();
        setOpen(true);
    }, [isStreaming]);

    useEffect(() => {
        if (isStreaming || !startedAtRef.current) return;
        setDurationSeconds(Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
        startedAtRef.current = undefined;
    }, [isStreaming]);

    useEffect(() => {
        if (isStreaming || !open || autoClosedRef.current || durationSeconds === undefined) return;
        const timer = window.setTimeout(() => {
            setOpen(false);
            autoClosedRef.current = true;
        }, 1000);
        return () => window.clearTimeout(timer);
    }, [durationSeconds, isStreaming, open]);

    return (
        <div className="mb-2 text-xs text-foreground/55">
            <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-surface-hover hover:text-foreground" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <Sparkles className="size-3.5" />
                <span>{isStreaming ? t("domain:thinking") : durationSeconds ? t("domain:thought-for-params", { durationSeconds: durationSeconds }) : t("domain:reasoning")}</span>
                <ChevronDown className={`size-3.5 transition-transform${open ? " rotate-180" : ""}`} />
            </button>
            {open ? (
                <div className="mt-2 rounded-md bg-surface-active p-3 text-foreground/70">
                    <AIMessageMarkdown isStreaming={isStreaming}>{reasoning}</AIMessageMarkdown>
                </div>
            ) : null}
        </div>
    );
}
