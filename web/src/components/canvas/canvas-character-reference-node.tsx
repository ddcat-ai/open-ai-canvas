import { Image as ImageIcon, Mic } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { getResourceAccess, resolveResourceAccessURL, resourceStorageKey } from "@/services/api/resources";
import type { CanvasNodeData } from "@/types/canvas";

const RESOURCE_FILE_PATTERN = /\/resources\/([^/?#]+)\/file/;

/** 角色卡封面存的是 `/resources/:id/file`，展示前换成授权访问地址；换取失败再回落原地址。 */
export function useCharacterCoverSrc(url?: string) {
    const [resolved, setResolved] = useState<{ url: string; src: string } | null>(null);
    const resourceId = url ? RESOURCE_FILE_PATTERN.exec(url)?.[1] : undefined;
    useEffect(() => {
        if (!url || !resourceId) return;
        let cancelled = false;
        getResourceAccess(resourceStorageKey(decodeURIComponent(resourceId)), "display")
            .then((access) => {
                if (!cancelled) setResolved({ url, src: resolveResourceAccessURL(access.url) || url });
            })
            .catch(() => {
                if (!cancelled) setResolved({ url, src: url });
            });
        return () => {
            cancelled = true;
        };
    }, [resourceId, url]);
    if (!url) return "";
    if (!resourceId) return url;
    return resolved?.url === url ? resolved.src : "";
}

export function characterCoverResourceId(url?: string) {
    const id = url ? RESOURCE_FILE_PATTERN.exec(url)?.[1] : undefined;
    return id ? decodeURIComponent(id) : "";
}

export function characterInitial(name: string) {
    return Array.from(name.trim())[0] || "角";
}

/** 画布上的角色卡：海报式主视觉，底部压名字与形象/声音状态。 */
export function CanvasCharacterReferenceNodeContent({ node }: { node: CanvasNodeData }) {
    const metadata = node.metadata;
    const name = metadata?.characterName || node.title || "未命名角色";
    const role = typeof metadata?.characterDefinition?.role === "string" ? metadata.characterDefinition.role.trim() : "";
    const visualReady = metadata?.characterVisualStatus === "ready";
    const voiceReady = metadata?.characterVoiceStatus === "ready";
    const cover = useCharacterCoverSrc(metadata?.characterCoverUrl);

    return (
        <div className="relative isolate h-full w-full overflow-hidden bg-[#111114] text-white">
            {cover ? (
                <>
                    <img src={cover} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-50 blur-2xl saturate-125" draggable={false} />
                    <img src={cover} alt={name} className="absolute inset-x-0 top-0 h-[calc(100%-40px)] w-full object-contain px-3 pt-3 drop-shadow-[0_18px_30px_rgba(0,0,0,.45)]" draggable={false} />
                </>
            ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,.1),transparent_60%)] pb-10">
                    <span className="grid size-20 place-items-center rounded-full border border-white/15 bg-white/[.03] text-3xl font-light text-white/75">{characterInitial(name)}</span>
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
            <span className="absolute left-3.5 top-3 text-[10px] font-medium uppercase tracking-[.24em] text-white/55">Character</span>
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-3.5 pb-3">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-semibold leading-6 tracking-tight">{name}</div>
                    <div className="truncate text-[11px] leading-4 text-white/55">{role || (voiceReady && metadata?.characterVoiceName ? `声音 · ${metadata.characterVoiceName}` : "角色卡")}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Indicator ready={visualReady} label={visualReady ? "形象已就绪" : "形象待完善"}>
                        <ImageIcon className="size-3" />
                    </Indicator>
                    <Indicator ready={voiceReady} label={voiceReady ? `声音：${metadata?.characterVoiceName || "已绑定"}` : "声音未绑定"}>
                        <Mic className="size-3" />
                    </Indicator>
                </div>
            </div>
        </div>
    );
}

function Indicator({ ready, label, children }: { ready: boolean; label: string; children: ReactNode }) {
    return (
        <span title={label} aria-label={label} className={`relative grid size-6 place-items-center rounded-full border backdrop-blur ${ready ? "border-white/25 bg-white/15 text-white" : "border-white/10 bg-white/[.04] text-white/35"}`}>
            {children}
            {ready ? <span className="absolute -right-px -top-px size-1.5 rounded-full bg-emerald-400" /> : null}
        </span>
    );
}
