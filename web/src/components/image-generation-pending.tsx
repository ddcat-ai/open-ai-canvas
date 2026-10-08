import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { formatDuration } from "@/lib/image-utils";
import { cn } from "@/lib/utils";

type PendingImageProps = { className?: string; label?: string; compact?: boolean };

export function ImageGenerationPending({ className, label = "正在生成图片", compact = false }: PendingImageProps) {
    const [startedAt] = useState(() => Date.now());
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
        const clock = window.setInterval(update, 1000);
        const onVisible = () => {
            if (!document.hidden) update();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.clearInterval(clock);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [startedAt]);
    return (
        <div aria-busy="true" className={cn("flex flex-col items-center justify-center gap-3 rounded-lg bg-surface-active p-4 text-muted-foreground", compact ? "min-h-24" : "aspect-[4/3]", className)}>
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
            <span role="status" className="text-sm font-medium">
                {label}
            </span>
            <time className="text-xs tabular-nums" dateTime={`PT${Math.floor(elapsed / 1000)}S`}>
                已等待 {formatDuration(elapsed)}
            </time>
        </div>
    );
}
