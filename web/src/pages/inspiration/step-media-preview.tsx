import { ImageOff, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { buildLibTVImagePreviewUrl, buildLibTVVideoPreviewUrl, buildLibTVVideoSourceUrl } from "@/lib/canvas/libtv-import";
import { cn } from "@/lib/utils";
import type { LibTVWorkStep } from "@/types/libtv-gallery";

export type LibTVStepMedia =
    | { kind: "image"; src: string; originalUrl: string }
    | { kind: "video"; src: string; poster?: string }
    | { kind: "audio"; src: string }
    | { kind: "none" };

/** 按步骤类型选择预览方式；地址保持 LibTV 外链，只复用已有缩略图/首帧参数，不转存。 */
export function describeLibTVStepMedia(step: LibTVWorkStep): LibTVStepMedia {
    const url = step.mediaUrls?.find((item) => item.trim())?.trim();
    if (!url || step.type === "text") return { kind: "none" };
    if (step.type === "video") return { kind: "video", src: buildLibTVVideoSourceUrl(url), poster: buildLibTVVideoPreviewUrl(url) || undefined };
    if (step.type === "audio") return { kind: "audio", src: url };
    return { kind: "image", src: buildLibTVImagePreviewUrl(url), originalUrl: url };
}

export function StepMediaPreview({ step, alt, full = false, className }: { step: LibTVWorkStep; alt: string; full?: boolean; className?: string }) {
    const media = describeLibTVStepMedia(step);
    if (media.kind === "none") return null;

    if (media.kind === "audio") {
        return (
            <div className={cn("flex w-full shrink-0 items-center rounded-lg px-3 py-4", full ? "min-h-40" : "sm:w-[280px]", className)} style={{ background: "var(--surface-hover)" }}>
                <audio src={media.src} controls preload="none" className="w-full" />
            </div>
        );
    }

    return (
        <div className={cn("relative w-full shrink-0 overflow-hidden rounded-lg", full ? "h-[min(68dvh,640px)]" : "h-[200px] sm:w-[200px]", className)} style={{ background: "var(--surface-hover)" }}>
            {media.kind === "video" ? (
                <video src={media.src} poster={media.poster} controls preload="none" playsInline className={`h-full w-full ${full ? "object-contain" : "object-cover"}`} />
            ) : (
                <StepImagePreview src={full ? media.originalUrl : media.src} originalUrl={media.originalUrl} alt={alt} full={full} />
            )}
        </div>
    );
}

function StepImagePreview({ src, originalUrl, alt, full }: { src: string; originalUrl: string; alt: string; full: boolean }) {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

    if (status === "error") {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-foreground/45">
                <ImageOff className="size-5" />
                <span>图片加载失败</span>
                <a href={originalUrl} target="_blank" rel="noreferrer" className="underline">
                    打开原图
                </a>
            </div>
        );
    }

    return (
        <>
            {status === "loading" && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <LoaderCircle className="size-5 animate-spin text-foreground/25" />
                </div>
            )}
            <img
                src={src}
                alt={alt}
                loading={full ? "eager" : "lazy"}
                className={`h-full w-full ${full ? "object-contain" : "object-cover"}`}
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
                style={{ opacity: status === "loaded" ? 1 : 0 }}
            />
        </>
    );
}
