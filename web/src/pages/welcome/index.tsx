import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Code2, Menu, Pause, Play, X } from "lucide-react";
import { chapters, getWelcomeLook, showcases, welcomeLooks, type WelcomeLook } from "./story";
import "./welcome.css";

const StoryReel = lazy(() => import("./story-reel"));
const github = "https://github.com/ddcat-ai/open-ai-canvas";

export default function WelcomePage() {
    const [look, setLook] = useState(getWelcomeLook);
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
    return <WelcomeExperience key={look.id} look={look} onLookChange={changeLook} />;
}

function WelcomeExperience({ look, onLookChange }: { look: WelcomeLook; onLookChange: (id: string) => void }) {
    const storyRef = useRef<HTMLElement>(null);
    const progressRef = useRef(0);
    const [chapter, setChapter] = useState(0);
    const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [paused, setPaused] = useState(false);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    const [menu, setMenu] = useState(false);
    const [showcase, setShowcase] = useState(0);
    const [playing, setPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        document.title = "影策 · 让一个故事从文字走向银幕";
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
            <a className="welcome-skip" href="#workbench">前往工作台介绍</a>
            <header className="welcome-header">
                <a className="welcome-brand" href="/welcome" aria-label="影策首页"><img src="/logo.svg" alt="" />影策</a>
                <nav className={menu ? "welcome-nav is-open" : "welcome-nav"} aria-label="首页导航">
                    <a href="#workbench" onClick={() => setMenu(false)}>工作台</a>
                    <a href={github} target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={13} /></a>
                </nav>
                <a className="welcome-header-cta" href="/create">开始创作<ArrowUpRight size={16} /></a>
                <button className="welcome-icon mobile-menu" aria-label={menu ? "关闭菜单" : "打开菜单"} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
            </header>
            <aside className="welcome-look-picker" aria-label="首页素材版本">
                <select id="welcome-look-select" aria-label="素材版本" value={look.id} onChange={(event) => onLookChange(event.target.value)}>
                    {welcomeLooks.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                {look.credit && <a href={`/welcome/credits.html#${look.id}`} target="_blank" rel="noreferrer" title={look.credit}>演示素材 · CC BY<ArrowUpRight size={12} /></a>}
            </aside>

            <main>
                <section ref={storyRef} id="story" className="welcome-story" aria-label="影策创作之旅">
                    <div className={`welcome-stage chapter-${chapter}${staticScene ? " is-static" : ""}`}>
                        <div className={`welcome-poster${ready && !staticScene ? " is-ready" : ""}`} aria-hidden="true"><img src={look.frames[staticScene ? chapter * 2 : 0]} alt="" fetchPriority="high" /></div>
                        {!staticScene && <SceneBoundary onError={() => setFailed(true)}><Suspense fallback={null}><StoryReel look={look} progress={progressRef} paused={paused} onReady={() => setReady(true)} onError={() => setFailed(true)} /></Suspense></SceneBoundary>}
                        <div className="welcome-stage-shade" aria-hidden="true" />
                        {chapters.map((item, index) => (
                            <section key={item.id} className={`welcome-chapter ${index === 0 ? "welcome-opening" : ""} ${index === chapter ? "is-active" : ""}`} aria-hidden={index !== chapter}>
                                {index === 0 ? <h1>{item.title}</h1> : <h2>{item.title.split("，").map((part, partIndex, parts) => <span key={part}>{part}{partIndex < parts.length - 1 ? "，" : ""}</span>)}</h2>}
                                {"subtitle" in item && <><p className="welcome-subtitle">{item.subtitle}</p>{look.video && <button className="welcome-film-link" onClick={() => setPlaying(true)} tabIndex={chapter === 0 ? 0 : -1}><span className="welcome-play-mark"><Play size={17} fill="currentColor" /></span><span>观看片段</span></button>}</>}
                            </section>
                        ))}
                        <div className="welcome-stage-bottom">
                            <button className="welcome-next" aria-label={chapter === 5 ? "进入创作现场" : "下一幕"} onClick={() => chapter < 5 ? jumpTo(chapter + 1) : document.getElementById("workbench")?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" })}><ArrowDown size={20} /></button>
                            <nav className="welcome-chapter-nav" aria-label="故事章节">{chapters.map((item, index) => <button key={item.id} className={chapter === index ? "is-current" : ""} aria-label={item.label} title={item.label} aria-current={chapter === index ? "step" : undefined} onClick={() => jumpTo(index)}><span /></button>)}</nav>
                            <button className="welcome-icon" title={paused || staticScene ? "播放动画" : "暂停动画"} aria-label={paused || staticScene ? "播放动画" : "暂停动画"} aria-pressed={paused || staticScene} disabled={staticScene} onClick={() => setPaused(!paused)}>{paused || staticScene ? <Play size={16} /> : <Pause size={16} />}</button>
                        </div>
                        <div className="welcome-scroll-progress" aria-hidden="true" />
                    </div>
                </section>

                <section id="workbench" className="welcome-workbench">
                    <div className="welcome-section-heading"><h2>让想象，有处落笔。</h2></div>
                    <div className="welcome-workbench-bar"><div role="tablist" aria-label="工作台预览">{showcases.map((item, index) => <button key={item.name} role="tab" id={`preview-tab-${index}`} aria-controls="workbench-preview" aria-selected={showcase === index} tabIndex={showcase === index ? 0 : -1} onClick={() => setShowcase(index)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : 2)) % 3; setShowcase(next); document.getElementById(`preview-tab-${next}`)?.focus(); } }}>{item.name}</button>)}</div><a href={active.href}>进入{active.name}<ArrowUpRight size={16} /></a></div>
                    <div id="workbench-preview" role="tabpanel" aria-labelledby={`preview-tab-${showcase}`} className="welcome-workbench-preview"><img src={active.image} alt={`影策${active.name}界面`} loading="lazy" /></div>
                    <div className="welcome-workbench-caption"><p>{active.detail}</p></div>
                </section>

                <section className="welcome-ending"><h2>你的故事，<br />现在开始。</h2><a className="welcome-primary" href="/create">开始创作<ArrowRight size={20} /></a><a className="welcome-source" href={github} target="_blank" rel="noreferrer"><Code2 size={16} />GitHub<ArrowUpRight size={14} /></a></section>
            </main>
            <footer className="welcome-footer"><a href="/welcome">影策</a><span>开源 AI 影视创作工作台</span><a href={`${github}/blob/main/LICENSE`} target="_blank" rel="noreferrer">Open Source · MIT License<ArrowUpRight size={12} /></a></footer>
            {look.credit && <div className="welcome-media-credit"><a href={`/welcome/credits.html#${look.id}`} target="_blank" rel="noreferrer">{look.credit} · 署名与许可<ArrowUpRight size={12} /></a></div>}
            {playing && look.video && <FilmDialog look={look} onClose={() => setPlaying(false)} videoRef={videoRef} />}
        </div>
    );
}

function FilmDialog({ look, onClose, videoRef }: { look: WelcomeLook; onClose: () => void; videoRef: React.RefObject<HTMLVideoElement | null> }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
    return <dialog ref={dialogRef} className="welcome-film-dialog" aria-label={`${look.title}影片片段`} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div><button autoFocus className="welcome-icon" aria-label="关闭影片" onClick={onClose}><X /></button><video ref={videoRef} src={look.video} poster={look.frames[0]} controls autoPlay muted playsInline /><p>{look.credit ?? look.title}</p></div></dialog>;
}

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { this.props.onError(); }
    render() { return this.state.failed ? null : this.props.children; }
}
