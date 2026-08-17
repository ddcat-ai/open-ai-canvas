import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type GenerationToolStatus = "running" | "completed" | "error" | "cancelled";

export function GenerationToolCard({ status, isBulk = false, heading, children }: { status: GenerationToolStatus; isBulk?: boolean; heading: ReactNode; children: ReactNode }) {
    const [open, setOpen] = useState(status !== "completed" || !isBulk);

    useEffect(() => {
        if (status !== "completed") setOpen(true);
    }, [status]);

    return <>
        <div className="creation-message-heading">
            {heading}
            <button type="button" className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground" aria-label={open ? "收起生成详情" : "展开生成详情"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <ChevronDown className={`size-4 transition-transform${open ? " rotate-180" : ""}`} />
            </button>
        </div>
        {open ? children : null}
    </>;
}
