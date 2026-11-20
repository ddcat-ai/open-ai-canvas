import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ll2FormatCNY } from "@/lib/ll2-models";
import { ll2FetchHdBlob } from "@/services/ll2/ll2-hd";
import { ll2DownloadFilm, ll2FilmAgeLabel, ll2ListFilms, ll2RemoveFilm, type LL2Film } from "@/services/ll2/ll2-films";
import { useLL2Store } from "@/stores/use-ll2-store";

/**
 * 我的片子：本机作品库（胶片带）。生成统一回首页的「一句话成片」，这里只管看和下载。
 */
export default function LL2Films() {
    const [films, setFilms] = useState<LL2Film[]>(() => ll2ListFilms());
    const [active, setActive] = useState<LL2Film | null>(null);
    const [message, setMessage] = useState("");
    const apiKey = useLL2Store((state) => state.apiKey);
    /** 超分版地址要带 Key 下载成 blob 才能播，普通片子直接播直链。 */
    const [playerUrl, setPlayerUrl] = useState("");
    const [playerMessage, setPlayerMessage] = useState("");

    useEffect(() => {
        let cancelled = false;
        let objectUrl = "";
        setPlayerUrl("");
        setPlayerMessage("");
        if (!active) return;
        if (!active.requiresAuth) {
            setPlayerUrl(active.url);
            return;
        }
        if (!apiKey.trim()) {
            setPlayerMessage("超分版要连上 LL2 才能播放：点侧栏「连接 LL2」填一次 Key");
            return;
        }
        void ll2FetchHdBlob(active.url, apiKey)
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setPlayerUrl(objectUrl);
            })
            .catch((cause) => {
                if (!cancelled) setPlayerMessage(cause instanceof Error ? cause.message : "超分版加载失败，稍后再试");
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [active, apiKey]);

    const downloadActive = async () => {
        if (!active) return;
        if (!active.requiresAuth) {
            setMessage((await ll2DownloadFilm(active)).message);
            return;
        }
        if (!apiKey.trim()) {
            setMessage("超分版要连上 LL2 才能下载：先点侧栏「连接 LL2」填一次 Key");
            return;
        }
        try {
            const blob = await ll2FetchHdBlob(active.url, apiKey);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `LL2_${active.resolution.replace(/[^\w.-]+/g, "_")}_${active.seconds}s.mp4`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            setMessage("已下载到本机");
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : "下载失败，请稍后再试");
        }
    };

    return (
        <div className="ll2-wb">
            <main className="ll2-wb-main is-wide">
                <header className="ll2-wb-page-head">
                    <span className="ll2-wb-eyebrow">我的片子</span>
                    <h1>出过的片，都存在这台电脑</h1>
                    <p>生成的片子在云端保留 24 小时，请及时下载到这台电脑。</p>
                </header>

                <section className="ll2-wb-section" aria-label="本机作品">
                    <div className="ll2-wb-section-head">
                        <h2>本机作品 · {films.length} 支</h2>
                        <Link to="/">再去出一支 <Film className="size-3.5" /></Link>
                    </div>

                    {films.length === 0 ? (
                        <p className="ll2-wb-empty">还没有片子。回「一句话成片」写一句话，生成的第一支会出现在这里。</p>
                    ) : (
                        <>
                            <div className="ll2-filmstrip-track">
                                {films.map((film) => (
                                    <div key={film.id} className={`ll2-film-card ${active?.id === film.id ? "is-active" : ""}`}>
                                        <button type="button" className="ll2-film-card-main" onClick={() => setActive(film)} title={film.prompt}>
                                            <span className="ll2-film-card-perf" aria-hidden />
                                            <span className="ll2-film-card-model">{film.model}</span>
                                            <span className="ll2-film-card-cost">¥{ll2FormatCNY(film.actualCNY)}</span>
                                            <span className="ll2-film-card-prompt">{film.prompt}</span>
                                            <span className="ll2-film-card-time">{film.seconds}s · {film.resolution}{film.requiresAuth ? " · 超分版" : ""} · {ll2FilmAgeLabel(film.createdAt)}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="ll2-film-card-remove"
                                            aria-label="从本机移除这支片子"
                                            onClick={() => {
                                                setFilms(ll2RemoveFilm(film.id));
                                                if (active?.id === film.id) setActive(null);
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {active ? (
                                <div className="ll2-wb-player">
                                    {playerUrl ? (
                                        <video src={playerUrl} controls playsInline preload="metadata" />
                                    ) : (
                                        <div className="ll2-wb-empty">{playerMessage || "正在取回超分版…"}</div>
                                    )}
                                    <div>
                                        <strong>{active.model} · {active.seconds}s · {active.resolution}</strong>
                                        <p>{active.prompt}</p>
                                        <small>预估 ¥{ll2FormatCNY(active.estimateCNY)} · 实际扣费 ¥{ll2FormatCNY(active.actualCNY)} · {ll2FilmAgeLabel(active.createdAt)}</small>
                                        <button type="button" onClick={() => void downloadActive()}>下载到本机</button>
                                        {message ? <p className="ll2-wb-player-message">{message}</p> : null}
                                    </div>
                                </div>
                            ) : null}
                        </>
                    )}
                </section>

            </main>
        </div>
    );
}
