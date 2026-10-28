import { type FormEvent, useEffect, useState } from "react";
import { App, Button, Checkbox, Divider, Input } from "antd";
import { ArrowRight, Film, LockKeyhole, Sparkles, UserRound, Video } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { getAuthSession, login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { TopbarLanguageSwitcher, useI18n } from "@/supdance/plugins/i18n";
import { SocialLoginButtons } from "../plugins/social-auth/components/social-login-buttons";

export default function DarkLoginPage() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(true);

    const next = safeNext(params.get("next"));
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        if (hydrated && user) {
            navigate(next, { replace: true });
        }
    }, [hydrated, user, next, navigate]);

    useEffect(() => {
        const oauthError = params.get("oauth_error");
        if (oauthError) {
            message.error(decodeURIComponent(oauthError));
        }
    }, [message, params]);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!acceptedTerms) {
            message.warning("请先勾选并同意《服务协议》和《隐私政策》");
            return;
        }

        setSubmitting(true);
        try {
            await login({ username, password });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success(t("auth.login_success"));
            navigate(next, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.login_failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full bg-[#090b10] text-slate-100 flex flex-col justify-between overflow-x-hidden selection:bg-pink-500 selection:text-white">
            {/* Background Grid Pattern & Ambient Glow */}
            <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                    backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.15) 1px, transparent 0)`,
                    backgroundSize: "32px 32px",
                }}
            />
            <div className="pointer-events-none absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-pink-600/20 blur-[120px]" />
            <div className="pointer-events-none absolute top-1/2 right-10 h-80 w-80 rounded-full bg-purple-600/15 blur-[100px]" />

            {/* Top Navbar */}
            <header className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-12">
                <Link to="/" className="flex items-center gap-3 group">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-tr from-pink-600 to-purple-600 p-0.5 shadow-lg shadow-pink-500/20 transition-transform group-hover:scale-105">
                        <BrandLogo
                            className="size-full rounded-[10px]"
                            alt="SupDance"
                            fallback={<Sparkles className="size-5 text-white" />}
                        />
                    </div>
                    <div>
                        <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                            SupDance 影策
                            <span className="rounded-full bg-pink-500/20 px-2 py-0.5 text-[10px] font-semibold text-pink-400 border border-pink-500/30">
                                AI 影视引擎
                            </span>
                        </span>
                    </div>
                </Link>

                <div className="flex items-center gap-4">
                    <TopbarLanguageSwitcher />
                    <div className="h-4 w-px bg-white/10" />
                    <span className="text-xs text-slate-400 hidden sm:inline">还没有账号？</span>
                    <Link
                        to={`/register?next=${encodeURIComponent(next)}`}
                        className="rounded-lg border border-pink-500/40 bg-pink-500/10 px-3.5 py-1.5 text-xs font-medium text-pink-300 transition-colors hover:bg-pink-500/20 hover:text-white"
                    >
                        免费注册
                    </Link>
                </div>
            </header>

            {/* Main Stage */}
            <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center p-6 lg:flex-row lg:gap-16">
                {/* Left Brand Visual Showcase */}
                <div className="hidden flex-1 flex-col justify-center space-y-6 lg:flex">
                    <div className="inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-3.5 py-1 text-xs font-medium text-pink-300 backdrop-blur">
                        <Sparkles className="size-3.5" />
                        全新一代 AI 电影与短剧创作工作台
                    </div>

                    <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:leading-tight">
                        把无限想象力，
                        <br />
                        化作真实的
                        <span className="bg-gradient-to-r from-pink-400 via-rose-400 to-purple-400 bg-clip-text text-transparent">
                            光影世界
                        </span>
                    </h1>

                    <p className="max-w-md text-sm leading-relaxed text-slate-400">
                        从智能剧本拆解、高精角色分镜设计，到端到端视频生成与画布流编排，为独立创作者与影视团队提供工业级 AI 生产力。
                    </p>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur">
                            <Film className="size-5 text-pink-400 mb-1.5" />
                            <h4 className="text-xs font-semibold text-slate-200">全流程影视画布</h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">节点式多模型协同与分镜管理</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur">
                            <Video className="size-5 text-purple-400 mb-1.5" />
                            <h4 className="text-xs font-semibold text-slate-200">角色一致性保持</h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">跨镜头面容、服装与场景锁定</p>
                        </div>
                    </div>
                </div>

                {/* Right Login Card (Figure 1) */}
                <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121620]/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="mb-6 space-y-1">
                        <h2 className="text-2xl font-bold tracking-tight text-white">欢迎登录 SupDance</h2>
                        <p className="text-xs text-slate-400">登录您的创作者账号以继续创作</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-300">账号 / 邮箱</label>
                            <Input
                                size="large"
                                prefix={<UserRound className="size-4 text-slate-400" />}
                                placeholder="输入用户名或注册邮箱"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 hover:border-pink-500/50 focus:border-pink-500"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-slate-300">登录密码</label>
                                <Link
                                    to={`/forgot-password?next=${encodeURIComponent(next)}`}
                                    className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
                                >
                                    忘记密码？
                                </Link>
                            </div>
                            <Input.Password
                                size="large"
                                prefix={<LockKeyhole className="size-4 text-slate-400" />}
                                placeholder="输入密码"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 hover:border-pink-500/50 focus:border-pink-500"
                                required
                            />
                        </div>

                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            block
                            loading={submitting}
                            icon={<ArrowRight className="size-4" />}
                            iconPlacement="end"
                            className="h-11 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 font-medium text-white shadow-lg shadow-pink-600/30 hover:from-pink-500 hover:to-rose-500 border-none mt-2"
                        >
                            立即登录
                        </Button>
                    </form>

                    {/* Divider for Social Login */}
                    <Divider className="my-5 border-white/10 text-xs text-slate-500">
                        或使用第三方账号快捷登录
                    </Divider>

                    {/* Dynamic Social Login Grid */}
                    <SocialLoginButtons
                        variant="dark-card"
                        next={next}
                        acceptedTerms={acceptedTerms}
                        onRequireAcceptTerms={() => acceptedTerms}
                    />

                    {/* Terms Agreement Checkbox */}
                    <div className="mt-5 flex items-start gap-2 pt-2 border-t border-white/5">
                        <Checkbox
                            checked={acceptedTerms}
                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                            className="mt-0.5 text-xs text-slate-400"
                        >
                            <span className="text-[11px] text-slate-400">
                                我已阅读并同意
                                <a href="/terms" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline mx-0.5">
                                    《用户服务协议》
                                </a>
                                和
                                <a href="/privacy" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline mx-0.5">
                                    《隐私政策》
                                </a>
                            </span>
                        </Checkbox>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 py-4 text-center text-xs text-slate-500">
                <p>© {new Date().getFullYear()} SupDance 影策 · 工业级 AI 影视创作平台</p>
            </footer>
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
