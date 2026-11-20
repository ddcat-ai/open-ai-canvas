import { Check, ExternalLink, KeyRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import {
    LL2_CONNECTED_VIDEO_MODELS,
    LL2_MODEL_COUNT,
    LL2_PRICING_URL,
    LL2_VIDEO_DURATION,
    LL2_VIDEO_TIERS,
    type LL2ConnectedVideoModel,
} from "@/lib/ll2-models";
import { ll2MaskedKey, ll2OpenKeyDialog, useLL2Store } from "@/stores/use-ll2-store";
import { ll2ReadSettings, ll2WriteSettings, type LL2WorkspaceSettings } from "@/lib/ll2-workspace";
import { LL2_TEXT_MODELS, ll2TextModelPriceHint } from "@/services/ll2/ll2-text";

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

/**
 * 设置页：收在侧栏底部，不和「一句话成片」并列在一级导航。
 * 只管三件本机事：LL2 Key、默认生成参数、官网模型清单，不碰账户系统。
 * 2026-11-18：填 Key 统一走全局弹窗，这里不再内嵌第二份输入框。
 */
export default function LL2Config() {
    const apiKey = useLL2Store((state) => state.apiKey);
    const [settings, setSettings] = useState<LL2WorkspaceSettings>(() => ll2ReadSettings());
    const [saved, setSaved] = useState(false);
    const tiers = LL2_VIDEO_TIERS[settings.videoModel];
    const range = LL2_VIDEO_DURATION[settings.videoModel];
    const textModelPrice = ll2TextModelPriceHint(settings.textModel);

    const update = (patch: Partial<LL2WorkspaceSettings>) => {
        const next = ll2WriteSettings({ ...settings, ...patch });
        setSettings(next);
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
    };

    return (
        <div className="ll2-wb">
            <main className="ll2-wb-main is-wide">
                <header className="ll2-wb-page-head">
                    <span className="ll2-wb-eyebrow">设置</span>
                    <h1>填一次 Key，把默认参数定好</h1>
                    <p>不用注册账号，只要填一次 LL2 Key。Key 只存这台电脑，不上传、不写进账户系统。</p>
                </header>

                <section className="ll2-config-block">
                    <div className="ll2-config-block-head">
                        <span><KeyRound className="size-4" /> LL2 API Key</span>
                        {apiKey.trim() ? <span className="ll2-config-connected"><Check className="size-3.5" /> 已连接 · {ll2MaskedKey(apiKey)}</span> : <span className="ll2-config-disconnected">还没填</span>}
                    </div>
                    <p className="ll2-config-note">
                        {apiKey.trim() ? "已经连上了，出片前会先显示这次要花多少钱。" : "去 LL2 网站登录，复制你的 Key，再回到这里粘贴。我们不会另做一套登录。"}
                    </p>
                    <div className="ll2-config-actions">
                        <button type="button" className="ll2-key-primary" onClick={ll2OpenKeyDialog}>
                            {apiKey.trim() ? "更换 Key" : "填入 Key"}
                        </button>
                        <a className="ll2-config-external" href="https://ll2.cn/console/token" target="_blank" rel="noreferrer">去 LL2 控制台复制 Key <ExternalLink className="size-3.5" /></a>
                    </div>
                </section>

                <section className="ll2-config-block">
                    <div className="ll2-config-block-head">
                        <span>默认生成参数</span>
                        {saved ? <span className="ll2-config-connected"><Check className="size-3.5" /> 已保存到本机</span> : null}
                    </div>
                    <p className="ll2-config-note">这些只是默认值，每次出片前都能临时改，也会先给你看这次一共花多少钱。</p>
                    <div className="ll2-config-grid">
                        <label>
                            <span>视频模型</span>
                            <select value={settings.videoModel} onChange={(event) => {
                                const videoModel = event.target.value as LL2ConnectedVideoModel;
                                update({ videoModel, resolution: LL2_VIDEO_TIERS[videoModel][0]?.resolution || "768P" });
                            }}>
                                {LL2_CONNECTED_VIDEO_MODELS.map((id) => <option key={id} value={id}>{id}</option>)}
                            </select>
                            <small>{LL2_CONNECTED_VIDEO_MODELS.length} 个视频模型都能直接出片</small>
                        </label>
                        <label>
                            <span>清晰度</span>
                            <select value={settings.resolution} onChange={(event) => update({ resolution: event.target.value })} disabled={tiers.length < 2}>
                                {tiers.map((tier) => <option key={tier.resolution} value={tier.resolution}>{tier.label}</option>)}
                            </select>
                            <small>每个模型可选的清晰度不同</small>
                        </label>
                        <label>
                            <span>时长（秒）</span>
                            <select value={settings.seconds} onChange={(event) => update({ seconds: Number(event.target.value) })}>
                                {Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index).map((value) => <option key={value} value={value}>{value} 秒</option>)}
                            </select>
                            <small>越长的片子花钱越多</small>
                        </label>
                        <label>
                            <span>画面比例</span>
                            <select value={settings.ratio} onChange={(event) => update({ ratio: event.target.value })}>
                                {RATIOS.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                            <small>发短视频常用 9:16</small>
                        </label>
                        <label>
                            <span>Agent 用哪个</span>
                            <select value={settings.textModel} onChange={(event) => update({ textModel: event.target.value })}>
                                {LL2_TEXT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <small>{textModelPrice}</small>
                        </label>
                    </div>
                </section>

                <section className="ll2-config-block">
                    <div className="ll2-config-block-head">
                        <span>模型清单</span>
                    </div>
                    <p className="ll2-config-note">
                        本机已存 {LL2_MODEL_COUNT} 个模型的价格，和 LL2 官网的计费系数一致。
                        浏览器里读不到官网实时清单（跨域拦截），要看最新价格请点下面的「LL2 官网价格页」。
                    </p>
                    <div className="ll2-config-links">
                        <Link to="/models">模型广场 · 每次调用多少钱 <ExternalLink className="size-3.5" /></Link>
                        <a href={LL2_PRICING_URL} target="_blank" rel="noreferrer">LL2 官网价格页 <ExternalLink className="size-3.5" /></a>
                    </div>
                </section>
            </main>
        </div>
    );
}
