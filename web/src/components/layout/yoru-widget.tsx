import { ArrowRight, EyeOff, MessageCircleMore, MoveDiagonal2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { getPublicYoru, sendYoruMessage, type YoruMessage, type YoruSettings } from "@/services/api/yoru";
import { useUserStore } from "@/stores/use-user-store";
import { yoruBody, yoruBlink, yoruTail } from "@/assets/yoru";
import { YORU_CHEER_EVENT } from "@/lib/yoru-events";
import "./yoru-widget.css";

// Only routes present in web/src/router.tsx may be used as assistant actions.
const links = [
    ["图片生成", "/toolbox/image"],
    ["视频生成", "/toolbox/video"],
    ["灵感大厅", "/create"],
    ["自由画布", "/canvas"],
    ["Agent", "/canvas"],
    ["技能", "/skills"],
    ["资产库", "/assets"],
    ["创作历史", "/tasks"],
    ["积分中心", "/wallet"],
] as const;

const idleSettings: YoruSettings = { enabled: false, audience: "admin", name: "小夜", welcome: "你好呀，我是小夜。", questions: [], navigation: [], motionEnabled: true, avatarSize: 180, defaultRight: 16, defaultBottom: 24, saveHistory: false };
type Expression = "idle" | "thinking" | "talking" | "happy" | "curious" | "wave";

export function YoruWidget() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const siteAssistantEnabled = useUserStore((state) => state.features.siteAssistantEnabled);
    const userId = useUserStore((state) => state.user?.id || "guest");
    const preferenceKey = `yoru:${userId}`;
    const [settings, setSettings] = useState<YoruSettings>(idleSettings);
    const [open, setOpen] = useState(false);
    const [hidden, setHidden] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem(`${preferenceKey}:hidden`) === "1");
    const [ready, setReady] = useState(false);
    const [assetLoaded, setAssetLoaded] = useState(false);
    const [assetFailed, setAssetFailed] = useState(false);
    const [paused, setPaused] = useState(() => typeof document !== "undefined" && document.hidden);
    const [compactMotion, setCompactMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px), (prefers-reduced-motion: reduce)").matches);
    const [expression, setExpression] = useState<Expression>("idle");
    const [messages, setMessages] = useState<YoruMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [panelSize, setPanelSize] = useState<{ width: number; height: number }>(() => {
        try {
            return JSON.parse(localStorage.getItem(`${preferenceKey}:panel-size`) || "null") || { width: 420, height: 540 };
        } catch {
            return { width: 420, height: 540 };
        }
    });
    const [position, setPosition] = useState<{ right: number; bottom: number }>(() => {
        try {
            return JSON.parse(localStorage.getItem(`${preferenceKey}:position`) || "null") || { right: 16, bottom: 24 };
        } catch {
            return { right: 16, bottom: 24 };
        }
    });
    const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean; next?: { right: number; bottom: number } } | null>(null);
    const panelDrag = useRef<{ x: number; y: number; width: number; height: number; next?: { width: number; height: number } } | null>(null);
    const abort = useRef<AbortController | null>(null);
    const end = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        void getPublicYoru()
            .then((value) => {
                if (alive) {
                    setSettings(value);
                    if (!localStorage.getItem(`${preferenceKey}:position`)) setPosition({ right: value.defaultRight ?? 16, bottom: value.defaultBottom ?? 24 });
                }
            })
            .catch(() => {});
        const schedule = window.requestIdleCallback?.(() => setReady(true), { timeout: 1800 }) ?? window.setTimeout(() => setReady(true), 900);
        return () => {
            alive = false;
            if (window.cancelIdleCallback && typeof schedule === "number") window.cancelIdleCallback(schedule);
            else clearTimeout(schedule);
        };
    }, [preferenceKey]);
    useEffect(() => {
        abort.current?.abort();
        setMessages([]);
        setDraft("");
        setError("");
        setOpen(false);
        setBusy(false);
        setExpression("idle");
        setHidden(localStorage.getItem(`${preferenceKey}:hidden`) === "1");
        try {
            setPanelSize(JSON.parse(localStorage.getItem(`${preferenceKey}:panel-size`) || "null") || { width: 420, height: 540 });
        } catch {
            setPanelSize({ width: 420, height: 540 });
        }
        try {
            setPosition(JSON.parse(localStorage.getItem(`${preferenceKey}:position`) || "null") || { right: settings.defaultRight ?? 16, bottom: settings.defaultBottom ?? 24 });
        } catch {
            setPosition({ right: settings.defaultRight ?? 16, bottom: settings.defaultBottom ?? 24 });
        }
    }, [preferenceKey]);
    useEffect(() => {
        const update = () => setPaused(document.hidden);
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 640px), (prefers-reduced-motion: reduce)");
        const update = () => setCompactMotion(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }, [messages, busy, open]);
    useEffect(() => () => abort.current?.abort(), []);
    // 用户在创作页发送提示词时，小夜跳一下表示收到（复用已有的 happy 表情）。
    useEffect(() => {
        let timer = 0;
        const cheer = () => {
            setExpression((current) => (current === "thinking" || current === "talking" ? current : "happy"));
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setExpression((current) => (current === "happy" ? "idle" : current)), 1400);
        };
        window.addEventListener(YORU_CHEER_EVENT, cheer);
        return () => {
            window.removeEventListener(YORU_CHEER_EVENT, cheer);
            window.clearTimeout(timer);
        };
    }, []);
    useEffect(() => {
        if (paused || compactMotion || !settings.motionEnabled || open) return;
        const interval = window.setInterval(() => {
            setExpression((current) => (current === "idle" ? "curious" : current));
            window.setTimeout(() => setExpression((current) => (current === "curious" ? "idle" : current)), 1350);
        }, 9200);
        return () => window.clearInterval(interval);
    }, [paused, compactMotion, settings.motionEnabled, open]);

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, right: position.right, bottom: position.bottom, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) < 6 && !start.moved) return;
        start.moved = true;
        start.next = { right: Math.max(8, Math.min(window.innerWidth - 80, start.right - dx)), bottom: Math.max(8, Math.min(window.innerHeight - 80, start.bottom - dy)) };
        setPosition(start.next);
    };
    const onPointerUp = () => {
        if (drag.current?.moved && drag.current.next) localStorage.setItem(`${preferenceKey}:position`, JSON.stringify(drag.current.next));
        else {
            setOpen((value) => !value);
            setExpression("happy");
            window.setTimeout(() => setExpression((current) => (current === "happy" ? "idle" : current)), 1050);
        }
        drag.current = null;
    };
    const onPanelResizeStart = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        panelDrag.current = { x: event.clientX, y: event.clientY, width: panelSize.width, height: panelSize.height };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    };
    const onPanelResizeMove = (event: PointerEvent<HTMLButtonElement>) => {
        const start = panelDrag.current;
        if (!start) return;
        const availableWidth = Math.max(300, Math.min(680, window.innerWidth - (settings.avatarSize || 180) * 0.67 - position.right - 28));
        const availableHeight = Math.max(280, window.innerHeight - position.bottom - 20);
        start.next = {
            width: Math.round(Math.max(Math.min(340, availableWidth), Math.min(availableWidth, start.width + start.x - event.clientX))),
            height: Math.round(Math.max(Math.min(360, availableHeight), Math.min(availableHeight, start.height + start.y - event.clientY))),
        };
        setPanelSize(start.next);
    };
    const onPanelResizeEnd = () => {
        if (panelDrag.current?.next) localStorage.setItem(`${preferenceKey}:panel-size`, JSON.stringify(panelDrag.current.next));
        panelDrag.current = null;
    };

    const submit = async (text = draft) => {
        const message = text.trim();
        if (!message || busy) return;
        if (userId === "guest") {
            setError("请先登录，再使用小夜的 AI 对话。");
            return;
        }
        if (!settings.enabled) {
            setError("小夜的 AI 对话尚未由管理员启用。");
            return;
        }
        const prior = messages.filter((item) => item.content).slice(-12);
        setMessages((items) => [...items, { role: "user", content: message }, { role: "assistant", content: "" }]);
        setDraft("");
        setError("");
        setBusy(true);
        setExpression("thinking");
        const controller = new AbortController();
        abort.current = controller;
        try {
            const answer = await sendYoruMessage(
                { message, history: prior, page: pathname },
                (content) => {
                    if (controller.signal.aborted) return;
                    setExpression("talking");
                    setMessages((items) => items.map((item, index) => (index === items.length - 1 ? { ...item, content } : item)));
                },
                controller.signal,
            );
            if (controller.signal.aborted) return;
            setMessages((items) => items.map((item, index) => (index === items.length - 1 ? { ...item, content: answer || "小夜暂时没有收到文字回复。" } : item)));
            setExpression("happy");
            window.setTimeout(() => setExpression((current) => (current === "happy" ? "idle" : current)), 1200);
        } catch (cause) {
            if (controller.signal.aborted) return;
            setMessages((items) => items.slice(0, -1));
            setError(cause instanceof Error ? cause.message : "发送失败，请稍后重试");
            setDraft(message);
            setExpression("idle");
        } finally {
            if (abort.current === controller) {
                setBusy(false);
                abort.current = null;
            }
        }
    };

    if (!siteAssistantEnabled || !settings.enabled || pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname)) return null;
    if (hidden)
        return (
            <button
                className="yoru-restore"
                type="button"
                onClick={() => {
                    setHidden(false);
                    localStorage.removeItem(`${preferenceKey}:hidden`);
                }}
                aria-label={`显示${settings.name || "创作助手"}`}
            >
                <MessageCircleMore size={19} />
                <span>{settings.name || "创作助手"}</span>
            </button>
        );
    return (
        <div
            className={`yoru-root yoru-${expression}${open ? " is-open" : ""}${paused || !settings.motionEnabled ? " yoru-still" : ""}`}
            style={{
                right: position.right,
                bottom: position.bottom,
                ["--yoru-size" as string]: `${settings.avatarSize || 180}px`,
                ["--yoru-width" as string]: `${Math.round((settings.avatarSize || 180) * 0.67)}px`,
                ["--yoru-right" as string]: `${position.right}px`,
                ["--yoru-bottom" as string]: `${position.bottom}px`,
                ["--yoru-panel-width" as string]: `${panelSize.width}px`,
                ["--yoru-panel-height" as string]: `${panelSize.height}px`,
            }}
        >
            {open && (
                <section className="yoru-panel" role="dialog" aria-label="小夜 AI 助手">
                    <button
                        type="button"
                        className="yoru-resize"
                        aria-label="拖动调整聊天窗口大小"
                        title="拖动调整窗口大小，双击恢复默认"
                        onPointerDown={onPanelResizeStart}
                        onPointerMove={onPanelResizeMove}
                        onPointerUp={onPanelResizeEnd}
                        onPointerCancel={onPanelResizeEnd}
                        onDoubleClick={() => {
                            setPanelSize({ width: 420, height: 540 });
                            localStorage.removeItem(`${preferenceKey}:panel-size`);
                        }}
                    >
                        <MoveDiagonal2 size={14} aria-hidden="true" />
                    </button>
                    <header className="yoru-header">
                        <div className="yoru-header-portrait">
                            <img src={yoruBody} alt="小夜头像" />
                        </div>
                        <div className="yoru-header-identity">
                            <strong>{settings.name || "创作助手"}</strong>
                            <small>创作向导</small>
                        </div>
                        <span className="yoru-header-status">创作陪伴中</span>
                        <button type="button" className="yoru-icon-button" onClick={() => setOpen(false)} aria-label="关闭对话">
                            <X size={18} />
                        </button>
                    </header>
                    <div className="yoru-conversation" aria-live="polite">
                        <div className="yoru-welcome">
                            <span className="yoru-badge">✦ 你好，创作者</span>
                            <p>{settings.welcome}</p>
                        </div>
                        {messages.map((item, index) => (
                            <div key={index} className={`yoru-bubble ${item.role}`}>
                                {item.content || <span className="yoru-typing">● ● ●</span>}
                            </div>
                        ))}
                        <div ref={end} />
                    </div>
                    {messages.length === 0 && (
                        <div className="yoru-suggestions">
                            {settings.questions?.map((question) => (
                                <button type="button" key={question} onClick={() => void submit(question)}>
                                    {question}
                                    <ArrowRight size={13} />
                                </button>
                            ))}
                        </div>
                    )}
                    <nav className="yoru-links" aria-label="快捷入口">
                        <span className="yoru-links-label">快捷前往</span>
                        {links
                            .filter(([name]) => settings.navigation?.includes(name))
                            .map(([name, path]) => (
                                <button
                                    type="button"
                                    key={name}
                                    onClick={() => {
                                        navigate(path);
                                        setOpen(false);
                                    }}
                                >
                                    {name}
                                </button>
                            ))}
                    </nav>
                    {error && (
                        <div className="yoru-error" role="alert">
                            {error}
                            <button type="button" onClick={() => void submit()}>
                                重试 <RotateCcw size={13} />
                            </button>
                        </div>
                    )}
                    <form
                        className="yoru-compose"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        <input aria-label="发送给小夜" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={settings.enabled ? "问问小夜如何创作…" : "管理员启用后可对话"} maxLength={2000} disabled={busy} />
                        <button type="submit" disabled={!draft.trim() || busy} aria-label="发送消息">
                            <Send size={17} />
                        </button>
                    </form>
                    <footer className="yoru-footer">
                        <span>回答仅作站内操作指引，模型调用沿用积分计费</span>
                        <button
                            type="button"
                            onClick={() => {
                                setMessages([]);
                                setError("");
                            }}
                            aria-label="清空对话"
                        >
                            清空
                        </button>
                    </footer>
                </section>
            )}
            <button
                type="button"
                className="yoru-hide"
                aria-label="隐藏小夜"
                onClick={() => {
                    setHidden(true);
                    setOpen(false);
                    localStorage.setItem(`${preferenceKey}:hidden`, "1");
                }}
            >
                <EyeOff size={15} />
            </button>
            <button
                type="button"
                className="yoru-avatar"
                aria-label={open ? "收起小夜对话" : "打开小夜对话"}
                onPointerEnter={() => setExpression((current) => (current === "idle" || current === "curious" ? "wave" : current))}
                onPointerLeave={() => setExpression((current) => (current === "wave" ? "idle" : current))}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    drag.current = null;
                }}
            >
                {ready && !assetFailed ? (
                    <>
                        <span className={`yoru-art${assetLoaded ? " is-loaded" : ""}`} aria-hidden="true">
                            {!compactMotion && <img className="yoru-tail" src={yoruTail} alt="" loading="lazy" />}
                            <img className="yoru-body" src={yoruBody} alt="" loading="lazy" onLoad={() => setAssetLoaded(true)} onError={() => setAssetFailed(true)} />
                            {!compactMotion && <img className="yoru-blink" src={yoruBlink} alt="" loading="lazy" />}
                        </span>
                        {!assetLoaded && (
                            <span className="yoru-fallback" aria-hidden="true">
                                <Sparkles size={30} />
                            </span>
                        )}
                    </>
                ) : (
                    <span className="yoru-fallback" aria-hidden="true">
                        <Sparkles size={30} />
                    </span>
                )}
            </button>
        </div>
    );
}
