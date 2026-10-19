import { useEffect, useState, useCallback } from "react";
import { spriteImageCache, type SpriteImageKind } from "@/services/sprite-image-cache";
import { useUserStore } from "@/stores/use-user-store";

useUserStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) spriteImageCache.clear();
});

export function useSpriteImage(url: string, kind: SpriteImageKind = "atlas", decodedBytes?: number) {
    const scope = useUserStore((state) => state.user?.id ?? "anonymous");
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState({ key: "", src: "", error: "" });
    const key = `${scope}:${url}:${attempt}`;
    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    useEffect(() => {
        if (!url) return;
        let disposed = false;
        const image = spriteImageCache.acquire(url, scope, kind, decodedBytes);
        image.promise.then(
            (src) => {
                if (!disposed) setResult({ key, src, error: "" });
            },
            (cause) => {
                if (!disposed) setResult({ key, src: "", error: cause instanceof Error ? cause.message : "形象加载失败" });
            },
        );
        return () => {
            disposed = true;
            image.release();
        };
    }, [url, scope, key, kind, decodedBytes]);
    return { ...(result.key === key ? result : { src: "", error: "" }), retry };
}
