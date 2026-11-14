import { useEffect, useRef } from "react";

type TurnstileWidget = {
    render: (container: HTMLElement, options: Record<string, unknown>) => string | number;
    reset: (widgetId?: string | number) => void;
    remove?: (widgetId: string | number) => void;
};

declare global {
    interface Window {
        turnstile?: TurnstileWidget;
    }
}

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-api";
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<TurnstileWidget> | null = null;

function loadTurnstile(): Promise<TurnstileWidget> {
    if (typeof window === "undefined") return Promise.reject(new Error("Turnstile 只能在浏览器中加载"));
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<TurnstileWidget>((resolve, reject) => {
        const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
        const script = existing || document.createElement("script");
        const onLoad = () => {
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error("Turnstile 脚本未提供验证组件"));
        };
        const onError = () => reject(new Error("Turnstile 脚本加载失败，请检查网络后重试"));
        script.addEventListener("load", onLoad, { once: true });
        script.addEventListener("error", onError, { once: true });
        if (!existing) {
            script.id = TURNSTILE_SCRIPT_ID;
            script.src = TURNSTILE_SCRIPT_SRC;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }
    }).catch((error) => {
        scriptPromise = null;
        throw error;
    });
    return scriptPromise;
}

export function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string) => void; resetKey?: number }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIDRef = useRef<string | number | undefined>(undefined);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useEffect(() => {
        if (!siteKey || !containerRef.current) return;
        let disposed = false;
        const container = containerRef.current;
        container.replaceChildren();
        onTokenRef.current("");
        void loadTurnstile()
            .then((turnstile) => {
                if (disposed || !containerRef.current) return;
                widgetIDRef.current = turnstile.render(container, {
                    sitekey: siteKey,
                    callback: (token: string) => onTokenRef.current(token),
                    "expired-callback": () => onTokenRef.current(""),
                    "error-callback": () => onTokenRef.current(""),
                });
            })
            .catch(() => {
                if (!disposed) onTokenRef.current("");
            });
        return () => {
            disposed = true;
            if (widgetIDRef.current !== undefined) {
                window.turnstile?.remove?.(widgetIDRef.current);
                widgetIDRef.current = undefined;
            }
            container.replaceChildren();
        };
    }, [siteKey, resetKey]);

    if (!siteKey) return null;
    return <div ref={containerRef} className="auth-turnstile" aria-label="Cloudflare Turnstile 人机验证" />;
}
