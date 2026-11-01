import { Check, ChevronDown, X } from "lucide-react";
import { GlobeIcon } from "@/components/ui/ecommerce-icons";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { commercePlatformGroups, labelOf, languageVisuals, languages, platforms } from "./catalog";

export function PlatformMark({ platform }: { platform: string }) {
    return <img className="commerce-platform-logo" data-monochrome={["amazon", "tiktok", "douyin", "ozon", "dewu"].includes(platform)} src={`/commerce/platforms/${platform}.svg`} alt="" width={28} height={28} />;
}

export function LanguageFlag({ language }: { language: string }) {
    const flag = languageVisuals[language]?.flag;
    return flag ? <img className="commerce-language-flag" src={`/commerce/flags/${flag}.svg`} alt="" width={28} height={21} /> : <GlobeIcon size={22} />;
}

export function CommerceMarketPicker({
    anchor,
    platform,
    language,
    region,
    onPlatform,
    onLanguage,
    onRegion,
    onClose,
}: {
    anchor: RefObject<HTMLDivElement | null>;
    platform: string;
    language: string;
    region: string;
    onPlatform: (value: string) => void;
    onLanguage: (value: string) => void;
    onRegion: (value: string) => void;
    onClose: () => void;
}) {
    const [languageOpen, setLanguageOpen] = useState(false);
    const languageBlock = useRef<HTMLDivElement>(null);
    const dialog = useRef<HTMLElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    const [position, setPosition] = useState({ left: 16, bottom: 200, width: 480, maxHeight: 430 });
    useLayoutEffect(() => {
        const positionPanel = () => {
            const rect = anchor.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(480, window.innerWidth - 24);
            const bottom = Math.max(12, window.innerHeight - rect.bottom + 76);
            setPosition({ left: Math.max(12, Math.min(rect.left + 12, window.innerWidth - width - 12)), bottom, width, maxHeight: Math.min(440, Math.max(180, window.innerHeight - bottom - 24)) });
        };
        positionPanel();
        window.addEventListener("resize", positionPanel);
        return () => window.removeEventListener("resize", positionPanel);
    }, [anchor]);
    useLayoutEffect(() => {
        if (languageOpen) languageBlock.current?.scrollIntoView?.({ block: "nearest" });
    }, [languageOpen]);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close.current();
            }
            if (event.key !== "Tab") return;
            const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || []);
            const first = elements[0],
                last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return createPortal(
        <div className="commerce-market-layer" data-canvas-no-zoom>
            <button className="commerce-market-dismiss" aria-label="关闭平台选择" onClick={onClose} />
            <section ref={dialog} className="commerce-market-panel" role="dialog" aria-modal="true" aria-label="电商平台与语言" style={position} data-canvas-wheel-scroll>
                <header>
                    <strong>电商平台</strong>
                    <button type="button" aria-label="关闭参数" onClick={onClose}>
                        <X size={18} />
                    </button>
                </header>
                <div className="commerce-market-scroll">
                    <div className="commerce-market-groups">
                        {(
                            [
                                ["crossBorder", "跨境电商"],
                                ["domestic", "中文电商"],
                            ] as const
                        ).map(([group, title]) => (
                            <section key={group}>
                                <h3>{title}</h3>
                                <div className="commerce-market-grid">
                                    {commercePlatformGroups[group].map((id) => (
                                        <button type="button" key={id} className={platform === id ? "is-selected" : ""} aria-pressed={platform === id} onClick={() => onPlatform(id)}>
                                            <PlatformMark platform={id} />
                                            <span>{labelOf(platforms, id)}</span>
                                            {platform === id ? <Check className="commerce-market-check" size={12} /> : null}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                    <div className="commerce-market-language" ref={languageBlock}>
                        <h3>语言</h3>
                        <button className="commerce-language-trigger" type="button" aria-expanded={languageOpen} aria-controls="commerce-language-options" onClick={() => setLanguageOpen((open) => !open)}>
                            <LanguageFlag language={language} />
                            <strong>{languageVisuals[language]?.label || labelOf(languages, language)}</strong>
                            <ChevronDown size={18} className={languageOpen ? "is-open" : ""} />
                        </button>
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
                                        {language === id ? <Check size={18} /> : null}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <label className="commerce-market-region">
                        <span>目标国家或地区（可选）</span>
                        <input aria-label="目标国家或地区" value={region} maxLength={80} placeholder="例如：中国、美国、日本" onChange={(event) => onRegion(event.target.value)} />
                    </label>
                </div>
            </section>
        </div>,
        document.body,
    );
}
