import { ArrowRight, ServerCog, X } from "lucide-react";
import { useState } from "react";

const DISMISS_KEY = "open_ai_canvas:agent-model-source-hint";

/** 与 `navigateToSettings` 同一条机制：有路由出口就交给上层导航，否则整页跳转。 */
function openAdminChannels() {
    const event = new CustomEvent<{ to: string }>("workspace:navigate", { detail: { to: "/admin/channels" }, cancelable: true });
    if (window.dispatchEvent(event)) window.location.assign("/admin/channels");
}
/**
 * 画布智能体在后端进程里执行，只能用后端受管的文本模型渠道，浏览器本地的个人渠道拿不到密钥也拿不到上游。
 * 所以在没配到受管渠道时，除了发送前的拦截，输入区上方还要长期给一条引导，而不是等报错才告诉用户。
 */
export function AgentModelSourceHint({ isAdmin }: { isAdmin: boolean }) {
    const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1");
    if (dismissed) return null;

    const close = () => {
        window.sessionStorage.setItem(DISMISS_KEY, "1");
        setDismissed(true);
    };

    return (
        <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-xs">
            <ServerCog className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground/85">画布智能体需要后端受管的文本模型渠道</p>
                <p className="mt-0.5 leading-5 text-foreground/55">
                    {isAdmin
                        ? "它在后端进程里执行，只认后台受管的渠道模型。请在「后台管理 → 模型渠道」编辑该文本模型，到「积分定价」开启价格档的「可供用户使用」（单价 0 即免费）并保存，再回来选择该模型。"
                        : "它在后端进程里执行，只认管理员在后台配置的模型渠道；浏览器本地保存的个人渠道密钥不会提交给它。"}
                </p>
                {isAdmin ? (
                    <button type="button" className="mt-1.5 inline-flex items-center gap-1 font-semibold text-foreground/80 transition hover:text-foreground" onClick={openAdminChannels}>
                        去开启价格档 <ArrowRight className="size-3" />
                    </button>
                ) : (
                    <span className="mt-1.5 block font-semibold text-foreground/80">请联系管理员配置后再回来选择该模型。</span>
                )}
            </div>
            <button type="button" className="grid size-6 shrink-0 place-items-center rounded-full text-foreground/40 transition hover:bg-muted hover:text-foreground" onClick={close} aria-label="关闭模型来源引导">
                <X className="size-3" />
            </button>
        </div>
    );
}
