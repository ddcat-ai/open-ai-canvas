import { motion, useReducedMotion } from "motion/react";
import { ConfigProvider, Tabs } from "antd";
import { ArrowLeft, Play } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { getAntThemeConfig } from "@/lib/app-theme";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";

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

export function AuthScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const location = useLocation();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const [videoActive, setVideoActive] = useState(false);
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const recovery = location.pathname === "/forgot-password";
    const activeTab = location.pathname === "/register" ? "register" : "login";
    const copy = recovery ? authCopy.recovery : activeTab === "register" ? authCopy.register : authCopy.login;

    return (
        <main className="auth-scene h-dvh min-h-0 overflow-y-auto text-white lg:overflow-hidden">
            <div className="grid min-h-full lg:h-full lg:grid-cols-[minmax(0,1.32fr)_minmax(520px,1fr)]">
                <section className="relative min-h-[250px] overflow-hidden sm:min-h-[320px] lg:min-h-0" aria-label={`${appearance.brandName}品牌影片`}>
                    {videoActive && appearance.authVideoUrl ? <video className="absolute inset-0 size-full object-cover" src={appearance.authVideoUrl} poster={appearance.authVideoPosterUrl || undefined} autoPlay={!reducedMotion} muted loop playsInline preload="metadata" /> : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? <img className="absolute inset-0 size-full object-cover" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} /> : null}
                    <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,8,.58),transparent_42%,rgba(4,5,8,.74))]" />
                    <div aria-hidden className="auth-scene-video-blend absolute inset-y-0 right-0 hidden w-[clamp(120px,14vw,240px)] lg:block" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 p-5 sm:p-7 lg:p-9">
                        <Link to="/" className="inline-flex items-center gap-2.5 text-sm font-semibold text-white drop-shadow-sm transition-opacity hover:opacity-80">
                            <BrandLogo theme="dark" className="size-7" alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                            {appearance.brandName}
                        </Link>
                        <button type="button" className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-black/20 px-3 py-1.5 text-[var(--fs-label)] text-white/76 backdrop-blur-xl transition hover:bg-black/35 disabled:cursor-default" onClick={() => setVideoActive(true)} disabled={videoActive || !appearance.authVideoUrl} aria-pressed={videoActive}>
                            <Play className="size-3 fill-current" />
                            {videoActive ? "创作正在发生" : "播放品牌影片"}
                        </button>
                    </div>
                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="absolute inset-x-0 bottom-0 max-w-2xl p-5 sm:p-7 lg:p-10"
                    >
                        <p className="text-xs font-semibold tracking-[0.18em] text-white/58">{brandStudioLabel(appearance)}</p>
                        <h1 className="mt-3 max-w-xl whitespace-pre-line text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">{appearance.authHeroTitle}</h1>
                        {appearance.authHeroDescription ? <p className="mt-4 max-w-xl whitespace-pre-line text-sm leading-6 text-white/62 sm:text-base sm:leading-7">{appearance.authHeroDescription}</p> : null}
                    </motion.div>
                </section>

                <section className="auth-scene-form-pane relative flex min-h-[660px] items-start justify-center overflow-y-auto px-4 pb-24 pt-20 sm:px-8 lg:min-h-0 lg:px-10 lg:pb-24 lg:pt-20">
                    <Link to="/" className="auth-scene-return absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs backdrop-blur-xl transition lg:right-8 lg:top-8">
                        <ArrowLeft className="size-3.5" />
                        返回首页
                    </Link>

                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        layout={!reducedMotion}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="my-auto w-full max-w-[460px]"
                    >
                        <ConfigProvider theme={getAntThemeConfig(true, appearance.activeSkin)}>
                            <div className="auth-card-dark auth-scene-card h-auto overflow-hidden rounded-lg backdrop-blur-2xl">
                                <section aria-label={copy.title} className={`flex flex-col ${recovery ? "min-h-[600px]" : activeTab === "login" ? "min-h-[500px]" : "min-h-[620px] sm:min-h-[640px]"}`}>
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
                                    <div key={location.pathname} className="flex-1 px-6 py-6 sm:px-8 sm:py-7">
                                        <Outlet />
                                    </div>
                                </section>
                            </div>
                        </ConfigProvider>
                    </motion.div>
                    <SiteComplianceFooter variant="auth" className="absolute inset-x-0 bottom-0" />
                </section>
            </div>
        </main>
    );
}
