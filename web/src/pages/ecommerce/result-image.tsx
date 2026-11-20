import { useState, type ImgHTMLAttributes } from "react";
import "./result-image.css";

export function CommerceProgressArtwork({ title, detail }: { title: string; detail: string }) {
    return (
        <span className="commerce-progress-artwork">
            <span className="commerce-progress-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
                <img src="/commerce/agent-mark.svg" alt="" />
            </span>
            <strong>{title}</strong>
            <small>{detail}</small>
            <span className="commerce-progress-track" aria-hidden="true">
                <i />
            </span>
        </span>
    );
}

/** 生成占位：版式骨架 + 光带扫过 + 缓慢流动的色场；排队时更安静。只动 transform/opacity。 */
export function CommerceGeneratingArtwork({ queued, label }: { queued: boolean; label: string }) {
    return (
        <span className={`commerce-generating${queued ? " is-queued" : ""}`}>
            <span className="commerce-generating-aura" aria-hidden="true">
                <i />
                <i />
            </span>
            <span className="commerce-generating-layout" aria-hidden="true">
                <i className="is-title" />
                <i className="is-subtitle" />
                <i className="is-hero" />
                <span className="commerce-generating-row">
                    <i />
                    <i />
                </span>
            </span>
            <span className="commerce-generating-status">
                <b aria-hidden="true" />
                <span>{queued ? "排队中" : "正在生成"}</span>
                <em>{label}</em>
            </span>
        </span>
    );
}

/** Keyed by source in the gallery, so refresh and newly completed images have
 * their own load lifecycle without restarting generation or using fake progress. */
export function CommerceResultImage({ ratio, rotation = 0, frameRatio, ...props }: ImgHTMLAttributes<HTMLImageElement> & { ratio: number; rotation?: number; frameRatio?: number }) {
    const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
    const [naturalRatio, setNaturalRatio] = useState<number>();
    const quarterTurn = Math.abs(rotation % 180) === 90;
    const imageRatio = naturalRatio || ratio;
    const displayRatio = frameRatio || (quarterTurn ? 1 / imageRatio : imageRatio);
    return (
        <span className={`commerce-result-image-shell is-${state}`} style={{ aspectRatio: displayRatio }}>
            <img
                {...props}
                style={{ ...props.style, width: quarterTurn ? `${100 / displayRatio}%` : "100%", height: quarterTurn ? `${100 * displayRatio}%` : "100%", transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
                decoding="async"
                onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    if (naturalWidth > 0 && naturalHeight > 0) setNaturalRatio(naturalWidth / naturalHeight);
                    setState("loaded");
                    props.onLoad?.(event);
                }}
                onError={(event) => {
                    setState("failed");
                    props.onError?.(event);
                }}
            />
            {state !== "loaded" ? (
                <span className="commerce-image-loading" role="status">
                    {state === "failed" ? (
                        <span>
                            图片加载失败，请刷新重试
                            <br />
                            <small>已生成的作品仍然保留</small>
                        </span>
                    ) : (
                        <CommerceProgressArtwork title="正在载入作品" detail="高清图片加载后自动呈现" />
                    )}
                </span>
            ) : null}
        </span>
    );
}
