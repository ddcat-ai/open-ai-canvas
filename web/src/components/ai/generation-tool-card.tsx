import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export type GenerationToolStatus = "running" | "completed" | "error" | "cancelled";

export function GenerationToolCard({ status, isBulk = false, heading, children }: { status: GenerationToolStatus; isBulk?: boolean; heading: ReactNode; children: ReactNode }) {
    const { t } = useTranslation("canvas");
    const [open, setOpen] = useState(status !== "completed" || !isBulk);

    useEffect(() => {
        if (status !== "completed") setOpen(true);
    }, [status]);

    return (
        <>
            <div className="creation-message-heading">
                {heading}
                <button
                    type="button"
                    className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground"
                    aria-label={open ? t("domain:collapse-generation-details") : t("domain:expand-generation-details")}
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                >
                    <ChevronDown className={`size-4 transition-transform${open ? " rotate-180" : ""}`} />
                </button>
            </div>
            {open ? children : null}
        </>
    );
}
