import { Check, Download, Film, LoaderCircle, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
    LL2_CONNECTED_VIDEO_MODELS,
    LL2_VIDEO_DURATION,
    ll2ActualCNY,
    ll2FormatCNY,
    ll2ModelById,
    ll2PreciseCNY,
    ll2TiersFor,
    type LL2ConnectedVideoModel,
} from "@/lib/ll2-models";
import { ll2GenerateVideo, type LL2VideoProgress } from "@/services/ll2/ll2-video";
import { ll2AddFilm, ll2DownloadFilm, ll2FilmAgeLabel, ll2ListFilms, ll2RemoveFilm, type LL2Film } from "@/services/ll2/ll2-films";
import { ll2OpenKeyDialog, useLL2Store } from "@/stores/use-ll2-store";

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

const EXAMPLES = [
    "黄昏的海面，镜头缓缓向前推进，云在移动",
    "雨夜霓虹街角，一个人撑伞走过，镜头跟拍",
    "白色纸飞机飞过晨雾中的山谷，阳光穿过云层",
];

/**
 * 高级生成面板：给想自己调模型 / 清晰度 / 时长的人用。
 * 2026-11-18：填 Key 统一走全局弹窗，这里不再内嵌第二份输入框。
 */
export function LL2GeneratePanel() {
    const apiKey = useLL2Store((state) => state.apiKey);
    const connected = Boolean(apiKey.trim());
    const [model, setModel] = useState<LL2ConnectedVideoModel>("MiniMax-H3");
    const [resolution, setResolution] = useState("768P");
    const [seconds, setSeconds] = useState(5);
    const [ratio, setRatio] = useState("16:9");
    const [prompt, setPrompt] = useState("");
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<LL2VideoProgress | null>(null);
    const [error, setError] = useState("");
    const [activeFilm, setActiveFilm] = useState<LL2Film | null>(null);
    const [films, setFilms] = useState<LL2Film[]>([]);
    const [downloadMessage, setDownloadMessage] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        setFilms(ll2ListFilms());
        return () => abortRef.current?.abort();
    }, []);

    // 切换模型时把清晰度与时长收敛到该模型的合法范围。
    useEffect(() => {
        const tiers = ll2TiersFor(model);
        setResolution(tiers[0]?.resolution || "768P");
        const range = LL2_VIDEO_DURATION[model];
        setSeconds((value) => Math.min(range.max, Math.max(range.min, value || range.default)));
    }, [model]);

    const tiers = useMemo(() => ll2TiersFor(model), [model]);
    const range = LL2_VIDEO_DURATION[model];
    const estimate = ll2PreciseCNY(model, seconds, resolution);
    const modelInfo = ll2ModelById(model);

    const start = async () => {
        if (!connected) {
            ll2OpenKeyDialog();
            return;
        }
        if (!prompt.trim()) {
            setError("先写一句话，说清你想要的画面");
            return;
        }
        setRunning(true);
        setError("");
        setProgress(null);
        setActiveFilm(null);
        setDownloadMessage("");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const result = await ll2GenerateVideo(
                { apiKey, model, prompt, seconds, resolution, ratio, signal: controller.signal },
                setProgress,
            );
            const film: LL2Film = {
                id: result.taskId,
                taskId: result.taskId,
                model: result.model,
                prompt: result.prompt,
                seconds: result.seconds,
                chargedSeconds: result.chargedSeconds,
                resolution: result.resolution,
                ratio: result.ratio,
                estimateCNY: result.estimateCNY,
                actualCNY: result.actualCNY,
                url: result.url,
                createdAt: result.createdAt,
            };
            setFilms(ll2AddFilm(film));
            setActiveFilm(film);
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === "AbortError") setError("已停止等待。任务可能还在生成，费用以 LL2 控制台账单为准");
            else setError(cause instanceof Error ? cause.message : "生成失败，请稍后重试");
        } finally {
            setRunning(false);
            setProgress(null);
            abortRef.current = null;
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
    };

    const activeActual = activeFilm ? ll2ActualCNY(activeFilm.model, activeFilm.chargedSeconds, activeFilm.resolution) : null;

    return (
        <section className="ll2-generate" aria-label="高级生成">
            <header className="ll2-generate-head">
                <div>
                    <span className="ll2-generate-eyebrow">高级生成</span>
                    <h2>想自己调参数，就在这里</h2>
                    <p>选模型、清晰度、时长，提交前先告诉你要花多少钱</p>
                </div>
                <span className="ll2-generate-live">{LL2_CONNECTED_VIDEO_MODELS.length} 个视频模型都能出片</span>
            </header>

            {!connected ? (
                <div className="ll2-generate-need-key">
                    <p>不用注册账号，只要填一次 LL2 Key 就能生成。</p>
                    <button type="button" className="ll2-generate-button" onClick={ll2OpenKeyDialog}>
                        填入 LL2 Key
                    </button>
                </div>
            ) : (
                <div className="ll2-generate-body">
                    <div className="ll2-generate-models" role="group" aria-label="选择模型">
                        {LL2_CONNECTED_VIDEO_MODELS.map((id) => {
                            const info = ll2ModelById(id);
                            const selected = model === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    className={`ll2-model-tab ${selected ? "is-active" : ""}`}
                                    onClick={() => setModel(id)}
                                    aria-pressed={selected}
                                >
                                    <span className="ll2-model-tab-name">{id}</span>
                                    <span className="ll2-model-tab-meta">{info?.priceText || ""} · {info?.spec || ""}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="ll2-generate-controls">
                        <label className="ll2-control">
                            <span>清晰度</span>
                            {tiers.length > 1 ? (
                                <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                                    {tiers.map((tier) => (
                                        <option key={tier.resolution} value={tier.resolution}>
                                            {tier.label} · ¥{ll2FormatCNY(tier.perSecond)}/秒
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <span className="ll2-control-fixed">{tiers[0]?.label || "768P 固定"}</span>
                            )}
                        </label>
                        <label className="ll2-control">
                            <span>时长</span>
                            <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
                                {Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index).map((value) => (
                                    <option key={value} value={value}>{value} 秒</option>
                                ))}
                            </select>
                        </label>
                        <label className="ll2-control">
                            <span>比例</span>
                            <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                                {RATIOS.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                        </label>
                    </div>

                    <div className="ll2-generate-prompt">
                        <textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="描述你想要的画面、镜头和光线……"
                            rows={3}
                            maxLength={7000}
                            disabled={running}
                        />
                        <div className="ll2-generate-examples">
                            <span>不知道写什么：</span>
                            {EXAMPLES.map((example) => (
                                <button key={example} type="button" onClick={() => setPrompt(example)} disabled={running}>
                                    {example}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ll2-generate-submit">
                        <div className="ll2-generate-price" title={estimate.basis}>
                            <span className="ll2-generate-price-label">本次预计</span>
                            <strong>{estimate.label}</strong>
                            <small>{estimate.resolution} · {seconds} 秒 · {model}</small>
                        </div>
                        {running ? (
                            <button type="button" className="ll2-generate-button is-running" onClick={cancel}>
                                <Square className="size-4" /> 取消生成
                            </button>
                        ) : (
                            <button type="button" className="ll2-generate-button" onClick={start}>
                                <Play className="size-4" /> 开始生成
                            </button>
                        )}
                    </div>

                    {running && progress ? (
                        <div className="ll2-generate-progress" role="status">
                            <LoaderCircle className="size-4 is-spinning" />
                            <span>
                                任务已受理（{progress.taskId.slice(0, 12)}…）· 状态 {progress.status || "排队中"} · 已等待 {Math.round(progress.elapsedMs / 1000)} 秒
                            </span>
                        </div>
                    ) : null}

                    {error ? <div className="ll2-generate-error" role="alert">{error}</div> : null}

                    {activeFilm && activeActual ? (
                        <div className="ll2-result">
                            <video className="ll2-result-video" src={activeFilm.url} controls playsInline preload="metadata" />
                            <div className="ll2-result-meta">
                                <div className="ll2-result-charge">
                                    <span>实际扣费</span>
                                    <strong>{activeActual.label}</strong>
                                    <small>{activeActual.basis}</small>
                                </div>
                                <p className="ll2-result-hint">
                                    {modelInfo?.name} · {activeFilm.seconds} 秒 · {activeFilm.resolution} · 预估 ¥{ll2FormatCNY(activeFilm.estimateCNY)}
                                    <br />
                                    生成的片子在云端保留 24 小时，请及时下载到这台电脑。
                                </p>
                                <div className="ll2-result-actions">
                                    <button
                                        type="button"
                                        className="ll2-result-primary"
                                        onClick={async () => {
                                            const outcome = await ll2DownloadFilm(activeFilm);
                                            setDownloadMessage(outcome.message);
                                        }}
                                    >
                                        <Download className="size-4" /> 下载到本机
                                    </button>
                                    <button type="button" className="ll2-result-ghost" onClick={() => { setPrompt(activeFilm.prompt); setError("已把上次的句子填回来。再生成一次会重新计费。"); }}>
                                        照这个再做一版
                                    </button>
                                </div>
                                {downloadMessage ? <p className="ll2-result-download">{downloadMessage}</p> : null}
                            </div>
                        </div>
                    ) : null}
                </div>
            )}

            <div className="ll2-filmstrip">
                <div className="ll2-filmstrip-head">
                    <span><Film className="size-4" /> 我的片子</span>
                    <small>存在这台电脑 · {films.length} 支</small>
                </div>
                {films.length === 0 ? (
                    <p className="ll2-filmstrip-empty">生成的第一支片子会出现在这里，点开就能播放。</p>
                ) : (
                    <div className="ll2-filmstrip-track">
                        {films.map((film) => (
                            <div key={film.id} className={`ll2-film-card ${activeFilm?.id === film.id ? "is-active" : ""}`}>
                                <button type="button" className="ll2-film-card-main" onClick={() => setActiveFilm(film)} title={film.prompt}>
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
                                        if (activeFilm?.id === film.id) setActiveFilm(null);
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="ll2-generate-foot">
                <Check className="size-3.5" />
                价格按 LL2 官网价格估算，实际账单以控制台为准。再做一版会重新计费。
            </div>
        </section>
    );
}
