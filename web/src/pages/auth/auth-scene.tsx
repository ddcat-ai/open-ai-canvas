import { motion, useReducedMotion } from "motion/react";
import { App } from "antd";
import { ArrowLeft, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { LanguageMenu } from "@/components/layout/language-menu";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useAuthLoginMode } from "@/hooks/use-auth-entry";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { authDialogLanding, authViewFromPath, rememberReferralCode, safeAuthNext } from "@/lib/auth-entry";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * /login、/register、/forgot-password 的路由外壳。后台选择弹窗模式时，
 * 直达这些地址（推广链接、Linux.do 回跳、书签）会改为在页面上打开登录弹窗。
 */
export function AuthScene() {
    const mode = useAuthLoginMode();
    const [params] = useSearchParams();
    if (mode === null) return <FullScreenLoader />;
    if (params.get("wechat_register") === "1") return <AuthPageScene />;
    if (mode === "modal") return <AuthDialogRedirect />;
    return <AuthPageScene />;
}

function AuthDialogRedirect() {
    const location = useLocation();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const signedIn = useUserStore((state) => Boolean(state.user));
    const next = safeAuthNext(params.get("next"));
    const handled = useRef(false);

    useEffect(() => {
        if (handled.current || signedIn) return;
        handled.current = true;
        rememberReferralCode(params.get("ref"));
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
        useAuthDialogStore.getState().openDialog(authViewFromPath(location.pathname) ?? "login", next);
    }, [location.pathname, message, next, params, signedIn]);

    return <Navigate to={signedIn ? next : authDialogLanding(next)} replace />;
}

function AuthPageScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const reducedMotion = useReducedMotion();
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manualVideoActive, setManualVideoActive] = useState(false);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [failedPosterURL, setFailedPosterURL] = useState("");
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
                <section className="auth-scene-hero relative min-h-[250px] overflow-hidden sm:min-h-[320px] lg:min-h-0" aria-label={t("auth.brandFilm", { brand: appearance.brandName })}>
                    {videoActive && appearance.authVideoUrl ? (
                        <video
                            ref={videoRef}
                            className="absolute inset-0 size-full object-cover"
                            src={appearance.authVideoUrl}
                            poster={appearance.authVideoPosterUrl || undefined}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onPlay={() => setVideoPlaying(true)}
                            onPause={() => setVideoPlaying(false)}
                        />
                    ) : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? (
                        <img className="absolute inset-0 size-full object-cover" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} />
                    ) : null}
                    <div aria-hidden className="auth-scene-hero-overlay absolute inset-0" />
                    <div aria-hidden className="auth-scene-video-blend absolute inset-y-0 right-0 hidden w-[clamp(120px,14vw,240px)] lg:block" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 p-5 sm:p-7 lg:p-9">
                        <Link to="/" className="auth-scene-brand inline-flex items-center gap-2 text-sm font-semibold drop-shadow-sm transition-opacity hover:opacity-80">
                            <BrandLogo theme={theme} className="size-7" alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                            {appearance.brandName}
                        </Link>
                        <button
                            type="button"
                            className="auth-scene-hero-control inline-flex items-center gap-2 rounded-full px-3 py-2 text-[var(--fs-label)] backdrop-blur-xl transition disabled:cursor-default"
                            onClick={playVideo}
                            disabled={videoPlaying || !appearance.authVideoUrl}
                            aria-pressed={videoPlaying}
                        >
                            <Play className="size-3 fill-current" />
                            {videoPlaying ? t("auth.videoPlaying") : t("auth.playVideo")}
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
                    <div className="absolute right-5 top-5 z-20 flex items-center gap-2 lg:right-8 lg:top-8">
                        <LanguageMenu variant="auth" />
                        <Link to="/" className="auth-scene-return inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs backdrop-blur-xl transition">
                            <ArrowLeft className="size-3.5" />
                            {t("auth.backHome")}
                        </Link>
                    </div>

                    <div className="flex w-full flex-1 items-center justify-center">
                        <motion.div
                            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            layout={!reducedMotion}
                            transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                            className="my-auto w-full max-w-[460px] py-6"
                        >
                            <Outlet />
                        </motion.div>
                    </div>
                    <SiteComplianceFooter variant="auth" className="relative inset-auto w-full shrink-0" />
                </section>
            </div>
        </main>
    );
}
