import { useEffect, useState, type ReactNode } from "react";
import "./generation-image-preview.css";

/** Failed/expired temporary previews leave the original task progress visible. */
export function GenerationImagePreview({ src, alt, children, onPreview }: { src: string; alt: string; children: ReactNode; onPreview?: () => void }) {
    const [loaded, setLoaded] = useState("");
    const [failed, setFailed] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (failed !== src) return;
        const timer = setTimeout(() => {
            setAttempt((value) => value + 1);
            setFailed("");
        }, 2000);
        return () => clearTimeout(timer);
    }, [failed, src]);
    return (
        <div className="generation-image-preview" data-loaded={loaded === src || undefined}>
            {failed !== src ? (
                <img
                    src={attempt && src.startsWith("/api/tasks/") ? `${src}${src.includes("?") ? "&" : "?"}previewAttempt=${attempt}` : src}
                    alt={alt}
                    decoding="async"
                    onLoad={() => setLoaded(src)}
                    onError={() => {
                        setFailed(src);
                        setLoaded("");
                    }}
                />
            ) : null}
            {loaded !== src ? children : onPreview ? <button type="button" className="generation-image-preview-open" aria-label={`放大查看${alt}`} onClick={onPreview} /> : null}
        </div>
    );
}
