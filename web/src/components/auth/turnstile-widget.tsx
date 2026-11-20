import { useEffect, useRef, useState } from "react";

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
const TURNSTILE_LOAD_TIMEOUT_MS = 10000;

let scriptPromise: Promise<TurnstileWidget> | null = null;

function loadTurnstile(): Promise<TurnstileWidget> {
    if (typeof window === "undefined") return Promise.reject(new Error("Turnstile 只能在浏览器中加载"));
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<TurnstileWidget>((resolve, reject) => {
        const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
        const script = existing || document.createElement("script");
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            script.removeEventListener("load", onLoad);
            script.removeEventListener("error", onError);
            if (error) {
                // A failed script cannot emit another load event when reused.
                script.remove();
                reject(error);
            } else resolve(window.turnstile!);
        };
        const onLoad = () => {
            finish(window.turnstile ? undefined : new Error("安全验证加载失败，请重试"));
        };
        const onError = () => finish(new Error("安全验证加载失败，请检查网络后重试"));
        const timeout = window.setTimeout(() => finish(new Error("安全验证加载超时，请检查网络后重试")), TURNSTILE_LOAD_TIMEOUT_MS);
        script.addEventListener("load", onLoad, { once: true });
        script.addEventListener("error", onError, { once: true });
        if (!existing) {
            script.id = TURNSTILE_SCRIPT_ID;
            script.src = TURNSTILE_SCRIPT_SRC;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }
    }).finally(() => {
        scriptPromise = null;
    });
    return scriptPromise;
}

export function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string) => void; resetKey?: number }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIDRef = useRef<string | number | undefined>(undefined);
    const onTokenRef = useRef(onToken);
    const [error, setError] = useState("");
    const [retryKey, setRetryKey] = useState(0);
    onTokenRef.current = onToken;

    useEffect(() => {
        if (!siteKey || !containerRef.current) return;
        let disposed = false;
        const container = containerRef.current;
        const size = container.clientWidth < 300 ? "compact" : "flexible";
        container.replaceChildren();
        onTokenRef.current("");
        setError("");
        const resizeObserver = new window.ResizeObserver(() => {
            const width = container.clientWidth;
            if (disposed || width === 0 || (width < 300 ? "compact" : "flexible") === size) return;
            // Flexible widgets cannot shrink below 300px. Invalidate this instance
            // immediately so a late token cannot survive the size change.
            disposed = true;
            onTokenRef.current("");
            setRetryKey((value) => value + 1);
        });
        resizeObserver.observe(container);
        const fail = (message: string) => {
            if (disposed) return;
            onTokenRef.current("");
            setError(message);
        };
        void loadTurnstile()
            .then((turnstile) => {
                if (disposed || !containerRef.current) return;
                widgetIDRef.current = turnstile.render(container, {
                    sitekey: siteKey,
                    size,
                    callback: (token: string) => {
                        if (disposed) return;
                        setError("");
                        onTokenRef.current(token);
                    },
                    "expired-callback": () => fail("安全验证已过期，请重新验证"),
                    "error-callback": () => fail("安全验证失败，请重试"),
                    "timeout-callback": () => fail("安全验证超时，请重试"),
                });
            })
            .catch((cause) => fail(cause instanceof Error ? cause.message : "安全验证加载失败，请重试"));
        return () => {
            disposed = true;
            resizeObserver.disconnect();
            if (widgetIDRef.current !== undefined) {
                window.turnstile?.remove?.(widgetIDRef.current);
                widgetIDRef.current = undefined;
            }
            container.replaceChildren();
        };
    }, [siteKey, resetKey, retryKey]);

    if (!siteKey) return null;
    return (
        <div className="auth-turnstile-status">
            <div ref={containerRef} className="auth-turnstile" aria-label="Cloudflare Turnstile 人机验证" />
            {error ? (
                <div role="status">
                    {error}{" "}
                    <button type="button" className="auth-form-link" onClick={() => setRetryKey((value) => value + 1)}>
                        重新加载验证
                    </button>
                </div>
            ) : null}
        </div>
    );
}
