import { useMemo, useState } from "react";
import { isThinkingLevel, thinkingLevelsFor, type TextThinkingConfig, type ThinkingRequest } from "@/lib/text-thinking";
import { scopedStorageKey } from "@/lib/user-scope";

export function useAgentReasoningPreference(userId: string | undefined, model: string, thinking: TextThinkingConfig) {
    const key = userId && model ? scopedStorageKey(`canvas.agent.reasoning-level:${encodeURIComponent(model)}`, userId) : "";
    const stored = useMemo(() => {
        if (!key) return null;
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    }, [key]);
    const [choices, setChoices] = useState<Record<string, ThinkingRequest>>({});
    const levels = thinkingLevelsFor(thinking);
    const available = (value: unknown): value is ThinkingRequest => value === "auto" || (value === "deep" && levels.length > 0) || (isThinkingLevel(value) && levels.includes(value));
    const preferred = choices[key] ?? stored;
    const mode = available(preferred) ? preferred : "auto";

    const select = (next: ThinkingRequest) => {
        if (!key || !available(next)) return;
        setChoices((current) => ({ ...current, [key]: next }));
        try {
            if (next === "auto") window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, next);
        } catch {
            // 存储不可用时保留当前面板的选择。
        }
    };
    return [mode, select] as const;
}
