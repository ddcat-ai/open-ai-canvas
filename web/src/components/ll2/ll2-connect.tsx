import { Check, ExternalLink, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ll2MaskedKey, useLL2Store } from "@/stores/use-ll2-store";

/** LL2 控制台：只在新标签页打开，创作页不跳走、不丢内容。 */
const CONSOLE_URL = "https://ll2.cn/console/token";

function openConsoleInNewTab() {
    window.open(CONSOLE_URL, "_blank", "noopener,noreferrer");
}

/**
 * 填 Key 表单：全站只挂载一份，由 LL2KeyDialog 承载。
 * 2026-11-18 用户口径：任何入口都调 openKeyDialog()，不要再把这份表单内嵌到页面里，
 * 否则「开始创作」+ 右上角「连接 LL2」会同时出现两个一模一样的输入框。
 */
function LL2KeyPanel() {
    const apiKey = useLL2Store((state) => state.apiKey);
    const connect = useLL2Store((state) => state.connect);
    const disconnect = useLL2Store((state) => state.disconnect);
    const close = useLL2Store((state) => state.closeKeyDialog);
    const [draft, setDraft] = useState(apiKey);
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState("");
    // 已连接时默认只看状态；点「更换 Key」才展开输入框，避免「已连接 + 一长串 Key + 两个按钮」堆在一起。
    const [editing, setEditing] = useState(!apiKey);

    const save = () => {
        const value = draft.trim();
        if (!value) {
            setError("把复制好的 Key 粘贴到这里就行");
            return;
        }
        setError("");
        // connect() 会自动关掉全局弹窗，不需要再调一次 close()。
        connect(value);
    };

    const startReplacing = () => {
        setDraft("");
        setVisible(false);
        setError("");
        setEditing(true);
    };

    const cancelReplacing = () => {
        setDraft("");
        setVisible(false);
        setError("");
        setEditing(false);
    };

    const showStatus = Boolean(apiKey) && !editing;

    return (
        <div className="ll2-key-panel">
            <div className="ll2-key-panel-head">
                <span className="ll2-key-panel-title">{showStatus ? "LL2 已连接" : "连接 LL2"}</span>
                <button type="button" className="ll2-key-dialog-close" onClick={close} aria-label="关闭填 Key 窗口">
                    <X className="size-4" aria-hidden />
                </button>
            </div>

            {showStatus ? (
                <>
                    <div className="ll2-key-status">
                        <span className="ll2-key-status-icon">
                            <Check className="size-4" aria-hidden />
                        </span>
                        <div className="ll2-key-status-text">
                            <strong>{ll2MaskedKey(apiKey)}</strong>
                            <small>Key 只保存在这台电脑。</small>
                        </div>
                    </div>
                    <div className="ll2-key-actions is-pair">
                        <button type="button" className="ll2-key-ghost" onClick={startReplacing}>
                            更换 Key
                        </button>
                        <button
                            type="button"
                            className="ll2-key-ghost is-danger"
                            onClick={() => {
                                disconnect();
                                startReplacing();
                            }}
                        >
                            断开
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="ll2-key-lead">粘贴 LL2 Key，只保存在这台电脑。</p>
                    <div className="ll2-key-input-row">
                        <input
                            id="ll2-api-key-input"
                            className="ll2-key-input"
                            aria-label="LL2 API Key"
                            type={visible ? "text" : "password"}
                            value={draft}
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                            placeholder="把 Key 粘贴在这里"
                            onChange={(event) => {
                                setDraft(event.target.value);
                                setError("");
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") save();
                            }}
                        />
                        <button type="button" className="ll2-key-eye" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏 Key" : "显示 Key"}>
                            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                    </div>
                    {error ? <p className="ll2-key-error" role="alert">{error}</p> : null}
                    <div className="ll2-key-actions is-pair">
                        <button type="button" className="ll2-key-primary" onClick={save}>
                            {apiKey ? "保存新 Key" : "保存并使用"}
                        </button>
                        {apiKey ? (
                            <button type="button" className="ll2-key-ghost" onClick={cancelReplacing}>
                                取消
                            </button>
                        ) : null}
                    </div>
                </>
            )}

            <div className="ll2-key-panel-foot">
                <button type="button" className="ll2-key-console" onClick={openConsoleInNewTab}>
                    去 LL2 控制台 <ExternalLink className="size-3" aria-hidden />
                </button>
                <div className="ll2-key-foot-right">
                    <Link to="/models" onClick={close}>价格</Link>
                </div>
            </div>
        </div>
    );
}

/**
 * 全局唯一的填 Key 弹窗，挂在 UserLayout 里。
 * 有关闭按钮、有「稍后再说」、支持 Esc 和点遮罩关闭；不挡住创作内容时也能随时收起。
 */
export function LL2KeyDialog() {
    const open = useLL2Store((state) => state.keyDialogOpen);
    const close = useLL2Store((state) => state.closeKeyDialog);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, close]);

    if (!open) return null;

    return (
        <div
            className="ll2-key-dialog-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <div className="ll2-key-dialog" role="dialog" aria-modal="true" aria-label="连接 LL2">
                <LL2KeyPanel />
            </div>
        </div>
    );
}

/** 侧栏 / 顶栏的连接状态入口：只负责打开那一个全局弹窗。 */
export function LL2ConnectBadge({ compact = false }: { compact?: boolean }) {
    const apiKey = useLL2Store((state) => state.apiKey);
    const openKeyDialog = useLL2Store((state) => state.openKeyDialog);
    const connected = Boolean(apiKey.trim());

    return (
        <button
            type="button"
            className={`ll2-connect-badge ${compact ? "is-compact" : ""} ${connected ? "is-connected" : ""}`}
            onClick={openKeyDialog}
            aria-label={connected ? "已连接 LL2，点击管理 Key" : "连接 LL2，填入 Key"}
        >
            <KeyRound className="size-4" aria-hidden />
            {!compact ? (
                <span>{connected ? "已连接 LL2" : "连接 LL2"}</span>
            ) : (
                <span className="hidden sm:inline">{connected ? "已连接" : "连接 LL2"}</span>
            )}
        </button>
    );
}

/** 创作台首次引导：只是一条可收起的横条，点「填入 Key」打开同一个全局弹窗。 */
export function LL2KeyNotice() {
    const apiKey = useLL2Store((state) => state.apiKey);
    const noticeDismissed = useLL2Store((state) => state.noticeDismissed);
    const dismissNotice = useLL2Store((state) => state.dismissNotice);
    const openKeyDialog = useLL2Store((state) => state.openKeyDialog);

    if (apiKey.trim() || noticeDismissed) return null;

    return (
        <div className="ll2-key-notice">
            <div className="ll2-key-notice-copy">
                <KeyRound className="size-4 shrink-0" aria-hidden />
                <span>不用注册账号，只要填一次 LL2 Key 就能出片</span>
            </div>
            <div className="ll2-key-notice-actions">
                <button type="button" className="ll2-key-primary is-small" onClick={openKeyDialog}>
                    填入 Key
                </button>
                <button type="button" className="ll2-key-notice-close" onClick={dismissNotice} aria-label="稍后再说">
                    <X className="size-4" aria-hidden />
                </button>
            </div>
        </div>
    );
}
