import { ArrowUpRight, CheckCircle2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import {
    LL2_MODELS,
    LL2_MODEL_COUNT,
    LL2_MODEL_SPECS,
    LL2_PRICE_SNAPSHOT_DATE,
    LL2_PRICING_URL,
    LL2_STATUS_URL,
    ll2ConnectionSummary,
    ll2EstimateCNY,
    ll2FriendlyCNY,
    ll2TierPriceText,
    type LL2ModelCategory,
} from "@/lib/ll2-models";
import { useLL2Store } from "@/stores/use-ll2-store";

type Filter = "all" | LL2ModelCategory;

const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: "all", label: `全部 ${LL2_MODEL_COUNT}` },
    { id: "video", label: "视频生成" },
    { id: "upscale", label: "让片子更清楚" },
    { id: "text", label: "聊天改稿" },
];

// 2026-11-18：四条优势全部改成白话，不摆「兼容协议 / 自建机房」这类工程说法。
const ADVANTAGES = [
    { no: "01", title: "填一次 Key，模型随便挑", detail: "想换模型不用再填一次" },
    { no: "02", title: "自己有机器，价格实在", detail: "少一层转手，有些模型更便宜" },
    { no: "03", title: "5 秒片子约 ¥0.25", detail: "最常用来出片的模型，每秒 ¥0.05" },
    { no: "04", title: "花多少钱，出片前知道", detail: "单价和这一次多少钱都写清楚" },
];

/** 只有「按秒计费」的模型能进这个算价器；按字数的模型不硬套秒数。 */
const PER_SECOND_MODELS = LL2_MODELS.filter((model) => (LL2_MODEL_SPECS[model.id]?.tiers || []).some((tier) => typeof tier.perSecond === "number"));

/** 用户要的「一共需要多少钱」：选模型 + 清晰度 + 时长，直接出总价。 */
function CostCalculator() {
    const [modelId, setModelId] = useState("MiniMax-H3");
    const [tierLabel, setTierLabel] = useState("768P");
    const [seconds, setSeconds] = useState(5);
    const tiers = (LL2_MODEL_SPECS[modelId]?.tiers || []).filter((tier) => typeof tier.perSecond === "number");
    const active = tiers.find((tier) => tier.label === tierLabel) || tiers[0];
    const total = typeof active?.perSecond === "number" ? active.perSecond * seconds : null;
    const spec = LL2_MODEL_SPECS[modelId];
    const minSeconds = spec?.secondsMin ?? 1;
    const maxSeconds = spec?.secondsMax ?? 30;

    return (
        <section className="ll2-plaza-calc" aria-label="算一算这次花多少钱">
            <div className="ll2-plaza-calc-head">
                <strong>算一算，这次一共花多少钱</strong>
                <span>选模型、清晰度、时长，下面直接给出总价</span>
            </div>
            <div className="ll2-plaza-calc-row">
                <label>
                    <span>模型</span>
                    <select value={modelId} onChange={(event) => {
                        const next = event.target.value;
                        setModelId(next);
                        const first = (LL2_MODEL_SPECS[next]?.tiers || []).find((tier) => typeof tier.perSecond === "number");
                        setTierLabel(first?.label || "");
                        const nextSpec = LL2_MODEL_SPECS[next];
                        const min = nextSpec?.secondsMin ?? 1;
                        const max = nextSpec?.secondsMax ?? 30;
                        setSeconds((value) => Math.min(max, Math.max(min, value)));
                    }} aria-label="选择模型">
                        {PER_SECOND_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                </label>
                <label>
                    <span>清晰度</span>
                    <select value={active?.label || ""} onChange={(event) => setTierLabel(event.target.value)} aria-label="选择清晰度" disabled={tiers.length < 2}>
                        {tiers.map((tier) => <option key={tier.label} value={tier.label}>{tier.label} · {ll2TierPriceText(tier)}</option>)}
                    </select>
                </label>
                <label>
                    <span>时长</span>
                    <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} aria-label="选择时长">
                        {Array.from({ length: maxSeconds - minSeconds + 1 }, (_, index) => minSeconds + index).map((value) => <option key={value} value={value}>{value} 秒</option>)}
                    </select>
                </label>
                <div className="ll2-plaza-calc-total">
                    <span>本次一共</span>
                    {/* C 端不显示 ¥0.0417 这种四位小数：不到 1 分钱就说白话。 */}
                    <strong>{total === null ? "—" : `约 ${ll2FriendlyCNY(total)}`}</strong>
                    <small>{active ? `${active.label} · ${ll2TierPriceText(active)} × ${seconds} 秒` : "这个模型按写了多少字算"}</small>
                </div>
            </div>
            <p>
                {spec?.duration ? `时长口径：${spec.duration}。` : ""}
                {spec?.secondsMin && spec?.secondsMax ? `这个模型可选 ${spec.secondsMin}–${spec.secondsMax} 秒。` : ""}
                按 LL2 官网价格估算，实际账单以控制台为准；按写了多少字算的模型不适用「几秒多少钱」。
            </p>
        </section>
    );
}

export default function LL2ModelPlaza() {
    const [filter, setFilter] = useState<Filter>("all");
    // 价格快照是内置的：浏览器直连 ll2.cn/api/pricing 会被跨域拦死（实测），
    // 所以不再做「拉取 + 失败提示」，也不摆一个永远失败的重试按钮。
    const liveModels = useLL2Store((state) => state.liveModels);
    const models = useMemo(() => (filter === "all" ? LL2_MODELS : LL2_MODELS.filter((model) => model.category === filter)), [filter]);
    const summary = useMemo(() => ll2ConnectionSummary(liveModels), [liveModels]);
    const cheapest = useMemo(() => {
        const estimate = ll2EstimateCNY("MiniMax-H3", 5);
        return estimate ? ll2FriendlyCNY(estimate.amount) : "¥0.25";
    }, []);

    return (
        <main className="ll2-plaza">
            <header className="ll2-plaza-head">
                <div>
                    <p className="ll2-plaza-eyebrow">DMC · 模型与价格</p>
                    <h1 className="ll2-plaza-title">每次调用花多少钱，一眼看清</h1>
                    <p className="ll2-plaza-sub">
                        {summary.connected} 个模型都标了单价和一次典型调用的价格。最省的一支 5 秒片子 <strong>{cheapest}</strong>。
                    </p>
                </div>
                <div className="ll2-plaza-head-actions">
                    <a className="ll2-plaza-link" href={LL2_PRICING_URL} target="_blank" rel="noreferrer">
                        官网实时价格 <ArrowUpRight className="size-3.5" />
                    </a>
                    <Link className="ll2-plaza-link" to="/">去写一句话出片 <ArrowUpRight className="size-3.5" /></Link>
                </div>
            </header>

            <section className="ll2-plaza-advantages" aria-label="DMC 特色与优势">
                {ADVANTAGES.map((item) => (
                    <div className="ll2-plaza-advantage" key={item.no}>
                        <span className="ll2-plaza-advantage-no">{item.no}</span>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                    </div>
                ))}
            </section>

            <CostCalculator />

            <div className="ll2-plaza-toolbar">
                <div className="ll2-plaza-filters" role="tablist" aria-label="按模型类型筛选">
                    {FILTERS.map((item) => (
                        <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`ll2-plaza-filter ${filter === item.id ? "is-active" : ""}`} onClick={() => setFilter(item.id)}>
                            {item.label}
                        </button>
                    ))}
                </div>
                <span
                    className="ll2-plaza-refresh is-static"
                    title="浏览器直连 ll2.cn 的价格接口会被跨域拦截；这张表用的是内置快照，与官网同一套计费系数。要看最新价格，点右上「官网实时价格」。"
                >
                    <RefreshCw className="size-3.5" />
                    价格按内置快照展示
                </span>
            </div>

            <div className="ll2-plaza-table-wrap">
                <table className="ll2-plaza-table">
                    <thead>
                        <tr>
                            <th>模型</th>
                            <th>能力</th>
                            <th>清晰度 / 每档单价</th>
                            <th>时长</th>
                            <th>怎么算钱</th>
                            <th>一次大概多少</th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.map((model) => {
                            const estimate = ll2EstimateCNY(model.id, 5);
                            const spec = LL2_MODEL_SPECS[model.id];
                            return (
                                <tr key={model.id}>
                                    <td>
                                        <div className="ll2-plaza-model">
                                            <strong>{model.name}</strong>
                                            <span>{model.vendor}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="ll2-plaza-capability">
                                            <span>{model.capability}</span>
                                            <small>{model.billingUnit}</small>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="ll2-plaza-tiers">
                                            <strong>{spec?.resolutions || model.spec}</strong>
                                            {(spec?.tiers || []).map((tier) => (
                                                <small key={tier.label}><b>{tier.label}</b> {ll2TierPriceText(tier)}{tier.note ? ` · ${tier.note}` : ""}</small>
                                            ))}
                                            {model.derived ? <small className="ll2-plaza-derived">单价按官网计费方式换算</small> : null}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="ll2-plaza-duration">{spec?.duration || "按用量算"}</div>
                                    </td>
                                    <td>
                                        <div className="ll2-plaza-price">
                                            <strong>{model.priceText}</strong>
                                            <small>{spec?.unit || model.billingUnit}</small>
                                        </div>
                                    </td>
                                    <td>
                                        {estimate ? (
                                            <div className="ll2-plaza-once">
                                                <strong>{estimate.label}</strong>
                                                <small>{model.sampleLabel}</small>
                                            </div>
                                        ) : (
                                            <div className="ll2-plaza-once is-usage">
                                                <strong>按写了多少字算</strong>
                                                <small>{model.sampleLabel}</small>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {summary.added > 0 ? (
                <p className="ll2-plaza-added">
                    官网另有 {summary.added} 个新模型已自动加进来，本机还没存它们的价格，暂时不标价，免得写错。
                </p>
            ) : null}

            <footer className="ll2-plaza-foot">
                <p>
                    <CheckCircle2 className="size-4" aria-hidden />
                    价格按 LL2 官网价格估算，实际账单以控制台为准。最近一次核对 {LL2_PRICE_SNAPSHOT_DATE}。
                </p>
                <p>
                    MiniMax-H3 固定 768P、4–15 秒，没有 2K 和质量档位；更清楚的版本是另一个超分模型做出来的。
                </p>
                <p>
                    聊天改稿按写了多少字算，没有固定单次价；有的模型白天晚上价格不同，以官网为准。
                </p>
                <p>
                    生成的片子在云端保留 24 小时，请及时下载到这台电脑。
                    <a href={LL2_STATUS_URL} target="_blank" rel="noreferrer"> 服务运行状态 <ArrowUpRight className="size-3" /></a>
                </p>
            </footer>
        </main>
    );
}
