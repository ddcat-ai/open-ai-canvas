import { motion, useReducedMotion } from "motion/react";
import { Tabs } from "antd";
import { ArrowLeft, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore } from "@/stores/use-theme-store";

const AUTH_TABS = [
    { key: "login", label: "登录" },
    { key: "register", label: "注册" },
];

const authCopy = {
    login: {
        eyebrow: "WELCOME BACK",
        title: "进入创作现场",
        description: "继续编辑你的画布、素材与生成任务。",
    },
    register: {
        eyebrow: "CREATE ACCOUNT",
        title: "建立你的创作空间",
        description: "一个账号管理画布、素材、技能和模型偏好。",
    },
    recovery: {
        eyebrow: "ACCOUNT RECOVERY",
        title: "重新设置密码",
        description: "验证账号邮箱后，设置一个新的登录密码。",
    },
} as const;

export function LinuxDOIcon() {
    return (
        <span
            aria-hidden
            className="size-5 shrink-0 rounded-full"
            style={{
                background: "linear-gradient(to bottom, #1d1d1f 0 33.333%, #efefef 33.333% 66.666%, #feb005 66.666% 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,.14)",
            }}
        />
    );
}

export function WechatIcon({ className = "size-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M8.5 2C4.36 2 1 4.91 1 8.5c0 2.01 1.05 3.82 2.7 5.03l-.7 2.15c-.09.28.18.52.44.4l2.5-1.15c.81.3 1.67.47 2.56.47.2 0 .4 0 .6-.02-.3-.88-.47-1.83-.47-2.81 0-4.14 3.81-7.5 8.5-7.5.3 0 .59.02.88.05C16.82 4.14 13.01 2 8.5 2zm-2.25 4.5c.69 0 1.25.56 1.25 1.25S6.94 9 6.25 9 5 8.44 5 7.75s.56-1.25 1.25-1.25zm4.5 0c.69 0 1.25.56 1.25 1.25S11.44 9 10.75 9 9.5 8.44 9.5 7.75s.56-1.25 1.25-1.25zM15.5 10c-3.87 0-7 2.69-7 6s3.13 6 7 6c.74 0 1.45-.11 2.12-.32l1.97.9c.21.1.43-.09.36-.31l-.55-1.7c1.36-.96 2.1-2.39 2.1-3.57 0-3.31-3.13-6-7-6zm-2 3.5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm4 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z" />
        </svg>
    );
}

export function AuthScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const location = useLocation();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manualVideoActive, setManualVideoActive] = useState(false);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const recovery = location.pathname === "/forgot-password";
    const activeTab = location.pathname === "/register" ? "register" : "login";
    const copy = recovery ? authCopy.recovery : activeTab === "register" ? authCopy.register : authCopy.login;
    const automaticVideoActive = appearance.authVideoAutoplay && !reducedMotion;
    const videoActive = Boolean(appearance.authVideoUrl && (automaticVideoActive || manualVideoActive));

    useEffect(() => {
        setManualVideoActive(false);
        setVideoPlaying(false);
    }, [appearance.authVideoUrl, appearance.authVideoAutoplay]);

    const playVideo = () => {
        setManualVideoActive(true);
        requestAnimationFrame(() => {
            void videoRef.current?.play().catch(() => setVideoPlaying(false));
        });
    };

    return (
        <main className="auth-scene h-dvh min-h-0 overflow-y-auto lg:overflow-hidden">
            <div className="grid min-h-full lg:h-full lg:grid-cols-[minmax(0,1.32fr)_minmax(520px,1fr)]">
                <section className="auth-scene-hero relative min-h-[250px] overflow-hidden sm:min-h-[320px] lg:min-h-0" aria-label={`${appearance.brandName}品牌影片`}>
                    {videoActive && appearance.authVideoUrl ? <video ref={videoRef} className="absolute inset-0 size-full object-cover" src={appearance.authVideoUrl} poster={appearance.authVideoPosterUrl || undefined} autoPlay muted loop playsInline preload="metadata" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} /> : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? <img className="absolute inset-0 size-full object-cover" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} /> : null}
                    <div aria-hidden className="auth-scene-hero-overlay absolute inset-0" />
                    <div aria-hidden className="auth-scene-video-blend absolute inset-y-0 right-0 hidden w-[clamp(120px,14vw,240px)] lg:block" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 p-5 sm:p-7 lg:p-9">
                        <Link to="/" className="auth-scene-brand inline-flex items-center gap-2.5 text-sm font-semibold drop-shadow-sm transition-opacity hover:opacity-80">
                            <BrandLogo theme={theme} className="size-7" alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                            {appearance.brandName}
                        </Link>
                        <button type="button" className="auth-scene-hero-control inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[var(--fs-label)] backdrop-blur-xl transition disabled:cursor-default" onClick={playVideo} disabled={videoPlaying || !appearance.authVideoUrl} aria-pressed={videoPlaying}>
                            <Play className="size-3 fill-current" />
                            {videoPlaying ? "创作正在发生" : "播放品牌影片"}
                        </button>
                    </div>
                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="absolute inset-x-0 bottom-0 max-w-2xl p-5 sm:p-7 lg:p-10"
                    >
                        <p className="auth-scene-hero-muted text-xs font-semibold tracking-[0.18em]">{brandStudioLabel(appearance)}</p>
                        <h1 className="auth-scene-hero-title mt-3 max-w-xl whitespace-pre-line text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">{appearance.authHeroTitle}</h1>
                        {appearance.authHeroDescription ? <p className="auth-scene-hero-muted mt-4 max-w-xl whitespace-pre-line text-sm leading-6 sm:text-base sm:leading-7">{appearance.authHeroDescription}</p> : null}
                    </motion.div>
                </section>

                <section className="auth-scene-form-pane relative flex min-h-[660px] flex-col items-center overflow-y-auto px-4 pt-20 sm:px-8 lg:min-h-0 lg:px-10 lg:pt-20">
                    <Link to="/" className="auth-scene-return absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs backdrop-blur-xl transition lg:right-8 lg:top-8">
                        <ArrowLeft className="size-3.5" />
                        返回首页
                    </Link>

                    <div className="flex w-full flex-1 items-center justify-center">
                        <motion.div
                            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            layout={!reducedMotion}
                            transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                            className="my-auto w-full max-w-[460px]"
                        >
                            <div className="auth-scene-card h-auto overflow-hidden rounded-lg backdrop-blur-2xl">
                                <section aria-label={copy.title} className={`flex flex-col ${recovery ? "min-h-[600px]" : activeTab === "login" ? "" : "min-h-[620px] sm:min-h-[640px]"}`}>
                                    <header className="px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
                                        <p className="auth-scene-eyebrow text-xs font-semibold tracking-[0.18em]">{copy.eyebrow}</p>
                                        <h2 className="mt-2 text-3xl font-semibold">{copy.title}</h2>
                                        <p className="auth-scene-muted mt-2 text-sm leading-6">{copy.description}</p>
                                    </header>
                                    {!recovery ? (
                                        <div className="px-6 sm:px-8">
                                            <Tabs className="auth-card-tabs" activeKey={activeTab} items={AUTH_TABS} onChange={(key) => navigate({ pathname: key === "register" ? "/register" : "/login", search: location.search })} />
                                        </div>
                                    ) : null}
                                    <div key={location.pathname} className={`${!recovery && activeTab === "login" ? "" : "flex-1"} px-6 py-6 sm:px-8 sm:py-7`}>
                                        <Outlet />
                                    </div>
                                </section>
                            </div>
                        </motion.div>
                    </div>
                    <SiteComplianceFooter variant="auth" className="relative inset-auto w-full shrink-0" />
                </section>
            </div>
        </main>
    );
}
