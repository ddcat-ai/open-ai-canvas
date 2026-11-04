import { useLayoutEffect, useRef, useState } from "react";

import "./rolling-credit-text.css";

type Roll = { from: string; to: string; revision: number };

export function RollingCreditText({ text }: { text: string | null }) {
    const previous = useRef(text);
    const revision = useRef(0);
    const [roll, setRoll] = useState<Roll | null>(null);

    useLayoutEffect(() => {
        if (text === null) return;
        if (previous.current === text) return;
        const from = previous.current;
        previous.current = text;
        if (from === null) {
            setRoll(null);
            return;
        }
        if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setRoll(null);
            return;
        }
        setRoll({ from, to: text, revision: ++revision.current });
    }, [text]);

    if (text === null) return <span className="rolling-credit-text" hidden />;
    const active = roll?.to === text ? roll : null;
    const oldDigits = active?.from.match(/[0-9]/g)?.reverse() || [];
    const characters = Array.from(text);
    const digitPositions = new Map<number, number>();
    let digitPosition = 0;
    for (let index = characters.length - 1; index >= 0; index--) {
        if (/[0-9]/.test(characters[index])) digitPositions.set(index, digitPosition++);
    }

    return (
        <span className="rolling-credit-text">
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">
                {characters.map((character, index) => {
                    const position = digitPositions.get(index);
                    const oldDigit = position === undefined ? undefined : oldDigits[position];
                    if (!active || oldDigit === undefined || oldDigit === character) return <span key={index}>{character}</span>;
                    return (
                        <span key={`${active.revision}-${index}`} className="rolling-credit-digit">
                            <span className="rolling-credit-digit-old">{oldDigit}</span>
                            <span className="rolling-credit-digit-new">{character}</span>
                        </span>
                    );
                })}
            </span>
        </span>
    );
}

export function RollingCreditAmount({ value, maximumFractionDigits = 6 }: { value: number | null; maximumFractionDigits?: number }) {
    return <RollingCreditText text={value === null ? null : value.toLocaleString("zh-CN", { maximumFractionDigits })} />;
}
