import { Button } from "antd";
import { Check, ChevronDown, X } from "lucide-react";
import { GlobeIcon } from "@/components/ui/ecommerce-icons";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { commercePlatformGroups, labelOf, languageVisuals, languages, platforms } from "./catalog";
import { commerceKnowledgeFor, commercePlatformKnowledge } from "./platform-knowledge";
import "./market-picker.css";

export function PlatformMark({ platform }: { platform: string }) {
    return <img className="commerce-platform-logo" data-monochrome={["amazon", "tiktok", "douyin", "ozon", "dewu"].includes(platform)} src={`/commerce/platforms/${platform}.svg`} alt="" width={28} height={28} />;
}

export function LanguageFlag({ language }: { language: string }) {
    const flag = languageVisuals[language]?.flag;
    return flag ? <img className="commerce-language-flag" src={`/commerce/flags/${flag}.svg`} alt="" width={20} height={15} /> : <GlobeIcon size={16} />;
}

const groups = [
    ["domestic", "中文电商"],
    ["crossBorder", "跨境电商"],
] as const;

/** 投放平台与输出语言：居中弹窗，单层表面，平台按分组平铺。 */
export function CommerceMarketPicker({
    platform,
    language,
    region,
    onPlatform,
    onLanguage,
    onRegion,
    onClose,
}: {
    platform: string;
    language: string;
    region: string;
    onPlatform: (value: string) => void;
    onLanguage: (value: string) => void;
    onRegion: (value: string) => void;
    onClose: () => void;
}) {
    const [languageOpen, setLanguageOpen] = useState(false);
    const knowledge = commerceKnowledgeFor(platform);
    return (
        <AppModal open flush closable={false} footer={null} width="min(680px, calc(100vw - 32px))" onCancel={onClose} centered className="commerce-market-modal">
            <section className="commerce-market" role="dialog" aria-label="电商平台与语言" data-canvas-no-zoom>
                <header className="commerce-market-head">
                    <div>
                        <h2>投放平台与语言</h2>
                        <p>平台决定图片规范与文案约束，语言决定图中文字。</p>
                    </div>
                    <button type="button" className="commerce-market-close" aria-label="关闭参数" onClick={onClose}>
                        <X size={16} />
                    </button>
                </header>
                <div className="commerce-market-body" data-canvas-wheel-scroll>
                    {groups.map(([group, title]) => (
                        <section key={group} className="commerce-market-group">
                            <h3>{title}</h3>
                            <div className="commerce-market-grid">
                                {commercePlatformGroups[group].map((id) => (
                                    <button type="button" key={id} className={platform === id ? "is-selected" : ""} aria-pressed={platform === id} title={labelOf(platforms, id)} onClick={() => onPlatform(id)}>
                                        <span className="commerce-market-logo" aria-hidden="true">
                                            <PlatformMark platform={id} />
                                        </span>
                                        <span className="commerce-market-name">{labelOf(platforms, id)}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                    <div className="commerce-market-fields">
                        <div className="commerce-market-field">
                            <h3>输出语言</h3>
                            <button className="commerce-language-trigger" type="button" aria-expanded={languageOpen} aria-controls="commerce-language-options" onClick={() => setLanguageOpen((open) => !open)}>
                                <LanguageFlag language={language} />
                                <strong>{languageVisuals[language]?.label || labelOf(languages, language)}</strong>
                                <ChevronDown size={14} className={languageOpen ? "is-open" : ""} />
                            </button>
                        </div>
                        <label className="commerce-market-field">
                            <h3>目标地区（可选）</h3>
                            <input aria-label="目标国家或地区" value={region} maxLength={80} placeholder="例如：美国、日本" onChange={(event) => onRegion(event.target.value)} />
                        </label>
                    </div>
                    {languageOpen ? (
                        <div id="commerce-language-options" className="commerce-language-options" role="listbox" aria-label="输出语言">
                            {languages.map(([id, label]) => (
                                <button
                                    type="button"
                                    key={id}
                                    role="option"
                                    aria-selected={language === id}
                                    onClick={() => {
                                        onLanguage(id);
                                        setLanguageOpen(false);
                                    }}
                                >
                                    <LanguageFlag language={id} />
                                    <strong>{languageVisuals[id]?.label || label}</strong>
                                    {language === id ? <Check size={14} /> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {knowledge ? (
                        <details className="commerce-market-rules" aria-label="所选平台图片规则">
                            <summary>{labelOf(platforms, platform)} 的图片与内容要求</summary>
                            <div>
                                {[knowledge.style, knowledge.risk, knowledge.scope].filter(Boolean).map((text) => (
                                    <p key={text}>{text}</p>
                                ))}
                                {knowledge.officialRules.length ? (
                                    <ul>
                                        {knowledge.officialRules.map((rule) => (
                                            <li key={rule}>{rule}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                <p className="commerce-market-source">
                                    {knowledge.reviewStatus === "pending" ? "详细规则待官方后台核实" : `已核对部分公开资料 · ${knowledge.checkedAt}`}
                                    {knowledge.sources.map((url, index) => (
                                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                            官方资料 {index + 1}
                                        </a>
                                    ))}
                                </p>
                                <p className="commerce-market-source">
                                    通用风险词示例：{commercePlatformKnowledge.restrictedPhrases.join("、")}（非完整官方禁词表）。{commercePlatformKnowledge.boundary}
                                </p>
                            </div>
                        </details>
                    ) : null}
                </div>
                <footer className="commerce-market-foot">
                    <span>
                        当前：{labelOf(platforms, platform)} · {languageVisuals[language]?.label || labelOf(languages, language)}
                        {region.trim() ? ` · ${region.trim()}` : ""}
                    </span>
                    <Button type="primary" onClick={onClose}>
                        完成
                    </Button>
                </footer>
            </section>
        </AppModal>
    );
}
