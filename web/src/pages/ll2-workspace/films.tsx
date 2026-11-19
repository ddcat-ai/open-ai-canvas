import { ChevronsUpDown, Film } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { LL2GeneratePanel } from "@/components/ll2/ll2-generate";
import { ll2FormatCNY } from "@/lib/ll2-models";
import { ll2DownloadFilm, ll2FilmAgeLabel, ll2ListFilms, ll2RemoveFilm, type LL2Film } from "@/services/ll2/ll2-films";

/**
 * 我的片子：本机作品库（胶片带）+ 完整生成面板。
 * 首页保持一个输入框的简洁形态，需要调模型/清晰度/比例/胶片带的人来这里。
 */
export default function LL2Films() {
    const [films, setFilms] = useState<LL2Film[]>(() => ll2ListFilms());
    const [active, setActive] = useState<LL2Film | null>(null);
    const [advanced, setAdvanced] = useState(false);
    const [message, setMessage] = useState("");

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
                                            <span className="ll2-film-card-time">{film.seconds}s · {film.resolution} · {ll2FilmAgeLabel(film.createdAt)}</span>
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
                                    <video src={active.url} controls playsInline preload="metadata" />
                                    <div>
                                        <strong>{active.model} · {active.seconds}s · {active.resolution}</strong>
                                        <p>{active.prompt}</p>
                                        <small>预估 ¥{ll2FormatCNY(active.estimateCNY)} · 实际扣费 ¥{ll2FormatCNY(active.actualCNY)} · {ll2FilmAgeLabel(active.createdAt)}</small>
                                        <button type="button" onClick={async () => setMessage((await ll2DownloadFilm(active)).message)}>下载到本机</button>
                                        {message ? <p className="ll2-wb-player-message">{message}</p> : null}
                                    </div>
                                </div>
                            ) : null}
                        </>
                    )}
                </section>

                <section className="ll2-wb-section" aria-label="临时手动生成">
                    <button type="button" className="ll2-wb-advanced-toggle" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>
                        <ChevronsUpDown className="size-4" />
                        <span>临时手动生成：想自己调模型、清晰度、时长、比例，就在这直接出一支</span>
                        <strong>{advanced ? "收起" : "展开"}</strong>
                    </button>
                    {advanced ? <LL2GeneratePanel /> : <p className="ll2-wb-empty">首页那个输入框够用就不用展开这里。</p>}
                </section>
            </main>
        </div>
    );
}
