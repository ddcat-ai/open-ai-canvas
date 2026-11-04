import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, ConfigProvider, Tabs } from "antd";
import { ArrowDown, ArrowRight, ArrowUpRight, Code2, Menu, Pause, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/brand/brand-logo";
import { IconButton } from "@/components/ui/base/buttons";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useAppearanceStore } from "@/stores/use-appearance-store";

import { WelcomeContributorsCard } from "./contributors-card";
import { chapters, getWelcomeLook, showcases, welcomeLooks, type WelcomeLook } from "./story";
// 欢迎页是独立入口、不加载 globals.css；按钮 token 单独引入，antd 主题里的 var(--button-*) 才能解析。
import "@/styles/button-tokens.css";
import "./welcome.css";
import { Select } from "@/components/ui/base/select";

const StoryReel = lazy(() => import("./story-reel"));
const github = "https://github.com/ddcat-ai/open-ai-canvas";

export default function WelcomePage() {
    const [look, setLook] = useState(getWelcomeLook);
    const appearance = useAppearanceStore((state) => state.appearance);
    const restorePickerFocus = useRef(false);
    useEffect(() => {
        if (!restorePickerFocus.current) return;
        document.getElementById("welcome-look-select")?.focus({ preventScroll: true });
        restorePickerFocus.current = false;
    }, [look]);
    useEffect(() => {
        const onHistory = () => setLook(getWelcomeLook());
        window.addEventListener("popstate", onHistory);
        return () => window.removeEventListener("popstate", onHistory);
    }, []);
    const changeLook = (id: string) => {
        const next = welcomeLooks.find((item) => item.id === id);
        if (!next || next.id === look.id) return;
        const url = new URL(window.location.href);
        url.searchParams.set("look", id);
        window.history.pushState(null, "", url);
        restorePickerFocus.current = true;
        setLook(next);
    };
    return (
        <ConfigProvider theme={getAntThemeConfig(true, appearance.activeSkin)} button={{ autoInsertSpace: false }}>
            <WelcomeExperience key={look.id} look={look} brandName={appearance.brandName} onLookChange={changeLook} />
        </ConfigProvider>
    );
}

function WelcomeExperience({ look, brandName, onLookChange }: { look: WelcomeLook; brandName: string; onLookChange: (id: string) => void }) {
    const { t } = useTranslation();
    const storyRef = useRef<HTMLElement>(null);
    const progressRef = useRef(0);
    const [chapter, setChapter] = useState(0);
    const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [paused, setPaused] = useState(false);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    const [menu, setMenu] = useState(false);
    const [showcase, setShowcase] = useState(1);
    const [playing, setPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMotion = () => setReduced(media.matches);
        media.addEventListener("change", onMotion);
        const onScroll = () => {
            if (!storyRef.current) return;
            const rect = storyRef.current.getBoundingClientRect();
            const progress = Math.max(0, Math.min(1, -rect.top / (rect.height - window.innerHeight)));
            progressRef.current = progress;
            storyRef.current.style.setProperty("--story-progress", String(progress));
            setChapter(Math.min(5, Math.floor(progress * 6)));
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        onScroll();
        return () => {
            media.removeEventListener("change", onMotion);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, []);

    useEffect(() => {
        if (!playing) return;
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPlaying(false); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [playing]);

    const jumpTo = (index: number) => {
        if (!storyRef.current) return;
        const height = storyRef.current.offsetHeight - window.innerHeight;
        window.scrollTo({ top: storyRef.current.offsetTop + height * (index === 5 ? 0.97 : index / 6 + (index ? 0.04 : 0)), behavior: reduced ? "instant" : "smooth" });
        setMenu(false);
    };
    const staticScene = reduced || failed;
    const active = showcases[showcase];

    return (
        <div className="welcome-page">
            <a className="welcome-skip" href="#workbench">{t("account.welcome.skip")}</a>
            <header className="welcome-header">
                <a className="welcome-brand" href="/welcome" aria-label={t("shell.brandHome", { brand: brandName })}>
                    <BrandLogo theme="dark" className="welcome-brand-logo" alt="" fallback={<span className="welcome-brand-logo is-fallback" />} />
                    {brandName}
                </a>
                <nav className={menu ? "welcome-nav is-open" : "welcome-nav"} aria-label={t("account.welcome.nav")}>
                    <a href="#workbench" onClick={() => setMenu(false)}>{t("account.welcome.navWorkbench")}</a>
                    <a href="#contributors" onClick={() => setMenu(false)}>{t("account.welcome.navContributors")}</a>
                    <a href={github} target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={13} /></a>
                </nav>
                <Button className="welcome-header-cta" type="primary" href="/create" icon={<ArrowUpRight size={16} />} iconPlacement="end">{t("account.welcome.start")}</Button>
                <IconButton className="welcome-icon mobile-menu" variant="ghost" size="lg" icon={menu ? X : Menu} aria-label={menu ? t("account.welcome.closeMenu") : t("account.welcome.openMenu")} aria-expanded={menu} onClick={() => setMenu(!menu)} />
            </header>
            <aside className="welcome-look-picker" aria-label={t("account.welcome.lookPicker")}>
                <Select id="welcome-look-select" aria-label={t("account.welcome.look")} value={look.id} options={welcomeLooks.map((item) => ({ label: t(item.label), value: item.id }))} onChange={onLookChange} popupMatchSelectWidth={false} />
                {look.credit && <a href={`/welcome/credits.html#${look.id}`} target="_blank" rel="noreferrer" title={t(look.credit)}>{t("account.welcome.demoCredit")}<ArrowUpRight size={12} /></a>}
            </aside>

            <main>
                <section ref={storyRef} id="story" className="welcome-story" aria-label={t("account.welcome.storyLabel")}>
                    <div className={`welcome-stage chapter-${chapter}${staticScene ? " is-static" : ""}`}>
                        <div className={`welcome-poster${ready && !staticScene ? " is-ready" : ""}`} aria-hidden="true"><img src={look.frames[staticScene ? chapter * 2 : 0]} alt="" fetchPriority="high" /></div>
                        {!staticScene && <SceneBoundary onError={() => setFailed(true)}><Suspense fallback={null}><StoryReel look={look} progress={progressRef} paused={paused} onReady={() => setReady(true)} onError={() => setFailed(true)} /></Suspense></SceneBoundary>}
                        <div className="welcome-stage-shade" aria-hidden="true" />
                        {chapters.map((item, index) => (
                            <section key={item.id} className={`welcome-chapter ${index === 0 ? "welcome-opening" : ""} ${index === chapter ? "is-active" : ""}`} aria-hidden={index !== chapter}>
                                {index === 0 ? <h1>{item.title}</h1> : <h2>{t(item.title).split("，").map((part, partIndex, parts) => <span key={part}>{part}{partIndex < parts.length - 1 ? "，" : ""}</span>)}</h2>}
                                {"subtitle" in item && <><p className="welcome-subtitle">{t(item.subtitle)}</p>{look.video && <Button type="text" className="welcome-film-link" onClick={() => setPlaying(true)} tabIndex={chapter === 0 ? 0 : -1} icon={<span className="welcome-play-mark"><Play size={17} fill="currentColor" /></span>}>{t("account.welcome.watchClip")}</Button>}</>}
                            </section>
                        ))}
                        <div className="welcome-stage-bottom">
                            <IconButton className="welcome-next" variant="ghost" size="lg" icon={ArrowDown} aria-label={chapter === 5 ? t("account.welcome.enterStudio") : t("account.welcome.nextChapter")} onClick={() => chapter < 5 ? jumpTo(chapter + 1) : document.getElementById("workbench")?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" })} />
                            <nav className="welcome-chapter-nav" aria-label={t("account.welcome.chapterNav")}>{chapters.map((item, index) => <button key={item.id} className={chapter === index ? "is-current" : ""} aria-label={t(item.label)} title={t(item.label)} aria-current={chapter === index ? "step" : undefined} onClick={() => jumpTo(index)}><span /></button>)}</nav>
                            <IconButton className="welcome-icon" variant="ghost" icon={paused || staticScene ? Play : Pause} title={paused || staticScene ? t("account.welcome.play") : t("account.welcome.pause")} aria-label={paused || staticScene ? t("account.welcome.play") : t("account.welcome.pause")} aria-pressed={paused || staticScene} disabled={staticScene} onClick={() => setPaused(!paused)} />
                        </div>
                    </div>
                </section>

                <section id="workbench" className="welcome-workbench">
                    <div className="welcome-section-heading"><h2>{t("account.welcome.workbenchTitle")}</h2></div>
                    <div className="welcome-workbench-bar"><Tabs activeKey={String(showcase)} aria-label={t("account.welcome.workbenchPreview")} items={showcases.map((item, index) => ({ key: String(index), label: t(item.name) }))} onChange={(key) => setShowcase(Number(key))} /><Button type="link" href={active.href} icon={<ArrowUpRight size={16} />} iconPlacement="end">{t("account.welcome.enterShowcase", { name: t(active.name) })}</Button></div>
                    <div id="workbench-preview" role="tabpanel" className="welcome-workbench-preview"><img src={active.image} alt={t("account.welcome.showcaseAlt", { brand: brandName, name: t(active.name) })} loading="lazy" /></div>
                    <div className="welcome-workbench-caption"><p>{t(active.detail)}</p></div>
                </section>

                <section className="welcome-ending"><h2>{t("account.welcome.endingLine1")}<br />{t("account.welcome.endingLine2")}</h2>
                <WelcomeContributorsCard /></section>
            </main>
            <footer className="welcome-footer"><a href="/welcome">{brandName}</a><span>{t("account.welcome.footer")}</span><a href={`${github}/blob/main/LICENSE`} target="_blank" rel="noreferrer">Open Source · MIT License<ArrowUpRight size={12} /></a></footer>
            {look.credit && <div className="welcome-media-credit"><a href={`/welcome/credits.html#${look.id}`} target="_blank" rel="noreferrer">{t("account.welcome.creditLicense", { credit: t(look.credit) })}<ArrowUpRight size={12} /></a></div>}
            {playing && look.video && <FilmDialog look={look} onClose={() => setPlaying(false)} videoRef={videoRef} />}
        </div>
    );
}

function FilmDialog({ look, onClose, videoRef }: { look: WelcomeLook; onClose: () => void; videoRef: React.RefObject<HTMLVideoElement | null> }) {
    const { t } = useTranslation();
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
    return <dialog ref={dialogRef} className="welcome-film-dialog" aria-label={t("account.welcome.filmLabel", { title: t(look.title) })} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div><IconButton autoFocus className="welcome-icon" variant="ghost" size="lg" icon={X} aria-label={t("account.welcome.closeFilm")} onClick={onClose} /><video ref={videoRef} src={look.video} poster={look.frames[0]} controls autoPlay muted playsInline /><p>{t(look.credit ?? look.title)}</p></div></dialog>;
}

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { this.props.onError(); }
    render() { return this.state.failed ? null : this.props.children; }
}
